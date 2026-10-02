import './style.css'
import * as THREE from 'three'
// Patches the fog shader chunk before any material compiles.
import './src/radialFog'
import { CURVATURE } from './src/chunk'
import ChunkManager from './src/chunkManager'
import DayNight from './src/dayNight'
import {
	copyKeyframe,
	createDayNightPalette,
	DAY_NIGHT_DEFAULTS,
	parseTimeOfDay,
} from './src/dayNightPolicy'
import { DESERT_TERRAIN_DEFAULTS, getHeight } from './src/chunkGeometry'
import { createBiomeOffset } from './src/biome'
import {
	createTerrainNormalSettings,
	createTerrainNormalUniforms,
	loadTerrainNormalTextures,
	TERRAIN_BANDS,
	updateTerrainNormalUniforms,
} from './src/terrainNormals'
import { initKTX2Loader, loadKTX2Texture } from './src/ktx2Textures'
import { bakeImpostorAtlas } from './src/impostors/impostorBaker'
import {
	createImpostorMaterial,
	createImpostorWireframeMaterial,
	setImpostorAtlas,
} from './src/impostors/impostorMaterial'
import {
	IMPOSTOR_FRAMES_DESKTOP,
	IMPOSTOR_FRAMES_MOBILE,
} from './src/impostors/impostorTypes'
import SceneryMeshes from './src/impostors/sceneryMeshes'
import { setSceneryWireframe } from './src/impostors/sceneryWireframe'
import {
	createCloudMeshSettings,
	createSceneryMeshSettings,
	createSceneryWireframeSettings,
} from './src/sceneryMeshPolicy'
import SceneryShadows, { createSceneryShadowUniforms } from './src/sceneryShadows'
import {
	createCloudShadowSettings,
	createSceneryShadowSettings,
} from './src/shadowPolicy'
import Clouds from './src/clouds'
import CloudShadows, { createCloudShadowUniforms } from './src/cloudShadows'
import { CLOUD_TYPE_KEYS, createCloudSettings } from './src/cloudPlacement'
import { isDebugEnabled } from './src/debugPolicy'
import {
	createRandomSeed,
	normalizeWorldSeed,
	parseWorldSeed,
} from './src/worldSeed'
import { AIRPLANE_MODELS, getAirplaneModelKey } from './src/airplaneModels'
import Plane from './src/plane'
import PostProcessing from './src/postProcessing'
import FrameStats from './src/frameStats'
import Soundtrack from './src/soundtrack'
import TerrainSampleDebug from './src/terrainSampleDebug'
import {
	SCENERY_CATEGORIES,
	SCENERY_CELL_SIZES,
	SCENERY_TYPE_KEYS,
	createScenerySettings,
} from './src/sceneryPlacement'
import audioSrc from './src/audio/epic-soundtrack.mp3'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import gsap from 'gsap'
import woodGrainSrc from './src/textures/white_oak/white_oak_veneer_diff_1k.ktx2?url'

const loadingEl = document.getElementById('loader')
const progressEl = document.getElementById('progress')
const playEl = document.getElementById('play')
const toggleEl = document.getElementById('sound-toggle')
const cameraTarget = new THREE.Vector3(0, 6.9, 0)
let volume = true
const isMobile = window.innerWidth < 768
const urlParams = new URLSearchParams(window.location.search)
// Replaced at runtime by the ?gui=1 World folder through applyWorldSeed().
let worldSeed = parseWorldSeed(urlParams) ?? createRandomSeed()
const worldFeatures = Object.freeze({
	scenery: true,
	clouds: true,
	boats: false,
})
const debugFeatures = Object.freeze({
	terrainSamples: isDebugEnabled(urlParams),
	flightPause: isDebugEnabled(urlParams),
})
// Debug-only modules load only behind their URL flags, so the default bundle
// carries neither lil-gui nor OrbitControls (used by the flight pause).
const FlightPauseDebug = debugFeatures.flightPause
	? (await import('./src/flightPauseDebug')).default
	: null
// Before any asset request: an await between two requests could let the
// loading manager finish (and call init()) before the later ones register.
let gui
if (urlParams.get('gui') === '1') {
	const { GUI } = await import('lil-gui')
	gui = new GUI()
}

// Streamed when Play is pressed instead of being loaded with the startup
// assets, so it never delays the first frame. The ?gui=1 tuning mode never
// plays it, so it does not preload either.
const soundtrack = new Soundtrack(audioSrc, { volume: 0.1, preload: !gui })

const assets = {
	planeModel: null,
	boatModel: null,
	impostorMaterial: null,
	impostorWireframeMaterial: null,
	woodTexture: null,
}

const loaderManager = new THREE.LoadingManager()
loaderManager.onLoad = () => {
	gsap.set('canvas', { autoAlpha: 0 })

	toggleEl.addEventListener('click', () => {
		volume = !volume

		soundtrack.setMuted(!volume)
		gsap.to(toggleEl, { opacity: volume ? 1 : 0.4, duration: 0.2 })
	})

	gsap.to(loadingEl, {
		autoAlpha: 0,
		duration: 1,
		onComplete: () => {
			init(assets)
			precompileShaders()

			gsap.to(playEl, {
				autoAlpha: 1,
				duration: 0.5,
				onComplete: () => {
					playEl.addEventListener('click', () => {
						if (!gui) {
							soundtrack.play()
						}
						gsap.fromTo(
							plane,
							{ baseSpeed: 35 },
							{ duration: 1, baseSpeed: 55, speed: 55 },
						)
						gsap.to(playEl, { duration: 0.2, autoAlpha: 0 })
						gsap.fromTo(
							camera.position,
							{ z: -1 },
							{
								duration: 1,
								ease: 'expo.out',
								z: isMobile ? -16 : -18,
								onComplete: () => {
									plane.addEffect()
									if (flightPause) flightPause.canPause = true
								},
							},
						)
					})
					gsap.to('canvas', { autoAlpha: 1, duration: 3, ease: 'power3.out' })
				},
			})
		},
	})
}

loaderManager.onProgress = (a, i, total) => {
	const progress = (100 * i) / total
	gsap.to(progressEl, { width: `${progress}%`, duration: 1 })
}

loaderManager.onStart = () => {
	gsap.to(loadingEl, { autoAlpha: 1, duration: 0 })
}

// The scene always renders through PostProcessing's offscreen chain, whose
// 2x MSAA buffer is the only antialiasing. The canvas only receives the
// finished full-screen composite, so it needs neither MSAA nor depth. It is
// created before the asset requests: the KTX2 loader picks its GPU format
// from it. The depth buffer is the standard one: a logarithmic depth buffer
// makes every material write gl_FragDepth, which disables early depth
// rejection, so hidden terrain would still run its whole fragment shader
// (camera near plane below). On laptops with two GPUs, high-performance asks
// for the discrete one.
const renderer = new THREE.WebGLRenderer({
	antialias: false,
	depth: false,
	powerPreference: 'high-performance',
})
const ktx2Loader = initKTX2Loader(renderer, loaderManager)

// The airplane GLBs carry meshopt geometry (EXT_meshopt_compression) and KTX2
// textures (KHR_texture_basisu), both from scripts/encode-assets.mjs.
const gltfLoader = new GLTFLoader(loaderManager)
	.setMeshoptDecoder(MeshoptDecoder)
	.setKTX2Loader(ktx2Loader)

if (worldFeatures.scenery || worldFeatures.clouds) {
	// White oak veneer color map (KTX2, sRGB), baked into every impostor's
	// albedo and sampled by the near scenery and cloud meshes.
	loadKTX2Texture(woodGrainSrc, (texture) => {
		texture.colorSpace = THREE.SRGBColorSpace
		texture.wrapS = THREE.RepeatWrapping
		texture.wrapT = THREE.RepeatWrapping
		assets.woodTexture = texture
	})
}

if (worldFeatures.boats) {
	gltfLoader.load('/boat/scene.gltf', (gltf) => {
		const model = gltf.scene.children[0].children[0]
		model.scale.setScalar(1.3)
		model.rotation.x = 0

		assets.boatModel = model
	})
}

// `?plane=toy` loads the monoplane; the biplane is the default. The geometry
// is centered and turned so the nose points to +Z, then the mesh is scaled to
// the model's wingspan (src/airplaneModels.js).
const airplaneModel = AIRPLANE_MODELS[getAirplaneModelKey(urlParams)]
gltfLoader.load(airplaneModel.path, (gltf) => {
	gltf.scene.traverse((el) => {
		if (el instanceof THREE.Mesh) {
			el.geometry.center()
			if (airplaneModel.rotationY) el.geometry.rotateY(airplaneModel.rotationY)
			el.geometry.computeBoundingBox()
			const { min, max } = el.geometry.boundingBox
			el.scale.setScalar(airplaneModel.wingspan / (max.x - min.x))
			el.name = 'plane'
			assets.planeModel = el
		}
	})
})

/**
 * Debug
 */

const params = {
	speedEffect: 0,
	// Peak intensities; the day/night cycle scales them every frame.
	directionalLight: 4,
	moonLight: 1.2,
	ambientLight: 1.5,
	dayNight: {
		timeOfDay: parseTimeOfDay(urlParams) ?? DAY_NIGHT_DEFAULTS.startTimeOfDay,
		cycleDuration: DAY_NIGHT_DEFAULTS.cycleDuration,
		paused: false,
		// Editable copy of DAY_NIGHT_DEFAULTS.keyframes (sRGB colors).
		keyframes: createDayNightPalette(),
		skyGradientHeight: DAY_NIGHT_DEFAULTS.skyGradientHeight,
	},
	// Radial fog range in world units from the eye; DayNight applies it.
	fog: { near: 200, far: 2100 },
	amplitude: 32,
	frequency: {
		x: 0.5,
		z: 0.5,
	},
	octaves: 3,
	lacunarity: 2,
	persistance: 0.5,
	// Desert detail topography and progressive height reduction; see
	// DESERT_TERRAIN_DEFAULTS.
	desert: { ...DESERT_TERRAIN_DEFAULTS },
	colors: {
		uGrass: '#6d976d',
		uLand: '#5e551d',
		uRocks: '#521f00',
	},
	// Soft lighter patches on land from a world-space noise: frequency (per world
	// unit), intensity (0.3 = up to 30% brighter), threshold (noise value in
	// [0, 1] where lightening starts), softness (transition half-width), and
	// speed (noise drift per second).
	terrainColorNoise: {
		frequency: 0.012,
		intensity: 0.75,
		threshold: 0.61,
		softness: 0.3,
		speed: 0.25,
	},
	// Normal map, tile size (world units), and strength per terrain layer;
	// defaults and texture assignment live in TERRAIN_NORMAL_LAYERS.
	terrainNormals: createTerrainNormalSettings(),
	// Renderer tone mapping operator (a THREE.*ToneMapping constant) and exposure.
	// A tone-mapped mode switches the composer to half-float buffers.
	toneMapping: { mode: THREE.ACESFilmicToneMapping, exposure: 1 },
	postProcessing: {
		// Minimum effect intensity; lets the GUI hold the effect on while tuning.
		preview: 0,
		// Edge blur and aberration always shown, as for a speed effect of this
		// value; boosting animates the rest. 0 leaves the edges sharp at rest. The
		// camera FOV kick ignores it.
		idleSpeedEffect: 0.4,
		// Static screen-space grain; intensity is the maximum brightness change
		// (0.05 = ±5%). 0 disables it.
		grain: { intensity: 0.035 },
		// Radii: 0 = viewport center, ~0.71 = edge midpoints, 1 = corners.
		// verticalScale shrinks only the vertical distance (1 = circular falloff).
		verticalScale: 0.78,
		blur: { strength: 0.075, start: 0.35, end: 1.5, curve: 1.2 },
		aberration: { strength: 0.016, start: 0.28, end: 0.9, curve: 2.2 },
	},
	// Placement settings sent to the chunk workers; see createScenerySettings().
	scenery: createScenerySettings({ isMobile }),
	// Shader-side, applied live: brightness change per type in stops (1 = half
	// to double brightness) and the world frequency of the noise that drives it.
	// Wood color baked into every impostor: repeats per world unit and color
	// strength (0 = vertex color only, 1 = vertex color × texture). Changing
	// them re-bakes the atlas.
	impostorDetail: { scale: 0.01, color: 0.1 },
	// Near scenery meshes, in units from the eye: full-detail meshes below
	// `lodStart`, reduced-detail meshes from `lodEnd` to `start`, impostors
	// beyond `end`, with dithered cross-fades inside each band.
	sceneryMeshes: createSceneryMeshSettings({ isMobile }),
	// Debug overlay outlining scenery triangles in one color per level of
	// detail: LOD 0 mesh, LOD 1 mesh, impostor quad.
	sceneryWireframe: createSceneryWireframeSettings(),
	// Soft shadows of scenery and the airplane on terrain and scenery, in two
	// cascades that fade out with distance; see createSceneryShadowSettings().
	shadows: createSceneryShadowSettings({ isMobile }),
	impostorVariation: {
		frequency: 0.01,
		amount: Object.fromEntries(
			Object.values(SCENERY_TYPE_KEYS).map((key) => [key, 0.8]),
		),
	},
	// World-level cloud field (src/clouds.js): deterministic placement (see
	// createCloudSettings()), near-mesh bands like sceneryMeshes, the wood
	// detail baked into the cloud atlas (changing it re-bakes), the ambient
	// light multiplier that keeps the undersides bright, the brightness
	// variation per type, and the cloud shadows on terrain and scenery (see
	// createCloudShadowSettings()).
	clouds: {
		placement: createCloudSettings({ isMobile }),
		meshes: createCloudMeshSettings({ isMobile }),
		detail: { scale: 0.012, color: 0.6 },
		ambient: 2.72,
		variation: {
			frequency: 0.0405,
			// Keyed like CLOUD_TYPE_KEYS.
			amount: { bank: 0.99, heap: 1.26, puff: 0.99 },
		},
		shadows: createCloudShadowSettings({ isMobile }),
	},
	// Airplane propeller rotation in turns per second. With two blades, speeds
	// near half the frame rate (30 at 60 fps) strobe and look still.
	propeller: { speed: 4 },
	trails: {
		ribbonWidth: 9.6,
		lineWidth: 0.65,
		borderWidth: 0.08,
		outerEdge: { frequency: 1.4, amplitude: 0.47 },
		innerEdge: { frequency: 1.4, amplitude: 0.43 },
		oscillation: { frequency: 0.03, amplitude: 0.3 },
	},
}

const uniforms = {
	uTime: { value: 0 },
	uCamera: { value: new THREE.Vector3() },
	uCurvature: { value: CURVATURE },
	uLand: { value: new THREE.Color(params.colors.uLand) },
	uGrass: { value: new THREE.Color(params.colors.uGrass) },
	uRocks: { value: new THREE.Color(params.colors.uRocks) },
	// Written by DayNight before the first render.
	uAtmosphere: { value: new THREE.Color() },
	uBiomeOffset: { value: new THREE.Vector2(...createBiomeOffset(worldSeed)) },
	uColorNoiseFrequency: { value: params.terrainColorNoise.frequency },
	uColorNoiseIntensity: { value: params.terrainColorNoise.intensity },
	uColorNoiseThreshold: { value: params.terrainColorNoise.threshold },
	uColorNoiseSoftness: { value: params.terrainColorNoise.softness },
	uColorNoiseSpeed: { value: params.terrainColorNoise.speed },
	...createTerrainNormalUniforms(params.terrainNormals),
	// Impostor-to-mesh band; written by SceneryMeshes.applySettings().
	uSceneryMeshRange: { value: new THREE.Vector2(-2, -1) },
	// Shadow maps, matrices, and fades; written by SceneryShadows.
	...createSceneryShadowUniforms(params.shadows),
	// Cloud shadow map, matrix, and strength; written by CloudShadows.
	...createCloudShadowUniforms(),
}
// Swaps the flat placeholders for the KTX2 maps as they arrive.
loadTerrainNormalTextures(uniforms, params.terrainNormals)
// Uniforms shared with the impostor material; amount is indexed by type.
const impostorVariation = {
	amount: { value: new Array(Object.keys(SCENERY_TYPE_KEYS).length).fill(0) },
	frequency: { value: params.impostorVariation.frequency },
}
function updateImpostorVariation() {
	for (const [type, key] of Object.entries(SCENERY_TYPE_KEYS)) {
		impostorVariation.amount.value[type] = params.impostorVariation.amount[key]
	}
	impostorVariation.frequency.value = params.impostorVariation.frequency
}
updateImpostorVariation()
// Shows or recolors the debug wireframe on the near meshes and impostors.
function applySceneryWireframe() {
	sceneryMeshes?.applyWireframe()
	clouds?.applyWireframe()
	const { enabled, impostorColor } = params.sceneryWireframe
	if (assets.impostorWireframeMaterial) {
		setSceneryWireframe(assets.impostorWireframeMaterial, enabled, impostorColor)
	}
}
// Wood detail shared by the near meshes; the bake reads params.impostorDetail.
// The texture is assigned in init().
const sceneryDetail = {
	uDetail: { value: null },
	uDetailScale: { value: params.impostorDetail.scale },
	uDetailColor: { value: params.impostorDetail.color },
}

if (gui) {
	const worldSettings = {
		seed: worldSeed,
		randomSeed() {
			worldSettings.seed = createRandomSeed()
			applyWorldSeed(worldSettings.seed)
			seedController.updateDisplay()
		},
	}
	const worldFolder = gui.addFolder('World')
	const seedController = worldFolder
		.add(worldSettings, 'seed')
		.name('Seed')
		.onFinishChange((value) => {
			const seed = normalizeWorldSeed(value)
			// A blank value restores the current seed.
			worldSettings.seed = seed ?? worldSeed
			seedController.updateDisplay()
			if (seed) applyWorldSeed(seed)
		})
	worldFolder.add(worldSettings, 'randomSeed').name('Random seed')

	const terrainFolder = gui.addFolder('Terrain')
	terrainFolder.addColor(params.colors, 'uGrass').onChange((val) => {
		uniforms.uGrass.value.set(val)
	})

	terrainFolder.addColor(params.colors, 'uLand').onChange((val) => {
		uniforms.uLand.value.set(val)
	})

	terrainFolder.addColor(params.colors, 'uRocks').onChange((val) => {
		uniforms.uRocks.value.set(val)
	})
	// Each change regenerates every desired chunk, so it waits for the release.
	terrainFolder
		.add(params, 'amplitude', 0, 100, 0.1)
		.onFinishChange(regenerateTerrain)
	terrainFolder
		.add(params, 'octaves', 1, 10, 1)
		.onFinishChange(regenerateTerrain)
	terrainFolder
		.add(params, 'persistance', 0, 1, 0.05)
		.onFinishChange(regenerateTerrain)
	terrainFolder
		.add(params, 'lacunarity', 1, 5, 0.5)
		.onFinishChange(regenerateTerrain)
	terrainFolder
		.add(params.frequency, 'x', 0.01, 2, 0.01)
		.onFinishChange(regenerateTerrain)
	terrainFolder
		.add(params.frequency, 'z', 0.01, 2, 0.01)
		.onFinishChange(regenerateTerrain)

	const colorNoiseFolder = terrainFolder.addFolder('Color noise')
	const colorNoiseControls = [
		['frequency', 'Frequency', 0.0005, 0.05, 0.0005, 'uColorNoiseFrequency'],
		['intensity', 'Intensity', 0, 1, 0.01, 'uColorNoiseIntensity'],
		['threshold', 'Threshold', 0, 1, 0.01, 'uColorNoiseThreshold'],
		['softness', 'Softness', 0.01, 0.5, 0.01, 'uColorNoiseSoftness'],
		['speed', 'Speed', 0, 0.3, 0.005, 'uColorNoiseSpeed'],
	]
	for (const [key, label, min, max, step, uniform] of colorNoiseControls) {
		colorNoiseFolder
			.add(params.terrainColorNoise, key, min, max, step)
			.name(label)
			.onChange((value) => {
				uniforms[uniform].value = value
			})
	}

	const desertFolder = terrainFolder.addFolder('Desert topography')
	desertFolder
		.add(params.desert, 'frequency', 0.1, 2, 0.01)
		.name('Detail frequency ×')
		.onFinishChange(regenerateTerrain)
	desertFolder
		.add(params.desert, 'amplitude', 0, 2, 0.01)
		.name('Detail amplitude ×')
		.onFinishChange(regenerateTerrain)
	desertFolder
		.add(params.desert, 'blend', 0.01, 0.4, 0.005)
		.name('Blend width')
		.onFinishChange(regenerateTerrain)
	desertFolder
		.add(params.desert, 'flatten', 0, 1, 0.01)
		.name('Height reduction')
		.onFinishChange(regenerateTerrain)
	desertFolder
		.add(params.desert, 'depth', 0.01, 1.5, 0.01)
		.name('Reduction depth')
		.onFinishChange(regenerateTerrain)

	const updateTerrainNormals = () =>
		updateTerrainNormalUniforms(uniforms, params.terrainNormals)
	const terrainNormalsFolder = terrainFolder.addFolder('Normal maps')
	terrainNormalsFolder
		.add(params.terrainNormals.fade, 'start', 0, 1000, 1)
		.name('Fade start (units)')
		.onChange(updateTerrainNormals)
	terrainNormalsFolder
		.add(params.terrainNormals.fade, 'end', 1, 2000, 1)
		.name('Fade end (units)')
		.onChange(updateTerrainNormals)
	for (const band of TERRAIN_BANDS) {
		const layer = params.terrainNormals[band]
		const folder = terrainNormalsFolder.addFolder(
			`${band[0].toUpperCase()}${band.slice(1)} (${layer.texture})`,
		)
		folder
			.add(layer, 'scale', 1, 100, 0.1)
			.name('Tile size (units)')
			.onChange(updateTerrainNormals)
		folder
			.add(layer, 'strength', 0, 5, 0.01)
			.name('Strength')
			.onChange(updateTerrainNormals)
		folder
			.add(layer, 'rotation', 0, 360, 1)
			.name('Rotation (°)')
			.onChange(updateTerrainNormals)
	}

	const lightsFolder = gui.addFolder('Lights')
	lightsFolder.add(params, 'directionalLight', 0, 10, 0.1)
	lightsFolder.add(params, 'moonLight', 0, 3, 0.05)
	lightsFolder.add(params, 'ambientLight', 0, 10, 0.1)

	const dayNightFolder = gui.addFolder('Day/night')
	dayNightFolder
		.add(params.dayNight, 'timeOfDay', 0, 0.9999, 0.0001)
		.name('Time of day')
		.listen()
	dayNightFolder
		.add(params.dayNight, 'cycleDuration', 10, 1200, 1)
		.name('Cycle duration (s)')
	dayNightFolder.add(params.dayNight, 'paused').name('Paused').listen()

	const skyFolder = gui.addFolder('Sky')
	skyFolder
		.add(params.dayNight, 'skyGradientHeight', 0.02, 1, 0.005)
		.name('Gradient height (rad)')
	skyFolder.add(params.fog, 'near', 0, 2000, 10).name('Fog near')
	skyFolder.add(params.fog, 'far', 100, 3000, 10).name('Fog far')

	// One folder per keyframe; Preview pauses the cycle on that keyframe.
	const paletteFolder = skyFolder.addFolder('Palette')
	const paletteColors = {
		zenith: 'Zenith',
		horizon: 'Horizon / fog',
		atmosphere: 'Atmosphere',
		sunColor: 'Sun',
		moonColor: 'Moon',
		ambientColor: 'Ambient',
		trailTint: 'Trail tint',
	}
	const paletteScalars = {
		sunIntensity: ['Sun intensity', 2],
		moonIntensity: ['Moon intensity', 2],
		ambientIntensity: ['Ambient intensity', 2],
		stars: ['Stars', 1],
	}
	const paletteActions = {
		copy() {
			const json = JSON.stringify(
				params.dayNight.keyframes,
				(key, value) =>
					typeof value === 'number' ? Math.round(value * 1000) / 1000 : value,
				'\t',
			)
			console.log(json)
			navigator.clipboard?.writeText(json).catch(() => {})
		},
		reset() {
			DAY_NIGHT_DEFAULTS.keyframes.forEach((keyframe, index) =>
				copyKeyframe(keyframe, params.dayNight.keyframes[index]),
			)
			for (const controller of paletteFolder.controllersRecursive()) {
				controller.updateDisplay()
			}
		},
	}
	paletteFolder.add(paletteActions, 'copy').name('Copy palette JSON')
	paletteFolder.add(paletteActions, 'reset').name('Reset palette')
	for (const keyframe of params.dayNight.keyframes) {
		const folder = paletteFolder.addFolder(
			`${keyframe.name} (${keyframe.t.toFixed(2)})`,
		)
		folder
			.add({ preview: () => dayNight.previewKeyframe(keyframe) }, 'preview')
			.name('Preview')
		for (const [field, label] of Object.entries(paletteColors)) {
			folder.addColor(keyframe, field).name(label)
		}
		for (const [field, [label, max]] of Object.entries(paletteScalars)) {
			folder.add(keyframe, field, 0, max, 0.01).name(label)
		}
	}

	const toneMappingFolder = gui.addFolder('Tone mapping')
	toneMappingFolder
		.add(params.toneMapping, 'mode', {
			None: THREE.NoToneMapping,
			Linear: THREE.LinearToneMapping,
			Reinhard: THREE.ReinhardToneMapping,
			Cineon: THREE.CineonToneMapping,
			'ACES Filmic': THREE.ACESFilmicToneMapping,
			AgX: THREE.AgXToneMapping,
			Neutral: THREE.NeutralToneMapping,
		})
		.name('Mode')
		.onChange((mode) => {
			renderer.toneMapping = mode
			postProcessing.updateToneMapping()
		})
	// Three.js ignores exposure while the mode is None.
	toneMappingFolder
		.add(params.toneMapping, 'exposure', 0, 4, 0.01)
		.name('Exposure')
		.onChange((exposure) => {
			renderer.toneMappingExposure = exposure
		})

	const grainFolder = gui.addFolder('Film grain')
	grainFolder
		.add(params.postProcessing.grain, 'intensity', 0, 0.3, 0.005)
		.name('Intensity')

	const updatePost = () =>
		postProcessing.speedEffect.setParams(params.postProcessing)
	const speedFolder = gui.addFolder('Speed effect')
	// Read by tic(): holds the edge effect at least at this speed effect.
	speedFolder.add(params, 'speedEffect', 0, 1, 0.01)
	speedFolder.add(params.postProcessing, 'preview', 0, 1, 0.01)
	speedFolder
		.add(params.postProcessing, 'idleSpeedEffect', 0, 1, 0.01)
		.name('Idle level')
	speedFolder
		.add(params.postProcessing, 'verticalScale', 0, 1, 0.01)
		.name('Vertical scale')
		.onChange(updatePost)
	const blurFolder = speedFolder.addFolder('Blur')
	blurFolder
		.add(params.postProcessing.blur, 'strength', 0, 0.15, 0.001)
		.onChange(updatePost)
	blurFolder
		.add(params.postProcessing.blur, 'start', 0, 1, 0.01)
		.onChange(updatePost)
	blurFolder
		.add(params.postProcessing.blur, 'end', 0, 1.5, 0.01)
		.onChange(updatePost)
	blurFolder
		.add(params.postProcessing.blur, 'curve', 0.1, 5, 0.05)
		.onChange(updatePost)
	const aberrationFolder = speedFolder.addFolder('Chromatic aberration')
	aberrationFolder
		.add(params.postProcessing.aberration, 'strength', 0, 0.05, 0.0005)
		.onChange(updatePost)
	aberrationFolder
		.add(params.postProcessing.aberration, 'start', 0, 1, 0.01)
		.onChange(updatePost)
	aberrationFolder
		.add(params.postProcessing.aberration, 'end', 0, 1.5, 0.01)
		.onChange(updatePost)
	aberrationFolder
		.add(params.postProcessing.aberration, 'curve', 0.1, 5, 0.05)
		.onChange(updatePost)

	// Scenery changes re-place instances in the workers when a control is
	// released; terrain is not regenerated.
	const updateScenery = () => chunkManager?.onSceneryChange()
	const sceneryFolder = gui.addFolder('Scenery')
	sceneryFolder
		.add(params.scenery, 'cellSize', SCENERY_CELL_SIZES)
		.name('Grid cell (units)')
		.onFinishChange(updateScenery)
	sceneryFolder
		.add(params.scenery, 'maxPerChunk', 0, 4096, 1)
		.name('Max per chunk')
		.onFinishChange(updateScenery)
	const rebakeImpostors = () => {
		sceneryDetail.uDetailScale.value = params.impostorDetail.scale
		sceneryDetail.uDetailColor.value = params.impostorDetail.color
		if (assets.impostorMaterial) {
			setImpostorAtlas(assets.impostorMaterial, bakeImpostors())
		}
	}
	const detailFolder = sceneryFolder.addFolder('Wood detail')
	detailFolder
		.add(params.impostorDetail, 'scale', 0.02, 1, 0.01)
		.name('Repeats per unit')
		.onFinishChange(rebakeImpostors)
	detailFolder
		.add(params.impostorDetail, 'color', 0, 1, 0.01)
		.name('Color strength')
		.onFinishChange(rebakeImpostors)
	const wireframeSettings = params.sceneryWireframe
	const wireframeFolder = sceneryFolder.addFolder('Wireframe')
	wireframeFolder
		.add(wireframeSettings, 'enabled')
		.name('Show wireframe')
		.onChange(applySceneryWireframe)
	wireframeSettings.meshColors.forEach((_, lod) =>
		wireframeFolder
			.addColor(wireframeSettings.meshColors, lod)
			.name(`LOD ${lod} mesh`)
			.onChange(applySceneryWireframe),
	)
	wireframeFolder
		.addColor(wireframeSettings, 'impostorColor')
		.name('Impostor')
		.onChange(applySceneryWireframe)
	// Live: only the shader band and the CPU selection radius change.
	const updateSceneryMeshes = () => sceneryMeshes?.applySettings()
	const meshFolder = sceneryFolder.addFolder('Near meshes')
	meshFolder
		.add(params.sceneryMeshes, 'enabled')
		.name('Enabled')
		.onChange(updateSceneryMeshes)
	meshFolder
		.add(params.sceneryMeshes, 'lodStart', 0, 400, 1)
		.name('Full detail until (units)')
		.onChange(updateSceneryMeshes)
	meshFolder
		.add(params.sceneryMeshes, 'lodEnd', 1, 500, 1)
		.name('Reduced detail from (units)')
		.onChange(updateSceneryMeshes)
	meshFolder
		.add(params.sceneryMeshes, 'start', 0, 600, 1)
		.name('Mesh until (units)')
		.onChange(updateSceneryMeshes)
	meshFolder
		.add(params.sceneryMeshes, 'end', 1, 700, 1)
		.name('Impostor from (units)')
		.onChange(updateSceneryMeshes)
	sceneryFolder
		.add(params.impostorVariation, 'frequency', 0.001, 0.1, 0.001)
		.name('Variation frequency')
		.onChange(updateImpostorVariation)
	const sceneryLabels = { trees: 'Trees', cacti: 'Cacti', rocks: 'Rocks' }
	for (const [category, types] of Object.entries(SCENERY_CATEGORIES)) {
		const folder = sceneryFolder.addFolder(sceneryLabels[category])
		folder
			.add(params.scenery.density, category, 0, 4, 0.01)
			.name('Density')
			.onFinishChange(updateScenery)
		for (const type of types) {
			const key = SCENERY_TYPE_KEYS[type]
			folder
				.add(params.scenery.size, key, 0.1, 4, 0.01)
				.name(`${key} size`)
				.onFinishChange(updateScenery)
			folder
				.add(params.impostorVariation.amount, key, 0, 2, 0.01)
				.name(`${key} variation`)
				.onChange(updateImpostorVariation)
		}
	}

	const cloudSettings = params.clouds
	const cloudsFolder = gui.addFolder('Clouds')
	// Placement changes re-place the field when a control is released.
	const updateClouds = () => clouds?.applySettings()
	const placement = cloudSettings.placement
	cloudsFolder
		.add(placement, 'density', 0, 1, 0.01)
		.name('Density')
		.onFinishChange(updateClouds)
	cloudsFolder
		.add(placement, 'coverage', 0, 1, 0.01)
		.name('Sky coverage')
		.onFinishChange(updateClouds)
	cloudsFolder
		.add(placement.altitude, 'min', 110, 300, 1)
		.name('Lowest base (Y)')
		.onFinishChange(updateClouds)
	cloudsFolder
		.add(placement.altitude, 'range', 0, 150, 1)
		.name('Base spread (units)')
		.onFinishChange(updateClouds)
	cloudsFolder
		.add(placement, 'radius', 400, 2000, 10)
		.name('Field radius (units)')
		.onFinishChange(updateClouds)
	for (const key of Object.values(CLOUD_TYPE_KEYS)) {
		cloudsFolder
			.add(placement.size, key, 0.2, 3, 0.01)
			.name(`${key} size`)
			.onFinishChange(updateClouds)
	}
	// Smooth changes of density, coverage, and size across the world; altitude
	// and radius never vary.
	const regionalFolder = cloudsFolder.addFolder('Regional variation')
	regionalFolder
		.add(placement.regional, 'scale', 500, 12000, 50)
		.name('Region size (units)')
		.onFinishChange(updateClouds)
	regionalFolder
		.add(placement.regional, 'density', 0, 1, 0.01)
		.name('Density (±share)')
		.onFinishChange(updateClouds)
	regionalFolder
		.add(placement.regional, 'coverage', 0, 0.6, 0.01)
		.name('Coverage (±)')
		.onFinishChange(updateClouds)
	regionalFolder
		.add(placement.regional, 'size', 0, 1.5, 0.01)
		.name('Size (±stops)')
		.onFinishChange(updateClouds)
	// Live: ambient boost and brightness variation uniforms.
	const updateCloudAppearance = () => clouds?.applyAppearance()
	cloudsFolder
		.add(cloudSettings, 'ambient', 0, 4, 0.01)
		.name('Ambient boost')
		.onChange(updateCloudAppearance)
	cloudsFolder
		.add(cloudSettings.variation, 'frequency', 0.0005, 0.05, 0.0005)
		.name('Variation frequency')
		.onChange(updateCloudAppearance)
	for (const key of Object.values(CLOUD_TYPE_KEYS)) {
		cloudsFolder
			.add(cloudSettings.variation.amount, key, 0, 2, 0.01)
			.name(`${key} variation`)
			.onChange(updateCloudAppearance)
	}
	const rebakeClouds = () => clouds?.rebake()
	const cloudDetailFolder = cloudsFolder.addFolder('Wood detail')
	cloudDetailFolder
		.add(cloudSettings.detail, 'scale', 0.002, 0.2, 0.001)
		.name('Repeats per unit')
		.onFinishChange(rebakeClouds)
	cloudDetailFolder
		.add(cloudSettings.detail, 'color', 0, 1, 0.01)
		.name('Color strength')
		.onFinishChange(rebakeClouds)
	// Live: only the shader band and the CPU selection radius change.
	const updateCloudMeshes = () => clouds?.applyMeshSettings()
	const cloudMeshFolder = cloudsFolder.addFolder('Near meshes')
	cloudMeshFolder
		.add(cloudSettings.meshes, 'enabled')
		.name('Enabled')
		.onChange(updateCloudMeshes)
	cloudMeshFolder
		.add(cloudSettings.meshes, 'lodStart', 0, 800, 1)
		.name('Full detail until (units)')
		.onChange(updateCloudMeshes)
	cloudMeshFolder
		.add(cloudSettings.meshes, 'lodEnd', 1, 900, 1)
		.name('Reduced detail from (units)')
		.onChange(updateCloudMeshes)
	cloudMeshFolder
		.add(cloudSettings.meshes, 'start', 0, 1400, 1)
		.name('Mesh until (units)')
		.onChange(updateCloudMeshes)
	cloudMeshFolder
		.add(cloudSettings.meshes, 'end', 1, 1500, 1)
		.name('Impostor from (units)')
		.onChange(updateCloudMeshes)
	// Strength applies live; the rest renders the map again.
	const updateCloudShadows = () => cloudShadows?.applySettings()
	const cloudShadowsFolder = cloudsFolder.addFolder('Shadows')
	cloudShadowsFolder.add(cloudSettings.shadows, 'enabled').name('Enabled')
	cloudShadowsFolder
		.add(cloudSettings.shadows, 'strength', 0, 1, 0.01)
		.name('Strength')
	cloudShadowsFolder
		.add(cloudSettings.shadows, 'softness', 0, 20, 0.1)
		.name('Softness (units)')
		.onChange(updateCloudShadows)
	cloudShadowsFolder
		.add(cloudSettings.shadows, 'radius', 200, 2000, 10)
		.name('Radius (units)')
		.onChange(updateCloudShadows)

	// Live: uniforms only; cascade radii render every cascade again.
	const updateShadows = () => sceneryShadows?.applySettings()
	const shadowsFolder = gui.addFolder('Shadows')
	shadowsFolder.add(params.shadows, 'enabled').name('Enabled')
	shadowsFolder.add(params.shadows, 'strength', 0, 1, 0.01).name('Strength')
	shadowsFolder
		.add(params.shadows.softness, 'near', 0, 4, 0.05)
		.name('Softness near (units)')
		.onChange(updateShadows)
	shadowsFolder
		.add(params.shadows.softness, 'far', 0, 8, 0.05)
		.name('Softness far (units)')
		.onChange(updateShadows)
	shadowsFolder
		.add(params.shadows.fade, 'start', 0, 600, 1)
		.name('Fade start (units)')
		.onChange(updateShadows)
	shadowsFolder
		.add(params.shadows.fade, 'end', 1, 800, 1)
		.name('Fade end (units)')
		.onChange(updateShadows)
	shadowsFolder
		.add(params.shadows, 'bias', 0, 1, 0.01)
		.name('Depth bias (units)')
		.onChange(updateShadows)
	params.shadows.cascades.forEach((cascade, index) => {
		shadowsFolder
			.add(cascade, 'radius', 20, 1000, 1)
			.name(`${index === 0 ? 'Near' : 'Far'} cascade radius`)
			.onChange(updateShadows)
	})

	const airplaneFolder = gui.addFolder('Airplane')
	airplaneFolder
		.add(params.propeller, 'speed', 0, 20, 0.1)
		.name('Propeller speed (turns/s)')

	const trailsFolder = gui.addFolder('Trails')
	trailsFolder
		.add(params.trails, 'ribbonWidth', 7.5, 12, 0.1)
		.name('Ribbon width')
	trailsFolder.add(params.trails, 'lineWidth', 0, 1.5, 0.01).name('Line width')
	trailsFolder
		.add(params.trails, 'borderWidth', 0, 0.15, 0.005)
		.name('Black border width')
	const outerEdgeFolder = trailsFolder.addFolder('Outer edge')
	outerEdgeFolder.add(params.trails.outerEdge, 'frequency', 0.1, 8, 0.1)
	outerEdgeFolder.add(params.trails.outerEdge, 'amplitude', 0, 0.5, 0.005)
	const innerEdgeFolder = trailsFolder.addFolder('Inner edge')
	innerEdgeFolder.add(params.trails.innerEdge, 'frequency', 0.1, 8, 0.1)
	innerEdgeFolder.add(params.trails.innerEdge, 'amplitude', 0, 0.5, 0.005)
	const oscillationFolder = trailsFolder.addFolder('Oscillation')
	oscillationFolder.add(
		params.trails.oscillation,
		'frequency',
		0.01,
		0.3,
		0.005,
	)
	oscillationFolder.add(params.trails.oscillation, 'amplitude', 0, 0.5, 0.005)

	// Every panel starts closed.
	for (const folder of gui.foldersRecursive()) folder.close()
}

/**
 * Scene
 */
const scene = new THREE.Scene()

/**
 * render sizes
 */
const sizes = {
	width: window.innerWidth,
	height: window.innerHeight,
}
/**
 * Camera
 */
const fov = isMobile ? 80 : 60
// Near 1 keeps the 24-bit depth step under 0.25 units out to the fog end
// (about 2000 units); nothing comes within one unit of the chase camera.
const camera = new THREE.PerspectiveCamera(
	fov,
	sizes.width / sizes.height,
	1,
	10000,
)
camera.position.set(0, 7, -1)
camera.zoom = isMobile ? 0.8 : 1
camera.lookAt(cameraTarget)

/**
 * renderer
 */
renderer.toneMapping = params.toneMapping.mode
renderer.toneMappingExposure = params.toneMapping.exposure
document.body.appendChild(renderer.domElement)
const postProcessing = new PostProcessing(
	renderer,
	scene,
	camera,
	params.postProcessing,
)
// Frame time, stage time, draw counters, and GPU time for getRenderStats().
const frameStats = new FrameStats(renderer)
handleResize()

const chunkSize = 256

let chunkManager, plane, terrainSampleDebug, flightPause, sceneryMeshes, sceneryShadows
let clouds, cloudShadows

window.__INFINITE_WORLD__ = Object.freeze({
	getChunkStats: () => chunkManager?.getStats() ?? null,
	getFlightStats: () => plane?.getStats() ?? null,
	getPostProcessingStats: () => postProcessing.getStats(),
	getDebugStats: () => flightPause?.getStats() ?? null,
	getDayNightStats: () => dayNight.getStats(),
	getSceneryMeshStats: () => sceneryMeshes?.getStats() ?? null,
	getShadowStats: () => sceneryShadows?.getStats() ?? null,
	getCloudStats: () => clouds?.getStats() ?? null,
	getCloudShadowStats: () => cloudShadows?.getStats() ?? null,
	getRenderStats: () => frameStats.getStats(),
})

// Height above the terrain (or the sea) the airplane starts at, and the floor
// it is lifted to when a new seed raises the ground under it.
function getSpawnAltitude(x, z) {
	return (
		Math.max(
			getHeight(x, z, chunkManager.noise, params, chunkManager.biomeOffset),
			0,
		) + 60
	)
}

// Switches the world to a new seed: terrain noise, biomes (CPU and shader),
// scenery, and clouds regenerate around the airplane. Before init() only the
// seed and the biome uniform change; ChunkManager and Clouds are then created
// with the new seed.
function applyWorldSeed(seed) {
	if (seed === worldSeed) return
	worldSeed = seed
	clouds?.setSeed(seed)

	if (!chunkManager) {
		uniforms.uBiomeOffset.value.fromArray(createBiomeOffset(seed))
		return
	}

	chunkManager.setSeed(seed)
	liftPlaneAboveTerrain()
}

// Regenerates every desired chunk after a ?gui=1 terrain parameter change.
function regenerateTerrain() {
	if (!chunkManager) return
	chunkManager.onParamsChange()
	liftPlaneAboveTerrain()
}

// After the terrain changes under the airplane, lifts it above the new ground
// and resets the smoothed corridor so the jump does not trigger a brake.
function liftPlaneAboveTerrain() {
	const floor = getSpawnAltitude(plane.position.x, plane.position.z)
	if (plane.position.y < floor) plane.position.y = floor
	plane.resetTerrainState()
}

// Compiles the programs that would otherwise compile on first use in flight:
// near scenery and cloud meshes stay hidden until something enters their
// band, and cloud shadows render only while a light is up. Program variants
// depend on the bound render target, so the scene compiles against the
// offscreen buffer PostProcessing renders it into. With
// KHR_parallel_shader_compile the driver links them in the background.
function precompileShaders() {
	const target = renderer.getRenderTarget()
	renderer.setRenderTarget(postProcessing.composer.inputBuffer)
	const compiles = [renderer.compileAsync(scene, camera)]
	if (cloudShadows) compiles.push(cloudShadows.compileAsync())
	renderer.setRenderTarget(target)
	return Promise.all(compiles)
}

// Bakes every scenery type into the impostor atlas, with the wood detail.
function bakeImpostors() {
	return bakeImpostorAtlas(renderer, {
		frames: isMobile ? IMPOSTOR_FRAMES_MOBILE : IMPOSTOR_FRAMES_DESKTOP,
		frameSize: 64,
		detail: { texture: assets.woodTexture, ...params.impostorDetail },
	})
}

function init(assets) {
	plane = new Plane(assets.planeModel, params, camera, airplaneModel)

	if (worldFeatures.scenery) {
		assets.impostorMaterial = createImpostorMaterial(
			bakeImpostors(),
			uniforms,
			{
				singleFrame: isMobile,
				variation: impostorVariation,
				shadowTaps: params.shadows.taps.impostor,
			},
		)
		assets.impostorWireframeMaterial = createImpostorWireframeMaterial(
			assets.impostorMaterial,
			params.sceneryWireframe.impostorColor,
		)
		sceneryDetail.uDetail.value = assets.woodTexture
		sceneryMeshes = new SceneryMeshes({
			uniforms,
			variation: impostorVariation,
			detail: sceneryDetail,
			settings: params.sceneryMeshes,
			wireframe: params.sceneryWireframe,
			shadowTaps: params.shadows.taps.mesh,
		})
		scene.add(sceneryMeshes)
		applySceneryWireframe()
	}

	// Without scenery only the airplane casts shadows.
	sceneryShadows = new SceneryShadows({
		renderer,
		uniforms,
		settings: params.shadows,
		impostorMaterial: assets.impostorMaterial,
	})
	sceneryShadows.setAirplane(plane.model)

	if (worldFeatures.clouds) {
		clouds = new Clouds({
			renderer,
			uniforms,
			settings: params.clouds,
			wireframe: params.sceneryWireframe,
			woodTexture: assets.woodTexture,
			seed: worldSeed,
			isMobile,
		})
		scene.add(clouds)
		cloudShadows = new CloudShadows({
			renderer,
			uniforms,
			settings: params.clouds.shadows,
			shadowSettings: params.shadows,
			clouds,
		})
	}

	// Terrain
	chunkManager = new ChunkManager(
		chunkSize,
		plane,
		params,
		scene,
		uniforms,
		assets,
		worldFeatures,
		worldSeed,
	)
	plane.setTerrainSampler((x, z) =>
		getHeight(x, z, chunkManager.noise, params, chunkManager.biomeOffset),
	)

	/**
	 * Plane
	 */

	plane.position.y = getSpawnAltitude(0, 0)
	scene.add(plane)
	scene.add(plane.trails)
	if (debugFeatures.terrainSamples) {
		terrainSampleDebug = new TerrainSampleDebug(uniforms)
		scene.add(terrainSampleDebug)
	}
	if (debugFeatures.flightPause) {
		flightPause = new FlightPauseDebug({
			plane,
			camera,
			scene,
			domElement: renderer.domElement,
		})
	}

	// start rendering
	requestAnimationFrame(tic)
}

/**
 * Lights
 */
const ambientLight = new THREE.AmbientLight(0xffffff, params.ambientLight)
// DayNight drives color, intensity, and direction of both lights every frame.
const sunLight = new THREE.DirectionalLight(0xffffff, params.directionalLight)
const moonLight = new THREE.DirectionalLight(0xffffff, 0)
scene.add(ambientLight, sunLight, moonLight)

/**
 * Three js Timer
 */
const timer = new THREE.Timer()
timer.connect(document)

// Fog and background colors follow the day/night horizon color; radialFog.js
// measures fog distance from the eye.
scene.fog = new THREE.Fog(0x000000, params.fog.near, params.fog.far)
scene.background = new THREE.Color()

const dayNight = new DayNight({
	scene,
	camera,
	ambientLight,
	sunLight,
	moonLight,
	uniforms,
	params,
})

/**
 * frame loop
 */
function tic(timestamp) {
	frameStats.beginFrame(timestamp)
	timer.update(timestamp)

	/**
	 * tempo trascorso dal frame precedente
	 */
	const deltaTime = timer.getDelta()
	/**
	 * tempo totale trascorso dall'inizio
	 */
	const time = timer.getElapsed()

	// The debug pause freezes only the flight; global time keeps advancing.
	const isFlightPaused = flightPause?.paused ?? false
	if (isFlightPaused) flightPause.update()
	// The timer's first delta after the tab is shown again can be negative.
	else plane.update(THREE.MathUtils.clamp(deltaTime, 0, 0.016))
	terrainSampleDebug?.update(plane.flightCorridor?.samples)
	frameStats.mark('flight')

	// update uniforms values
	uniforms.uTime.value = time
	uniforms.uCamera.value.copy(plane.position)

	const dayNightState = dayNight.update(deltaTime)
	plane.setDayNight(dayNightState)
	frameStats.mark('dayNight')

	chunkManager.updateChunks()
	frameStats.mark('chunks')
	// After this frame's scenery commits, with the camera that renders it.
	sceneryMeshes?.update(chunkManager.chunks, chunkSize, camera)
	frameStats.mark('scenery')
	clouds?.update(plane.position, camera)
	frameStats.mark('clouds')
	// Shadow maps for this frame's scenery and airplane pose, before the main pass.
	sceneryShadows.update(chunkManager.chunks, chunkSize, plane, dayNightState)
	// After SceneryShadows picked the shadowing light.
	cloudShadows?.update(sceneryShadows.light, plane)
	frameStats.mark('shadows')

	// The GUI speedEffect slider holds post-processing at least at that level,
	// even while the flight is paused.
	postProcessing.setSpeedEffect(
		Math.max(
			isFlightPaused ? 0 : plane.uniforms.uAcceleration.value,
			params.speedEffect,
		),
	)
	postProcessing.render(deltaTime)
	frameStats.mark('render')
	frameStats.endFrame()

	requestAnimationFrame(tic)
}

window.addEventListener('resize', handleResize)

function handleResize() {
	sizes.width = window.innerWidth
	sizes.height = window.innerHeight

	camera.aspect = sizes.width / sizes.height
	camera.updateProjectionMatrix()

	const pixelRatio = Math.min(window.devicePixelRatio, 2)
	renderer.setPixelRatio(pixelRatio)
	// Also resizes the renderer; buffers follow the drawing-buffer size, so pixel ratio must be set first.
	postProcessing.setSize(sizes.width, sizes.height)
}
