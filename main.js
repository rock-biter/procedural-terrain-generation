import './style.css'
import * as THREE from 'three'
import * as dat from 'lil-gui'
import Chunk, { CURVATURE } from './src/chunk'
import ChunkManager from './src/chunkManager'
import DayNight from './src/dayNight'
import { DAY_NIGHT_DEFAULTS, parseTimeOfDay } from './src/dayNightPolicy'
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
import woodGrainSrc from './src/textures/wood.jpg'

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
	// Grayscale detail baked into every impostor (scripts/generate-wood-texture.mjs).
	assets.woodTexture = textureLoader.load(woodGrainSrc)
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
	directionalLight: 6,
	moonLight: 1.2,
	ambientLight: 1.5,
	dayNight: {
		timeOfDay: parseTimeOfDay(urlParams) ?? DAY_NIGHT_DEFAULTS.startTimeOfDay,
		cycleDuration: DAY_NIGHT_DEFAULTS.cycleDuration,
		paused: false,
	},
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
	// Normal map, tile size (world units), and strength per terrain layer;
	// defaults and texture assignment live in TERRAIN_NORMAL_LAYERS.
	terrainNormals: createTerrainNormalSettings(),
	postProcessing: {
		// Minimum effect intensity; lets the GUI hold the effect on while tuning.
		preview: 0,
		// Static screen-space grain; intensity is the maximum brightness change
		// (0.05 = ±5%). 0 skips the overlay pass.
		grain: { intensity: 0.035 },
		// Radii: 0 = viewport center, ~0.71 = edge midpoints, 1 = corners.
		// verticalScale shrinks only the vertical distance (1 = circular falloff).
		verticalScale: 0.78,
		blur: { strength: 0.09, start: 0.35, end: 1.5, curve: 1.2 },
		aberration: { strength: 0.02, start: 0.28, end: 0.9, curve: 2.2 },
	},
	// Placement settings sent to the chunk workers; see createScenerySettings().
	scenery: createScenerySettings({ isMobile }),
	// Shader-side, applied live: brightness change per type in stops (1 = half
	// to double brightness) and the world frequency of the noise that drives it.
	// Wood grain baked into every impostor: repeats per world unit, brightness
	// strength (0.45 = ±45%), and bump height in world units. Changing them
	// re-bakes the atlas.
	impostorDetail: { scale: 0.18, color: 0.45, bump: 0.18 },
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
	...createTerrainNormalUniforms(params.terrainNormals),
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
	dayNightFolder.add(params.dayNight, 'paused').name('Paused')

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
	detailFolder
		.add(params.impostorDetail, 'bump', 0, 0.5, 0.005)
		.name('Bump height')
		.onFinishChange(rebakeImpostors)
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
let chunkManager, plane, terrainSampleDebug, flightPause

window.__INFINITE_WORLD__ = Object.freeze({
	getChunkStats: () => chunkManager?.getStats() ?? null,
	getFlightStats: () => plane?.getStats() ?? null,
	getPostProcessingStats: () => postProcessing.getStats(),
	getDebugStats: () => flightPause?.getStats() ?? null,
	getDayNightStats: () => dayNight.getStats(),
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

// Fog and background colors follow the day/night horizon color.
scene.fog = new THREE.Fog(0x000000, 250, 900)
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
