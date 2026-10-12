import { Effect, Pass } from 'postprocessing'
import {
	Color,
	DataUtils,
	HalfFloatType,
	NearestFilter,
	NoBlending,
	ShaderMaterial,
	Uniform,
	UnsignedByteType,
	Vector3,
	Vector4,
	WebGLRenderTarget,
} from 'three'
import fragmentShader from './shaders/lens-flare-fragment.glsl'
import visibilityFragmentShader from './shaders/lens-flare-visibility-fragment.glsl'
import fullscreenVertexShader from './shaders/fullscreen-vertex.glsl'
import {
	LENS_FLARE_TAPS,
	getLensFlareGate,
	getOcclusionRadiusUv,
	getScreenEdgeFade,
	getSunScreenPosition,
	getTemporalBlend,
} from './lensFlarePolicy'

// getStats() reads the occlusion back at most this often, and only while
// someone asks for it (the ?gui=1 readouts, the stats API).
const READBACK_INTERVAL_MS = 250
const READBACK_IDLE_MS = 2000
// Scratch array for the sun's direction.
const SUN_DIRECTION = [0, 1, 0]

// The share of the sun's disc the scene leaves on the sky, in one texel of a
// ping-pong pair: each frame blends the new count with the other texel's, so
// the flare eases in and out (lens-flare-visibility-fragment.glsl).
class VisibilityPass extends Pass {
	constructor(sunScreen) {
		super('LensFlareVisibility')
		this.needsSwap = false
		this.fullscreenMaterial = new ShaderMaterial({
			name: 'LensFlareVisibilityMaterial',
			defines: { LENS_FLARE_TAPS: String(LENS_FLARE_TAPS) },
			uniforms: {
				depthBuffer: new Uniform(null),
				previousVisibility: new Uniform(null),
				sunScreen,
				history: new Uniform(0),
			},
			vertexShader: fullscreenVertexShader,
			fragmentShader: visibilityFragmentShader,
			blending: NoBlending,
			depthWrite: false,
			depthTest: false,
		})
		this.targets = [0, 1].map((index) => {
			const target = new WebGLRenderTarget(1, 1, {
				depthBuffer: false,
				minFilter: NearestFilter,
				magFilter: NearestFilter,
				generateMipmaps: false,
			})
			target.texture.name = `LensFlare.Visibility${index}`
			return target
		})
		this.current = 0
	}

	// Data, not color: half float where it can be rendered, so the smoothing
	// reaches its target; never sRGB.
	initialize(renderer) {
		const type = renderer.extensions.has('EXT_color_buffer_float')
			? HalfFloatType
			: UnsignedByteType
		for (const target of this.targets) {
			if (target.texture.type === type) continue
			target.texture.type = type
			target.dispose()
		}
	}

	// Renders this frame's visibility from `depthTexture`, weighing the
	// previous one by `history`, and returns its target.
	renderVisibility(renderer, depthTexture, history) {
		const { uniforms } = this.fullscreenMaterial
		uniforms.depthBuffer.value = depthTexture
		uniforms.previousVisibility.value = this.targets[this.current].texture
		uniforms.history.value = history
		this.current = 1 - this.current
		const target = this.targets[this.current]
		renderer.setRenderTarget(target)
		renderer.render(this.scene, this.camera)
		return target
	}

	dispose() {
		super.dispose()
		for (const target of this.targets) target.dispose()
	}
}

// The sun's lens flare (rules in src/lensFlarePolicy.js, composite in
// lens-flare-fragment.glsl). Every frame update() projects the sun through the
// camera, counts how much of its disc the scene's depth leaves on the sky, and
// writes the element uniforms from the live settings, so the ?gui=1 panel
// needs no apply call. The flare is off while the sun is behind the camera,
// below the sky disc's fade, or off screen.
//
// `camera` renders the scene, `settings` is params.postProcessing.lensFlare
// (createLensFlareSettings()), and `sun` is PostProcessing's { direction,
// color (linear), discVisibility }, written every frame. update() needs a depth
// texture on the input buffer (PostProcessing.createComposer()). The depth
// texture lives only in uniforms: Effect.dispose() would dispose a texture
// property, and the composer owns it.
export default class LensFlareEffect extends Effect {
	constructor(camera, settings, sun) {
		const sunScreen = new Uniform(new Vector4(0.5, 0.5, 0, 0))
		super('LensFlareEffect', fragmentShader, {
			defines: new Map([['LENS_FLARE_TAPS', String(LENS_FLARE_TAPS)]]),
			uniforms: new Map([
				['visibilityBuffer', new Uniform(null)],
				['occlusionDepth', new Uniform(null)],
				['sunScreen', sunScreen],
				['flareColor', new Uniform(new Color(0, 0, 0))],
				['glowParams', new Uniform(new Vector3())],
				['starParams', new Uniform(new Vector4())],
				['starRotation', new Uniform(0)],
				['ghostParams', new Uniform(new Vector3())],
				['haloParams', new Uniform(new Vector3())],
				['debugTaps', new Uniform(0)],
			]),
		})

		this.camera = camera
		this.settings = settings
		this.sun = sun
		this.visibilityPass = new VisibilityPass(sunScreen)
		// False until a frame with the flare on, so it never eases in from a
		// stale texel.
		this.historyValid = false
		this.missingDepthWarned = false
		this.screen = { u: 0.5, v: 0.5, inFront: false }
		this.radius = { u: 0, v: 0 }
		this.gate = 0
		this.edgeFade = 0
		this.visibility = 0
		this.lastStatsRequest = -Infinity
		this.lastReadback = -Infinity
		this.readbackPending = false
		this.readbackHalf = new Uint16Array(4)
		this.readbackByte = new Uint8Array(4)
	}

	update(renderer, inputBuffer, deltaTime) {
		const { settings, sun, camera, uniforms } = this
		const projection = camera.projectionMatrix.elements
		const screen = getSunScreenPosition(
			sun.direction.toArray(SUN_DIRECTION),
			camera.matrixWorldInverse.elements,
			projection,
			this.screen,
		)
		const radius = getOcclusionRadiusUv(projection, settings.occlusionRadius, this.radius)
		this.edgeFade = getScreenEdgeFade(screen.u, screen.v, radius.u, radius.v, settings.edgeMargin)
		let gate = getLensFlareGate(settings, sun.discVisibility, screen, this.edgeFade)
		const depthTexture = inputBuffer.depthTexture
		if (!depthTexture && gate > 0) {
			if (!this.missingDepthWarned)
				console.warn('Lens flare: the input buffer has no depth texture')
			this.missingDepthWarned = true
			gate = 0
		}
		this.gate = gate
		if (gate <= 0) {
			uniforms.get('flareColor').value.setRGB(0, 0, 0)
			this.historyValid = false
			this.visibility = 0
			return
		}

		uniforms.get('sunScreen').value.set(screen.u, screen.v, radius.u, radius.v)
		const history = this.historyValid ? getTemporalBlend(deltaTime, settings.smoothing) : 0
		const target = this.visibilityPass.renderVisibility(renderer, depthTexture, history)
		this.historyValid = true
		uniforms.get('visibilityBuffer').value = target.texture
		uniforms.get('occlusionDepth').value = depthTexture

		const { glow, starburst, ghosts, halo } = settings
		uniforms
			.get('flareColor')
			.value.copy(sun.color)
			.multiplyScalar(settings.intensity * gate)
		uniforms.get('glowParams').value.set(glow.intensity, Math.max(glow.size, 1e-3), glow.falloff)
		uniforms
			.get('starParams')
			.value.set(
				starburst.intensity,
				Math.max(starburst.size, 1e-3),
				Math.max(Math.round(starburst.rays), 1),
				Math.max(starburst.sharpness, 1),
			)
		uniforms.get('starRotation').value = starburst.rotation
		uniforms
			.get('ghostParams')
			.value.set(ghosts.intensity, Math.max(ghosts.size, 1e-3), ghosts.spacing)
		uniforms.get('haloParams').value.set(halo.intensity, halo.radius, Math.max(halo.width, 1e-3))
		uniforms.get('debugTaps').value = settings.debug.showTaps ? 1 : 0
		this.readVisibility(renderer, target)
	}

	// Reads the occlusion texel back without stalling, for getStats().
	readVisibility(renderer, target) {
		const now = performance.now()
		if (
			this.readbackPending ||
			now - this.lastStatsRequest > READBACK_IDLE_MS ||
			now - this.lastReadback < READBACK_INTERVAL_MS
		) {
			return
		}
		this.readbackPending = true
		this.lastReadback = now
		const half = target.texture.type === HalfFloatType
		const buffer = half ? this.readbackHalf : this.readbackByte
		renderer
			.readRenderTargetPixelsAsync(target, 0, 0, 1, 1, buffer)
			.then(() => {
				this.visibility = half ? DataUtils.fromHalfFloat(buffer[0]) : buffer[0] / 255
			})
			// A rebuilt composer disposed the target; the next read starts over.
			.catch(() => {})
			.finally(() => {
				this.readbackPending = false
			})
	}

	initialize(renderer, alpha, frameBufferType) {
		super.initialize(renderer, alpha, frameBufferType)
		this.visibilityPass.initialize(renderer)
	}

	// Compiles the occlusion pass, which otherwise first draws when the sun
	// comes into view in flight, against its own target.
	compileAsync(renderer) {
		const { scene, camera, targets } = this.visibilityPass
		const previousTarget = renderer.getRenderTarget()
		renderer.setRenderTarget(targets[0])
		const compiled = renderer.compileAsync(scene, camera)
		renderer.setRenderTarget(previousTarget)
		return compiled
	}

	getStats() {
		this.lastStatsRequest = performance.now()
		return {
			enabled: this.settings.enabled,
			gate: this.gate,
			inFront: this.screen.inFront,
			screen: [this.screen.u, this.screen.v],
			discVisibility: this.sun.discVisibility,
			edgeFade: this.edgeFade,
			// Visible share of the sun's disc, read back a few times a second.
			visibility: this.gate > 0 ? this.visibility : 0,
			taps: LENS_FLARE_TAPS,
		}
	}
}
