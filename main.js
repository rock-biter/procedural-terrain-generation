import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { FlyControls } from 'three/examples/jsm/controls/FlyControls'
import * as dat from 'lil-gui'
import Chunk from './src/chunk'
import ChunkManager from './src/chunkManager'
import { getHeight } from './src/chunk'
import Plane from './src/plane'
import airplane from '/airplane/scene.gltf?url'
import boatSrc from '/boat/scene.gltf?url'
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

const assets = {
	planeModel: null,
	normalMap: null,
	boatModel: null,
	soundtrack: null,
}

const loaderManager = new THREE.LoadingManager()
loaderManager.onLoad = () => {
	console.log('load!')

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
						assets.soundtrack.play()
						gsap.fromTo(
							plane,
							{ baseSpeed: 20 },
							{ duration: 1, baseSpeed: 40 }
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
								// onComplete: () => {
								// 	camera.rotateY(Math.PI)
								// },
							}
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
	console.log(progress)
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

assets.normalMap = textureLoader.load(normalMapSrc)

gltfLoader.load(boatSrc, (gltf) => {
	console.log('boat', gltf)

	const model = gltf.scene.children[0].children[0]
	model.scale.setScalar(1.3)
	// model.scale.setScalar(0.1)
	model.rotation.x = 0

	assets.boatModel = model
})

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
// gui = new dat.GUI()

const params = {
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
	10000
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
let chunkManager, plane

function init(assets) {
	plane = new Plane(assets.planeModel, null, params)

	// Terrain
	chunkManager = new ChunkManager(
		chunkSize,
		plane,
		params,
		scene,
		uniforms,
		assets
	)

	/**
	 * Plane
	 */

	plane.position.y =
		Math.max(getHeight(0, 0, chunkManager.noise, params), 0) + 60
	scene.add(plane)
	plane.camera = camera
	plane.add(camera)

	// start rendering
	requestAnimationFrame(tic)
}

/**
 * Lights
 */
const ambientLight = new THREE.AmbientLight(0xffffff, params.ambientLight)
const directionalLight = new THREE.DirectionalLight(
	0xffffff,
	params.directionalLight
)
directionalLight.position.set(1, 1, 1)
scene.add(ambientLight, directionalLight)

/**
 * Three js Clock
 */
const clock = new THREE.Clock()

scene.fog = new THREE.Fog(params.fog, 250, 900)
scene.background = new THREE.Color(params.fog)
// scene.background = new THREE.Color('white')

/**
 * frame loop
 */
function tic() {
	/**
	 * tempo trascorso dal frame precedente
	 */
	const deltaTime = clock.getDelta()
	/**
	 * tempo totale trascorso dall'inizio
	 */
	const time = clock.getElapsedTime()

	plane.update(deltaTime)
	// camera.position.copy(plane.position.clone())
	// camera.position.z += -20
	// camera.position.y += 10
	// camera.lookAt(plane.position)

	// update uniforms values
	uniforms.uTime.value = time
	uniforms.uCamera.value.copy(plane.position)

	chunkManager.updateChunks()

	// controls.update(deltaTime)

	renderer.render(scene, camera)

	requestAnimationFrame(tic)
}

// requestAnimationFrame(tic)

window.addEventListener('resize', handleResize)

function handleResize() {
	sizes.width = window.innerWidth
	sizes.height = window.innerHeight

	camera.aspect = sizes.width / sizes.height
	camera.updateProjectionMatrix()

	renderer.setSize(sizes.width, sizes.height)

	const pixelRatio = Math.min(window.devicePixelRatio, 2)
	renderer.setPixelRatio(pixelRatio)
}
