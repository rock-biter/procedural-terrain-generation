import './style.css'
import * as THREE from 'three'
// Patches the fog shader chunk before any material compiles.
import './src/radialFog'
import * as dat from 'lil-gui'
import Chunk, { CURVATURE } from './src/chunk'
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
	TERRAIN_BANDS,
	updateTerrainNormalUniforms,
} from './src/terrainNormals'
import { bakeImpostorAtlas } from './src/impostors/impostorBaker'
import {
	createImpostorMaterial,
	setImpostorAtlas,
} from './src/impostors/impostorMaterial'
import {
	IMPOSTOR_FRAMES_DESKTOP,
	IMPOSTOR_FRAMES_MOBILE,
} from './src/impostors/impostorTypes'
import SceneryMeshes from './src/impostors/sceneryMeshes'
import { createSceneryMeshSettings } from './src/sceneryMeshPolicy'
import { isDebugEnabled } from './src/debugPolicy'
import FlightPauseDebug from './src/flightPauseDebug'
import Plane from './src/plane'
import PostProcessing from './src/postProcessing'
import TerrainSampleDebug from './src/terrainSampleDebug'
import {
	SCENERY_CATEGORIES,
	SCENERY_CELL_SIZES,
	SCENERY_TYPE_KEYS,
	createScenerySettings,
} from './src/sceneryPlacement'
import airplane from '/airplane/scene.gltf?url'
import audioSrc from './src/audio/epic-soundtrack.mp3'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import gsap from 'gsap'
import woodGrainSrc from './src/textures/white_oak/white_oak_veneer_diff_1k.jpg'

const loadingEl = document.getElementById('loader')
const progressEl = document.getElementById('progress')
const playEl = document.getElementById('play')
const toggleEl = document.getElementById('sound-toggle')
const cameraTarget = new THREE.Vector3(0, 6.9, 0)
let volume = true
const isMobile = window.innerWidth < 768
const urlParams = new URLSearchParams(window.location.search)
const worldSeed = urlParams.get('seed') ?? `${Date.now()}-${Math.random()}`
const worldFeatures = Object.freeze({
	scenery: true,
	clouds: false,
	boats: false,
})
const debugFeatures = Object.freeze({
	terrainSamples: isDebugEnabled(urlParams),
	flightPause: isDebugEnabled(urlParams),
})

const assets = {
	planeModel: null,
	boatModel: null,
	impostorMaterial: null,
	woodTexture: null,
	soundtrack: null,
}

const loaderManager = new THREE.LoadingManager()
loaderManager.onLoad = () => {
	// console.log('load!')

	gsap.set('canvas', { autoAlpha: 0 })

	toggleEl.addEventListener('click', () => {
		volume = !volume

		assets.soundtrack.setVolume(volume ? 0.1 : 0)
		gsap.to(toggleEl, { opacity: volume ? 1 : 0.4, duration: 0.2 })
		// gsap.to(assets.soundtrack, { volume: volume ? 0.1 : 0, duration: 1 })
	})

	gsap.to(loadingEl, {
		autoAlpha: 0,
		duration: 1,
		onComplete: () => {
			init(assets)

			gsap.to(playEl, {
				autoAlpha: 1,
				duration: 0.5,
				onComplete: () => {
					playEl.addEventListener('click', () => {
						if (!gui) {
							assets.soundtrack.play()
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
								ease: 'expo3.out',
								z: isMobile ? -16 : -18,
								// z: 20,
								// y: -2,
								// x: 0,
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
	// console.log(progress)
}

loaderManager.onStart = () => {
	gsap.to(loadingEl, { autoAlpha: 1, duration: 0 })
}

const gltfLoader = new GLTFLoader(loaderManager)
const audioLoader = new THREE.AudioLoader(loaderManager)
const textureLoader = new THREE.TextureLoader(loaderManager)

if (worldFeatures.scenery) {
	// White oak veneer color map, baked into every impostor's albedo and
	// sampled by the near scenery meshes.
	assets.woodTexture = textureLoader.load(woodGrainSrc)
	assets.woodTexture.colorSpace = THREE.SRGBColorSpace
	assets.woodTexture.wrapS = THREE.RepeatWrapping
	assets.woodTexture.wrapT = THREE.RepeatWrapping
}

audioLoader.load(audioSrc, (buffer) => {
	const listener = new THREE.AudioListener()
	const sound = new THREE.Audio(listener)
	sound.setBuffer(buffer)
	sound.setLoop(true)
	sound.setVolume(0.1)
	assets.soundtrack = sound

	camera.add(listener)
})

if (worldFeatures.boats) {
	gltfLoader.load('/boat/scene.gltf', (gltf) => {
		// console.log('boat', gltf)

		const model = gltf.scene.children[0].children[0]
		model.scale.setScalar(1.3)
		// model.scale.setScalar(0.1)
		model.rotation.x = 0

		assets.boatModel = model
	})
}

gltfLoader.load(airplane, (gltf) => {
	gltf.scene.traverse((el) => {
		if (el instanceof THREE.Mesh) {
			el.scale.setScalar(0.005)
			el.geometry.center()
			el.geometry.rotateX(-Math.PI * 0.5)
			el.name = 'plane'
			assets.planeModel = el

			// plane.model = el
			// plane.add(el)
		}
	})

	// console.log(gltf.scene)
})

/**
 * Debug
 */
let gui
if (urlParams.get('gui') === '1') gui = new dat.GUI()

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
	xOffset: 0,
	zOffset: 0,
	octaves: 3,
	lacunarity: 2,
	persistance: 0.5,
	// Desert detail topography and progressive height reduction; see
	// DESERT_TERRAIN_DEFAULTS.
	desert: { ...DESERT_TERRAIN_DEFAULTS },
	LOD: 0,
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
	toneMapping: { mode: THREE.NoToneMapping, exposure: 1 },
	postProcessing: {
		// Minimum effect intensity; lets the GUI hold the effect on while tuning.
		preview: 0,
		// Edge blur and aberration always shown, as for a speed effect of this
		// value; boosting animates the rest. 0 restores the idle bypass. The
		// camera FOV kick ignores it.
		idleSpeedEffect: 0.4,
		// Static screen-space grain; intensity is the maximum brightness change
		// (0.05 = ±5%). 0 skips the overlay pass.
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
	impostorVariation: {
		frequency: 0.01,
		amount: Object.fromEntries(
			Object.values(SCENERY_TYPE_KEYS).map((key) => [key, 0.8]),
		),
	},
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
	uRocksColor: { value: new THREE.Color('brown') },
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
}
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
// Wood detail shared by the near meshes; the bake reads params.impostorDetail.
// The texture is assigned in init().
const sceneryDetail = {
	uDetail: { value: null },
	uDetailScale: { value: params.impostorDetail.scale },
	uDetailColor: { value: params.impostorDetail.color },
}

if (gui) {
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
	terrainFolder
		.add(params, 'amplitude', 0, 100, 0.1)
		.onChange(() => chunkManager.onParamsChange())
	// gui.add(params, 'LOD', 0, 4, 1).onChange((val) => chunk.updateLOD(val))
	terrainFolder
		.add(params, 'octaves', 1, 10, 1)
		.onChange(() => chunkManager.onParamsChange())
	terrainFolder
		.add(params, 'persistance', 0, 1, 0.05)
		.onChange(() => chunkManager.onParamsChange())

	terrainFolder
		.add(params, 'lacunarity', 1, 5, 0.5)
		.onChange(() => chunkManager.onParamsChange())

	terrainFolder
		.add(params.frequency, 'x', 0.01, 2, 0.01)
		.onChange(() => chunkManager.onParamsChange())
		.onChange(() => chunkManager.onParamsChange())
	terrainFolder
		.add(params.frequency, 'z', 0.01, 2, 0.01)
		.onChange(() => chunkManager.onParamsChange())
	terrainFolder
		.add(params, 'xOffset', -10, 10, 0.1)
		.onChange(() => chunkManager.onParamsChange())
		.onChange(() => chunkManager.onParamsChange())
	terrainFolder
		.add(params, 'zOffset', -10, 10, 0.1)
		.onChange(() => chunkManager.onParamsChange())

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
		.onFinishChange(() => chunkManager.onParamsChange())
	desertFolder
		.add(params.desert, 'amplitude', 0, 2, 0.01)
		.name('Detail amplitude ×')
		.onFinishChange(() => chunkManager.onParamsChange())
	desertFolder
		.add(params.desert, 'blend', 0.01, 0.4, 0.005)
		.name('Blend width')
		.onFinishChange(() => chunkManager.onParamsChange())
	desertFolder
		.add(params.desert, 'flatten', 0, 1, 0.01)
		.name('Height reduction')
		.onFinishChange(() => chunkManager.onParamsChange())
	desertFolder
		.add(params.desert, 'depth', 0.01, 1.5, 0.01)
		.name('Reduction depth')
		.onFinishChange(() => chunkManager.onParamsChange())

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
	speedFolder.add(params, 'speedEffect', 0, 1, 0.01).onChange((val) => {
		plane.updateSpeedEffect(val)
	})
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
 * BOX
 */
// const material = new THREE.MeshNormalMaterial()
// const geometry = new THREE.BoxGeometry(1, 1, 1)

// const mesh = new THREE.Mesh(geometry, material)
// scene.add(mesh)

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
const camera = new THREE.PerspectiveCamera(
	fov,
	sizes.width / sizes.height,
	0.1,
	10000,
)
camera.position.set(0, 7, -1)
camera.zoom = isMobile ? 0.8 : 1
// camera.position.set(0, 7, -18)
// camera.position.set(0, 0, 15)
// camera.position.set(0, 2500, -18)
camera.lookAt(cameraTarget)
// camera.lookAt(0, 0, 0)
// camera.rotateY(Math.PI)

/**
 * Show the axes of coordinates system
 */
const axesHelper = new THREE.AxesHelper(3)
// scene.add(axesHelper)

/**
 * renderer
 */
const renderer = new THREE.WebGLRenderer({
	antialias: true, //window.devicePixelRatio < 2,
	logarithmicDepthBuffer: true,
})
renderer.toneMapping = params.toneMapping.mode
renderer.toneMappingExposure = params.toneMapping.exposure
document.body.appendChild(renderer.domElement)
const postProcessing = new PostProcessing(
	renderer,
	scene,
	camera,
	params.postProcessing,
)
handleResize()

/**
 * OrbitControls
 */
// const controls = new OrbitControls(camera, renderer.domElement)
// controls.enableDamping = true
// controls.screenSpacePanning = false
// const controls = new FlyControls(camera, renderer.domElement)
// controls.movementSpeed = 50
// controls.rollSpeed = 0.75

/**
 * Plane
 */

// const plane = new Plane()

// /**
//  * Terrain chunk
//  */
const chunkSize = 256

// const chunkManager = new ChunkManager(chunkSize, plane, params, scene, uniforms)

// plane.position.y = Math.max(getHeight(0, 0, chunkManager.noise, params), 0) + 60
// scene.add(plane)
// plane.camera = camera
// plane.add(camera)
let chunkManager, plane, terrainSampleDebug, flightPause, sceneryMeshes

window.__INFINITE_WORLD__ = Object.freeze({
	getChunkStats: () => chunkManager?.getStats() ?? null,
	getFlightStats: () => plane?.getStats() ?? null,
	getPostProcessingStats: () => postProcessing.getStats(),
	getDebugStats: () => flightPause?.getStats() ?? null,
	getDayNightStats: () => dayNight.getStats(),
	getSceneryMeshStats: () => sceneryMeshes?.getStats() ?? null,
})

// Bakes every scenery type into the impostor atlas, with the wood detail.
function bakeImpostors() {
	return bakeImpostorAtlas(renderer, {
		frames: isMobile ? IMPOSTOR_FRAMES_MOBILE : IMPOSTOR_FRAMES_DESKTOP,
		frameSize: 64,
		detail: { texture: assets.woodTexture, ...params.impostorDetail },
	})
}

function init(assets) {
	plane = new Plane(assets.planeModel, null, params, camera)

	if (worldFeatures.scenery) {
		assets.impostorMaterial = createImpostorMaterial(
			bakeImpostors(),
			uniforms,
			{ singleFrame: isMobile, variation: impostorVariation },
		)
		sceneryDetail.uDetail.value = assets.woodTexture
		sceneryMeshes = new SceneryMeshes({
			uniforms,
			variation: impostorVariation,
			detail: sceneryDetail,
			settings: params.sceneryMeshes,
		})
		scene.add(sceneryMeshes)
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

	plane.position.y =
		Math.max(
			getHeight(0, 0, chunkManager.noise, params, chunkManager.biomeOffset),
			0,
		) + 60
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
	// plane.addCamera(camera)
	// plane.camera = camera
	// plane.add(camera)

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
// scene.background = new THREE.Color('white')

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
	else plane.update(Math.min(deltaTime, 0.016))
	terrainSampleDebug?.update(plane.flightCorridor?.samples)
	// camera.position.copy(plane.position.clone())
	// camera.position.z += -20
	// camera.position.y += 10
	// camera.lookAt(plane.position)

	// update uniforms values
	uniforms.uTime.value = time
	uniforms.uCamera.value.copy(plane.position)

	plane.setDayNight(dayNight.update(deltaTime))

	chunkManager.updateChunks()
	// After this frame's scenery commits, with the camera that renders it.
	sceneryMeshes?.update(chunkManager.chunks, chunkSize, camera)

	// controls.update(deltaTime)

	// The GUI speedEffect slider holds post-processing at least at that level,
	// even while the flight is paused.
	postProcessing.setSpeedEffect(
		Math.max(
			isFlightPaused ? 0 : plane.uniforms.uAcceleration.value,
			params.speedEffect,
		),
	)
	postProcessing.render(deltaTime)

	requestAnimationFrame(tic)
}

// requestAnimationFrame(tic)

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
