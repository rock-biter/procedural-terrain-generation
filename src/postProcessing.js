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
	HalfFloatType,
	LinearToneMapping,
	MathUtils,
	NeutralToneMapping,
	ReinhardToneMapping,
	SRGBColorSpace,
	Uniform,
	UnsignedByteType,
} from 'three'
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
// least at the idle level), tone mapping when enabled, and film grain.
export default class PostProcessing {
	constructor(renderer, scene, camera, params) {
		this.renderer = renderer
		this.scene = scene
		this.camera = camera
		this.params = params
		this.composer = null
		this.toneMappingEffect = null
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

		// The only antialiasing: the canvas has no MSAA (main.js). 2x instead of
		// 4x: without multisampled render-to-texture the whole MSAA buffer is
		// written to memory and resolved, the largest cost of the chain.
		// Tone mapping needs the unclamped scene, so its buffers are half float;
		// otherwise 8-bit buffers keep that resolve at half the bandwidth.
		this.composer = new EffectComposer(this.renderer, {
			multisampling: 2,
			frameBufferType: toneMapped ? HalfFloatType : UnsignedByteType,
		})

		this.renderPass = new RenderPass(this.scene, this.camera)
		this.speedEffect = new SpeedEffect(this.params)
		this.toneMappingEffect = toneMapped ? new ToneMappingEffect() : null
		this.grainEffect = new FilmGrainEffect()
		const effects = [this.speedEffect, this.toneMappingEffect, this.grainEffect]
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
		this.speedEffect.intensity = Math.max(
			MathUtils.smoothstep(effect, 0.1, 1),
			this.params.preview,
		)
	}

	render(deltaTime) {
		this.grainEffect.intensity = Math.max(this.params.grain.intensity, 0)
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
		}
	}
}
