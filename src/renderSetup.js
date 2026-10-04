import {
	AmbientLight,
	Color,
	DirectionalLight,
	Fog,
	PerspectiveCamera,
	Scene,
	Vector3,
	WebGLRenderer,
} from 'three'
import { AdaptivePixelRatio, getMaxPixelRatio, parsePixelRatio } from './adaptivePixelRatio'
import FrameStats from './frameStats'
import PostProcessing from './postProcessing'

// Where the camera looks while the Play button waits; src/intro.js then pulls
// it back behind the airplane.
const CAMERA_TARGET = new Vector3(0, 6.9, 0)

// The renderer and what every frame renders through: scene, lights, fog,
// camera, the post-processing chain, the frame telemetry, and the adaptive
// pixel ratio, kept in step with the window size. `params` is
// createAppParams(); `urlParams` supplies ?dpr=.
export default class RenderSetup {
	constructor({ params, urlParams, isMobile = false }) {
		// The scene always renders through PostProcessing's offscreen chain, whose
		// 2x MSAA buffer is the only antialiasing. The canvas only receives the
		// finished full-screen composite, so it needs neither MSAA nor depth. It is
		// created before the asset requests: the KTX2 loader picks its GPU format
		// from it. The depth buffer is the standard one: a logarithmic depth buffer
		// makes every material write gl_FragDepth, which disables early depth
		// rejection, so hidden terrain would still run its whole fragment shader
		// (camera near plane below). On laptops with two GPUs, high-performance asks
		// for the discrete one.
		this.renderer = new WebGLRenderer({
			antialias: false,
			depth: false,
			powerPreference: 'high-performance',
		})
		this.renderer.toneMapping = params.toneMapping.mode
		this.renderer.toneMappingExposure = params.toneMapping.exposure
		document.body.appendChild(this.renderer.domElement)

		this.scene = new Scene()
		// Fog and background colors follow the day/night horizon color; radialFog.js
		// measures fog distance from the eye.
		this.scene.fog = new Fog(0x000000, params.fog.near, params.fog.far)
		this.scene.background = new Color()

		this.ambientLight = new AmbientLight(0xffffff, params.ambientLight)
		// DayNight drives color, intensity, and direction of both lights every frame.
		this.sunLight = new DirectionalLight(0xffffff, params.directionalLight)
		this.moonLight = new DirectionalLight(0xffffff, 0)
		this.scene.add(this.ambientLight, this.sunLight, this.moonLight)

		this.sizes = { width: window.innerWidth, height: window.innerHeight }
		// Near 1 keeps the 24-bit depth step under 0.25 units out to the fog end
		// (about 2000 units); nothing comes within one unit of the chase camera.
		this.camera = new PerspectiveCamera(
			isMobile ? 80 : 60,
			this.sizes.width / this.sizes.height,
			1,
			10000,
		)
		this.camera.position.set(0, 7, -1)
		this.camera.zoom = isMobile ? 0.8 : 1
		this.camera.lookAt(CAMERA_TARGET)

		this.postProcessing = new PostProcessing(
			this.renderer,
			this.scene,
			this.camera,
			params.postProcessing,
		)
		// Frame time, stage time, draw counters, and GPU time for getRenderStats().
		this.frameStats = new FrameStats(this.renderer)
		// `?dpr=` replaces the display's (capped) ratio as the maximum.
		this.pinnedPixelRatio = parsePixelRatio(urlParams)
		this.adaptivePixelRatio = new AdaptivePixelRatio(params.pixelRatio, this.getMaxPixelRatio())

		this.handleResize = this.handleResize.bind(this)
		this.handleResize()
		window.addEventListener('resize', this.handleResize)
	}

	getMaxPixelRatio() {
		return this.pinnedPixelRatio ?? getMaxPixelRatio(window.devicePixelRatio)
	}

	handleResize() {
		this.sizes.width = window.innerWidth
		this.sizes.height = window.innerHeight

		this.camera.aspect = this.sizes.width / this.sizes.height
		this.camera.updateProjectionMatrix()

		// The window may have moved to a display with another ratio.
		this.adaptivePixelRatio.setMax(this.getMaxPixelRatio())
		this.applyPixelRatio()
	}

	// Feeds a frame's duration to the adaptive ratio; resizes the buffers only
	// when the ratio steps.
	adaptPixelRatio(deltaMs) {
		if (this.adaptivePixelRatio.update(deltaMs) !== null) this.applyPixelRatio()
	}

	applyPixelRatio() {
		this.renderer.setPixelRatio(this.adaptivePixelRatio.ratio)
		// Also resizes the renderer; buffers follow the drawing-buffer size, so pixel ratio must be set first.
		this.postProcessing.setSize(this.sizes.width, this.sizes.height)
	}

	// Applies params.toneMapping.mode; the composer switches its buffer type.
	setToneMapping(mode) {
		this.renderer.toneMapping = mode
		this.postProcessing.updateToneMapping()
	}

	getStats() {
		return {
			...this.frameStats.getStats(),
			adaptivePixelRatio: this.adaptivePixelRatio.getStats(),
		}
	}
}
