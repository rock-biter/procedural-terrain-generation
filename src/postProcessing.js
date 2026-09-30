import { EffectComposer, EffectPass, RenderPass } from 'postprocessing'
import {
	AddEquation,
	Camera,
	CustomBlending,
	DstColorFactor,
	MathUtils,
	Mesh,
	PlaneGeometry,
	Scene,
	ShaderMaterial,
	SrcColorFactor,
} from 'three'
import SpeedEffect from './speedEffect'
import fullscreenVertexShader from './shaders/fullscreen-vertex.glsl'
import filmGrainFragmentShader from './shaders/film-grain-fragment.glsl'

export default class PostProcessing {
	needsWarmup = true

	constructor(renderer, scene, camera, params) {
		this.renderer = renderer
		this.params = params
		// Only used while the effect is active; idle frames keep the canvas MSAA.
		// 2x instead of 4x: without multisampled render-to-texture the whole MSAA
		// buffer is written to memory and resolved, the largest cost of the effect.
		this.composer = new EffectComposer(renderer, { multisampling: 2 })

		this.renderPass = new RenderPass(scene, camera)
		this.speedEffect = new SpeedEffect(params)
		this.effectPass = new EffectPass(camera, this.speedEffect)

		this.composer.addPass(this.renderPass)
		this.composer.addPass(this.effectPass)

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
		}
	}
}
