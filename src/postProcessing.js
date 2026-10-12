import {
	Effect,
	EffectComposer,
	EffectPass,
	RenderPass,
	ToneMappingEffect,
	ToneMappingMode,
} from 'postprocessing'
import {
	ACESFilmicToneMapping,
	AgXToneMapping,
	CineonToneMapping,
	Color,
	DepthTexture,
	HalfFloatType,
	LinearToneMapping,
	MathUtils,
	NeutralToneMapping,
	ReinhardToneMapping,
	RGBAFormat,
	RGBFormat,
	SRGBColorSpace,
	Uniform,
	UnsignedByteType,
	UnsignedInt101111Type,
	Vector3,
} from 'three'
import LensFlareEffect from './lensFlareEffect'
import { getSunDiscVisibility } from './lensFlarePolicy'
import SpeedEffect from './speedEffect'
import filmGrainFragmentShader from './shaders/film-grain-fragment.glsl'

// Three.js only tone maps draws to the canvas, so the offscreen composer path
// applies the renderer's operator with the matching postprocessing mode.
const TONE_MAPPING_MODES = {
	[LinearToneMapping]: ToneMappingMode.LINEAR,
	[ReinhardToneMapping]: ToneMappingMode.REINHARD,
	[CineonToneMapping]: ToneMappingMode.CINEON,
	[ACESFilmicToneMapping]: ToneMappingMode.ACES_FILMIC,
	[AgXToneMapping]: ToneMappingMode.AGX,
	[NeutralToneMapping]: ToneMappingMode.NEUTRAL,
}

// Samples of the scene buffer, the only antialiasing (see createComposer()).
const SCENE_SAMPLES = 2

// Texel type and format of the tone-mapped scene buffers. Tone mapping needs
// the unclamped scene: R11F_G11F_B10F holds it in 4 bytes per sample, half of
// RGBA16F, which halves the multisampled store and resolve, the largest cost
// of the chain. It has no alpha, which nothing reads (the canvas is opaque and
// the effects pass it through). Where it cannot render with `samples`, half
// float: a format that only rounds up to more samples would cost more.
export function getSceneBufferFormat(renderer, samples = SCENE_SAMPLES) {
	const gl = renderer.getContext()
	if (
		renderer.extensions.has('EXT_color_buffer_float') &&
		typeof gl.getInternalformatParameter === 'function'
	) {
		const counts = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.R11F_G11F_B10F, gl.SAMPLES)
		if (counts && Array.prototype.includes.call(counts, samples)) {
			return { type: UnsignedInt101111Type, format: RGBFormat }
		}
	}
	return { type: HalfFloatType, format: RGBAFormat }
}

// Static screen-space grain (film-grain-fragment.glsl). It reads the color in
// display space (sRGB) and runs after tone mapping, as the last effect.
class FilmGrainEffect extends Effect {
	constructor() {
		super('FilmGrainEffect', filmGrainFragmentShader, {
			uniforms: new Map([['intensity', new Uniform(0)]]),
		})
		this.inputColorSpace = SRGBColorSpace
	}

	set intensity(value) {
		this.uniforms.get('intensity').value = value
	}
}

// Every frame renders the scene offscreen and composites it to the canvas in
// one effect pass: the speed effect (edge blur and chromatic aberration, at
// least at the idle level), the sun's lens flare, tone mapping when enabled,
// and film grain.
export default class PostProcessing {
	constructor(renderer, scene, camera, params) {
		this.renderer = renderer
		this.scene = scene
		this.camera = camera
		this.params = params
		this.composer = null
		this.toneMappingEffect = null
		// The sun the lens flare follows, written by setSun(); kept across
		// composer rebuilds.
		this.sun = { direction: new Vector3(0, 1, 0), color: new Color(), discVisibility: 0 }
		this.updateToneMapping()
	}

	// Call after changing renderer.toneMapping; exposure needs no call because
	// the effect reads renderer.toneMappingExposure.
	updateToneMapping() {
		const mode = TONE_MAPPING_MODES[this.renderer.toneMapping]
		const toneMapped = mode !== undefined

		if (this.composer === null || toneMapped !== !!this.toneMappingEffect) {
			this.createComposer(toneMapped)
		}
		if (toneMapped) this.toneMappingEffect.mode = mode
	}

	// Postprocessing passes cannot switch frame-buffer type once initialized, so
	// toggling tone mapping rebuilds the whole chain.
	createComposer(toneMapped) {
		this.composer?.dispose()

		// The only antialiasing: the canvas has no MSAA (src/renderSetup.js). 2x instead of
		// 4x: without multisampled render-to-texture the whole MSAA buffer is
		// written to memory and resolved, the largest cost of the chain.
		// Tone mapping needs the unclamped scene (getSceneBufferFormat());
		// otherwise 8-bit buffers, as small.
		const { type, format } = toneMapped
			? getSceneBufferFormat(this.renderer)
			: { type: UnsignedByteType, format: RGBAFormat }
		this.composer = new EffectComposer(this.renderer, {
			multisampling: SCENE_SAMPLES,
			frameBufferType: type,
		})
		// The composer only sets the type; its output buffer is a clone of the
		// input one. Every pass gets the type through initialize().
		this.composer.inputBuffer.texture.format = format
		this.composer.outputBuffer.texture.format = format
		// The lens flare reads the scene's depth around the sun. Three resolves
		// the multisampled depth into the input buffer (resolveDepthBuffer, set
		// per frame in render()), into a renderbuffer; a depth texture of the
		// same 24-bit format takes its place at no extra cost. The composer's own
		// depth texture (EffectAttribute.DEPTH) would switch the buffers to
		// 32-bit float depth and copy it once more per frame. The RenderPass
		// renders into the input buffer and the effect pass only reads it, so
		// the texture is never sampled while written; composer.dispose() frees it.
		const depthTexture = new DepthTexture(1, 1)
		depthTexture.name = 'PostProcessing.SceneDepth'
		this.composer.inputBuffer.depthTexture = depthTexture

		this.renderPass = new RenderPass(this.scene, this.camera)
		this.speedEffect = new SpeedEffect(this.params)
		this.lensFlareEffect = new LensFlareEffect(this.camera, this.params.lensFlare, this.sun)
		this.toneMappingEffect = toneMapped ? new ToneMappingEffect() : null
		this.grainEffect = new FilmGrainEffect()
		// The flare adds to the linear scene color after the speed effect's blur
		// and before tone mapping (the pass keeps this order among effects of
		// the same attributes).
		const effects = [
			this.speedEffect,
			this.lensFlareEffect,
			this.toneMappingEffect,
			this.grainEffect,
		]
		this.effectPass = new EffectPass(this.camera, ...effects.filter(Boolean))

		this.composer.addPass(this.renderPass)
		this.composer.addPass(this.effectPass)
	}

	// Edge blur and aberration only; the camera FOV and distance kick stays in
	// Plane. The effect never drops below the level of a speed effect of
	// `idleSpeedEffect`, and acceleration (0 to 1) animates the rest.
	setSpeedEffect(acceleration) {
		const idle = MathUtils.clamp(this.params.idleSpeedEffect, 0, 1)
		const effect = idle + (1 - idle) * MathUtils.clamp(acceleration, 0, 1)
		this.speedEffect.intensity = Math.max(MathUtils.smoothstep(effect, 0.1, 1), this.params.preview)
	}

	// The sun of the lens flare, from the DayNight state: its direction, color
	// (sRGB), and the sky disc's visibility at the current horizon dip.
	setSun({ sunDirection, sunColor, horizonDip }) {
		const { sun } = this
		sun.direction.fromArray(sunDirection)
		sun.color.setRGB(sunColor[0], sunColor[1], sunColor[2], SRGBColorSpace)
		sun.discVisibility = getSunDiscVisibility(sunDirection[1], horizonDip)
	}

	// Compiles the programs the composer draws only on demand (the lens
	// flare's occlusion pass); the effect pass compiles on the first frame.
	compileAsync() {
		return this.lensFlareEffect.compileAsync(this.renderer)
	}

	render(deltaTime) {
		this.grainEffect.intensity = Math.max(this.params.grain.intensity, 0)
		// Only the lens flare reads the scene's depth: frames without it skip the
		// depth resolve.
		this.composer.inputBuffer.resolveDepthBuffer = this.lensFlareEffect.prepare()
		this.composer.render(deltaTime)
	}

	setSize(width, height) {
		this.composer.setSize(width, height)
	}

	getStats() {
		return {
			active: this.speedEffect.intensity > 0,
			speedEffectIntensity: this.speedEffect.intensity,
			multisampling: this.composer.multisampling,
			grainIntensity: this.params.grain.intensity,
			toneMapping: this.renderer.toneMapping,
			toneMappingExposure: this.renderer.toneMappingExposure,
			frameBufferType: this.composer.inputBuffer.texture.type,
			frameBufferFormat: this.composer.inputBuffer.texture.format,
			depthResolved: this.composer.inputBuffer.resolveDepthBuffer,
			lensFlare: this.lensFlareEffect.getStats(),
		}
	}
}
