import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { FlyControls } from 'three/examples/jsm/controls/FlyControls'
import * as dat from 'lil-gui'
import Chunk from './src/chunk'
import ChunkManager from './src/chunkManager'
import { getHeight } from './src/chunkGeometry'
import Plane from './src/plane'
import PostProcessing from './src/postProcessing'
import TerrainSampleDebug from './src/terrainSampleDebug'
import airplane from '/airplane/scene.gltf?url'
import audioSrc from './src/audio/epic-soundtrack.mp3'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import normalMapSrc from './src/textures/normal.jpg'
import gsap from 'gsap'

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
	trees: false,
	clouds: false,
	boats: false,
})
const debugFeatures = Object.freeze({
	terrainSamples: urlParams.get('debug') === '1',
})

const assets = {
	planeModel: null,
	normalMap: null,
	boatModel: null,
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

const textureLoader = new THREE.TextureLoader(loaderManager)
const gltfLoader = new GLTFLoader(loaderManager)
const audioLoader = new THREE.AudioLoader(loaderManager)

audioLoader.load(audioSrc, (buffer) => {
	const listener = new THREE.AudioListener()
	const sound = new THREE.Audio(listener)
	sound.setBuffer(buffer)
	sound.setLoop(true)
	sound.setVolume(0.1)
	assets.soundtrack = sound

	camera.add(listener)
})

if (worldFeatures.trees) {
	assets.normalMap = textureLoader.load(normalMapSrc)
}

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
	directionalLight: 6,
	ambientLight: 1.5,
	amplitude: 23,
	frequency: {
		x: 0.5,
		z: 0.5,
	},
	xOffset: 0,
	zOffset: 0,
	octaves: 3,
	lacunarity: 2,
	persistance: 0.5,
	LOD: 0,
	fog: 0x191362,
	colors: {
		uGrass: '#6d976d',
		uLand: '#5e551d',
		uRocks: '#521f00',
	},
	postProcessing: {
		// Minimum effect intensity; lets the GUI hold the effect on while tuning.
		preview: 0,
		// Radii: 0 = viewport center, ~0.71 = edge midpoints, 1 = corners.
		blur: { strength: 0.015, start: 0.05, end: 1, curve: 1.5 },
		aberration: { strength: 0.02, start: 0.1, end: 1, curve: 2 },
	},
	trails: {
		ribbonWidth: 9.6,
		lineWidth: 0.98,
		borderWidth: 0.065,
		outerEdge: { frequency: 2.7, amplitude: 0.475 },
		innerEdge: { frequency: 2.1, amplitude: 0.325 },
		oscillation: { frequency: 0.03, amplitude: 0.3 },
	},
}

const uniforms = {
	uTime: { value: 0 },
	uRocksColor: { value: new THREE.Color('brown') },
	uCamera: { value: new THREE.Vector3() },
	uLand: { value: new THREE.Color(params.colors.uLand) },
	uGrass: { value: new THREE.Color(params.colors.uGrass) },
	uRocks: { value: new THREE.Color(params.colors.uRocks) },
}

if (gui) {
	gui.add(params, 'speedEffect', 0, 1, 0.01).onChange((val) => {
		plane.updateSpeedEffect(val)
	})

	gui.addColor(params, 'fog').onChange((val) => {
		scene.background.set(val)
		scene.fog.color.set(val)
	})

	gui.addColor(params.colors, 'uGrass').onChange((val) => {
		uniforms.uGrass.value.set(val)
	})

	gui.addColor(params.colors, 'uLand').onChange((val) => {
		uniforms.uLand.value.set(val)
	})

	gui.addColor(params.colors, 'uRocks').onChange((val) => {
		uniforms.uRocks.value.set(val)
	})

	gui
		.add(params, 'amplitude', 0, 100, 0.1)
		.onChange(() => chunkManager.onParamsChange())
	// gui.add(params, 'LOD', 0, 4, 1).onChange((val) => chunk.updateLOD(val))
	gui
		.add(params, 'octaves', 1, 10, 1)
		.onChange(() => chunkManager.onParamsChange())
	gui
		.add(params, 'persistance', 0, 1, 0.05)
		.onChange(() => chunkManager.onParamsChange())

	gui
		.add(params, 'lacunarity', 1, 5, 0.5)
		.onChange(() => chunkManager.onParamsChange())

	gui
		.add(params.frequency, 'x', 0.01, 2, 0.01)
		.onChange(() => chunkManager.onParamsChange())
		.onChange(() => chunkManager.onParamsChange())
	gui
		.add(params.frequency, 'z', 0.01, 2, 0.01)
		.onChange(() => chunkManager.onParamsChange())
	gui
		.add(params, 'xOffset', -10, 10, 0.1)
		.onChange(() => chunkManager.onParamsChange())
		.onChange(() => chunkManager.onParamsChange())
	gui
		.add(params, 'zOffset', -10, 10, 0.1)
		.onChange(() => chunkManager.onParamsChange())

	gui
		.add(params, 'directionalLight', 0, 10, 0.1)
		.onChange((val) => (directionalLight.intensity = val))
	gui
		.add(params, 'ambientLight', 0, 10, 0.1)
		.onChange((val) => (ambientLight.intensity = val))

	const updatePost = () =>
		postProcessing.speedEffect.setParams(params.postProcessing)
	const speedFolder = gui.addFolder('Speed effect')
	speedFolder.add(params.postProcessing, 'preview', 0, 1, 0.01)
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
let chunkManager, plane, terrainSampleDebug

window.__INFINITE_WORLD__ = Object.freeze({
	getChunkStats: () => chunkManager?.getStats() ?? null,
	getFlightStats: () => plane?.getStats() ?? null,
	getPostProcessingStats: () => postProcessing.getStats(),
})

function init(assets) {
	plane = new Plane(assets.planeModel, null, params, camera)

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
	plane.setTerrainSampler((x, z) => getHeight(x, z, chunkManager.noise, params))

	/**
	 * Plane
	 */

	plane.position.y =
		Math.max(getHeight(0, 0, chunkManager.noise, params), 0) + 60
	scene.add(plane)
	scene.add(plane.trails)
	if (debugFeatures.terrainSamples) {
		terrainSampleDebug = new TerrainSampleDebug(uniforms)
		scene.add(terrainSampleDebug)
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
const directionalLight = new THREE.DirectionalLight(
	0xffffff,
	params.directionalLight,
)
directionalLight.position.set(1, 1, 1)
scene.add(ambientLight, directionalLight)

/**
 * Three js Timer
 */
const timer = new THREE.Timer()
timer.connect(document)

scene.fog = new THREE.Fog(params.fog, 250, 900)
scene.background = new THREE.Color(params.fog)
// scene.background = new THREE.Color('white')

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

	plane.update(Math.min(deltaTime, 0.016))
	terrainSampleDebug?.update(plane.flightCorridor?.samples)
	// camera.position.copy(plane.position.clone())
	// camera.position.z += -20
	// camera.position.y += 10
	// camera.lookAt(plane.position)

	// update uniforms values
	uniforms.uTime.value = time
	uniforms.uCamera.value.copy(plane.position)

	chunkManager.updateChunks()

	// controls.update(deltaTime)

	postProcessing.setSpeedEffect(plane.uniforms.uAcceleration.value)
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
