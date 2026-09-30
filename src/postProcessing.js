import { EffectComposer, EffectPass, RenderPass } from 'postprocessing'
import { MathUtils } from 'three'
import SpeedEffect from './speedEffect'

export default class PostProcessing {
	needsWarmup = true

	constructor(renderer, scene, camera, params) {
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
	}

	setSize(width, height) {
		this.composer.setSize(width, height)
	}

	getStats() {
		return {
			active: this.effectPass.enabled,
			speedEffectIntensity: this.speedEffect.intensity,
			multisampling: this.composer.multisampling,
		}
	}
}
