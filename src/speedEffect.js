import { Effect, EffectAttribute, Pass } from 'postprocessing'
import {
	NoBlending,
	ShaderMaterial,
	SRGBColorSpace,
	Uniform,
	UnsignedByteType,
	Vector2,
	Vector4,
	WebGLRenderTarget,
} from 'three'
import fragmentShader from './shaders/speed-effect.glsl'
import downsampleFragmentShader from './shaders/blur-downsample-fragment.glsl'
import downsampleVertexShader from './shaders/blur-downsample-vertex.glsl'

// Must match the blurLevel samplers declared in speed-effect.glsl.
const BLUR_LEVELS = 6

class BlurPyramidPass extends Pass {
	constructor() {
		super('BlurPyramidPass')

		this.needsSwap = false
		this.fullscreenMaterial = new ShaderMaterial({
			name: 'BlurDownsampleMaterial',
			uniforms: {
				inputBuffer: new Uniform(null),
				texelSize: new Uniform(new Vector2()),
			},
			vertexShader: downsampleVertexShader,
			fragmentShader: downsampleFragmentShader,
			blending: NoBlending,
			depthWrite: false,
			depthTest: false,
		})
		this.levels = Array.from({ length: BLUR_LEVELS }, (_, index) => {
			const target = new WebGLRenderTarget(1, 1, { depthBuffer: false })
			target.texture.name = `SpeedEffect.Blur${index + 1}`
			return target
		})
	}

	renderLevels(renderer, inputBuffer, count) {
		const { uniforms } = this.fullscreenMaterial
		let source = inputBuffer

		for (let index = 0; index < count; index++) {
			const target = this.levels[index]
			uniforms.inputBuffer.value = source.texture
			uniforms.texelSize.value.set(1 / source.width, 1 / source.height)
			renderer.setRenderTarget(target)
			renderer.render(this.scene, this.camera)
			source = target
		}
	}

	setSize(width, height) {
		for (const target of this.levels) {
			width = Math.max(Math.round(width / 2), 1)
			height = Math.max(Math.round(height / 2), 1)
			target.setSize(width, height)
		}
	}

	initialize(renderer, alpha, frameBufferType) {
		for (const target of this.levels) {
			target.texture.type = frameBufferType
			if (
				frameBufferType === UnsignedByteType &&
				renderer.outputColorSpace === SRGBColorSpace
			) {
				target.texture.colorSpace = SRGBColorSpace
			}
		}
	}

	dispose() {
		super.dispose()
		for (const target of this.levels) target.dispose()
	}
}

export default class SpeedEffect extends Effect {
	height = 1

	constructor(params) {
		const blurPyramid = new BlurPyramidPass()
		const uniforms = new Map([
			['intensity', new Uniform(0)],
			['blurParams', new Uniform(new Vector4())],
			['aberrationParams', new Uniform(new Vector4())],
			['verticalScale', new Uniform(1)],
		])
		blurPyramid.levels.forEach((target, index) => {
			uniforms.set(`blurLevel${index + 1}`, new Uniform(target.texture))
		})

		super('SpeedEffect', fragmentShader, {
			attributes: EffectAttribute.CONVOLUTION,
			defines: new Map([['LEVELS', `${BLUR_LEVELS}`]]),
			uniforms,
		})

		this.blurPyramid = blurPyramid
		this.setParams(params)
	}

	get intensity() {
		return this.uniforms.get('intensity').value
	}

	set intensity(value) {
		this.uniforms.get('intensity').value = value
	}

	setParams({ blur, aberration, verticalScale }) {
		setMaskParams(this.uniforms.get('blurParams').value, blur)
		setMaskParams(this.uniforms.get('aberrationParams').value, aberration)
		this.uniforms.get('verticalScale').value = verticalScale
	}

	// Renders only the pyramid levels the current maximum blur can reach.
	getRequiredLevels() {
		const maxBlurPixels =
			this.uniforms.get('blurParams').value.x * this.intensity * this.height
		const maxLod = Math.log2(Math.max(maxBlurPixels, 1))
		return Math.min(Math.ceil(maxLod), BLUR_LEVELS)
	}

	update(renderer, inputBuffer) {
		this.blurPyramid.renderLevels(
			renderer,
			inputBuffer,
			this.getRequiredLevels(),
		)
	}

	setSize(width, height) {
		this.height = height
		this.blurPyramid.setSize(width, height)
	}

	initialize(renderer, alpha, frameBufferType) {
		super.initialize(renderer, alpha, frameBufferType)
		this.blurPyramid.initialize(renderer, alpha, frameBufferType)
	}

	dispose() {
		this.blurPyramid.dispose()
		super.dispose()
	}
}

function setMaskParams(target, { strength, start, end, curve }) {
	// smoothstep() is undefined when its edges are equal or inverted.
	target.set(
		strength,
		start,
		Math.max(end, start + 0.001),
		Math.max(curve, 0.01),
	)
}
