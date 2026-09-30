import {
	EffectComposer,
	EffectPass,
	RenderPass,
	ToneMappingEffect,
	ToneMappingMode,
} from 'postprocessing'
import {
	ACESFilmicToneMapping,
	AddEquation,
	AgXToneMapping,
	Camera,
	CineonToneMapping,
	CustomBlending,
	DstColorFactor,
	HalfFloatType,
	LinearToneMapping,
	MathUtils,
	Mesh,
	NeutralToneMapping,
	PlaneGeometry,
	ReinhardToneMapping,
	Scene,
	ShaderMaterial,
	SrcColorFactor,
	UnsignedByteType,
} from 'three'
import SpeedEffect from './speedEffect'
import fullscreenVertexShader from './shaders/fullscreen-vertex.glsl'
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

export default class PostProcessing {
	needsWarmup = true

	constructor(renderer, scene, camera, params) {
		this.renderer = renderer
		this.scene = scene
		this.camera = camera
		this.params = params
		this.composer = null
		this.toneMappingEffect = null
		this.updateToneMapping()

		// Film grain is a multiply overlay drawn on the finished canvas rather than
		// a composer effect, so idle frames keep bypassing the offscreen chain.
		this.grainMaterial = new ShaderMaterial({
			uniforms: { uIntensity: { value: 0 } },
			vertexShader: fullscreenVertexShader,
			fragmentShader: filmGrainFragmentShader,
			depthTest: false,
			depthWrite: false,
			blending: CustomBlending,
			blendEquation: AddEquation,
			blendSrc: DstColorFactor,
			blendDst: SrcColorFactor,
		})
		const grainQuad = new Mesh(new PlaneGeometry(2, 2), this.grainMaterial)
		grainQuad.frustumCulled = false
		this.grainScene = new Scene()
		this.grainScene.add(grainQuad)
		this.grainCamera = new Camera()
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
		// Compile the changed effect shader now rather than on the next boost.
		this.needsWarmup = true
	}

	// Postprocessing passes cannot switch frame-buffer type once initialized, so
	// toggling tone mapping rebuilds the whole chain.
	createComposer(toneMapped) {
		this.composer?.dispose()

		// Only used while the effect is active; idle frames keep the canvas MSAA.
		// 2x instead of 4x: without multisampled render-to-texture the whole MSAA
		// buffer is written to memory and resolved, the largest cost of the effect.
		// Tone mapping needs the unclamped scene, so its buffers are half float;
		// otherwise 8-bit buffers keep that resolve at half the bandwidth.
		this.composer = new EffectComposer(this.renderer, {
			multisampling: 2,
			frameBufferType: toneMapped ? HalfFloatType : UnsignedByteType,
		})

		this.renderPass = new RenderPass(this.scene, this.camera)
		this.speedEffect = new SpeedEffect(this.params)
		this.toneMappingEffect = toneMapped ? new ToneMappingEffect() : null
		this.effectPass = toneMapped
			? new EffectPass(this.camera, this.speedEffect, this.toneMappingEffect)
			: new EffectPass(this.camera, this.speedEffect)

		this.composer.addPass(this.renderPass)
		this.composer.addPass(this.effectPass)
	}

	setSpeedEffect(acceleration) {
		this.speedEffect.intensity = Math.max(
			MathUtils.smoothstep(acceleration, 0.1, 1),
			this.params.preview,
		)
	}

	isActive() {
		return this.speedEffect.intensity > 0
	}

	render(deltaTime) {
		// The first frame compiles the effect pass so the first boost does not stall.
		const active = this.needsWarmup || this.isActive()
		this.needsWarmup = false

		if (this.effectPass.enabled !== active) {
			this.effectPass.enabled = active
			this.renderPass.renderToScreen = !active
		}

		this.composer.render(deltaTime)
		this.renderGrain()
	}

	renderGrain() {
		const intensity = this.params.grain.intensity
		if (intensity <= 0) return

		this.grainMaterial.uniforms.uIntensity.value = intensity
		const autoClear = this.renderer.autoClear
		this.renderer.autoClear = false
		this.renderer.setRenderTarget(null)
		this.renderer.render(this.grainScene, this.grainCamera)
		this.renderer.autoClear = autoClear
	}

	setSize(width, height) {
		this.composer.setSize(width, height)
	}

	getStats() {
		return {
			active: this.effectPass.enabled,
			speedEffectIntensity: this.speedEffect.intensity,
			multisampling: this.composer.multisampling,
			grainIntensity: this.params.grain.intensity,
			toneMapping: this.renderer.toneMapping,
			toneMappingExposure: this.renderer.toneMappingExposure,
			frameBufferType: this.composer.inputBuffer.texture.type,
		}
	}
}
