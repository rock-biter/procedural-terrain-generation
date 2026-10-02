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
import upsampleFragmentShader from './shaders/blur-upsample-fragment.glsl'
import fullscreenVertexShader from './shaders/fullscreen-vertex.glsl'

// Caps the blur at about 2^4 = 16 pixels; stronger settings saturate there.
const BLUR_LEVELS = 4

// Chain of successively half-resolution targets shared by the downsample and upsample passes.
class LevelChainPass extends Pass {
	constructor(name, count, material) {
		super(name)

		this.needsSwap = false
		this.fullscreenMaterial = material
		this.levels = Array.from({ length: count }, (_, index) => {
			const target = new WebGLRenderTarget(1, 1, { depthBuffer: false })
			target.texture.name = `SpeedEffect.${name}${index + 1}`
			return target
		})
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

class BlurPyramidPass extends LevelChainPass {
	constructor() {
		super(
			'Blur',
			BLUR_LEVELS,
			createFullscreenMaterial('BlurDownsampleMaterial', downsampleFragmentShader, {
				inputBuffer: new Uniform(null),
				texelSize: new Uniform(new Vector2()),
			}),
		)
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
}

// Folds the pyramid back up from the coarsest rendered level to level 1, choosing each
// pixel's blend of levels with the same mask as the composite, which then reads one level.
class BlurUpsamplePass extends LevelChainPass {
	constructor(maskUniforms) {
		super(
			'BlurUp',
			BLUR_LEVELS - 1,
			createFullscreenMaterial('BlurUpsampleMaterial', upsampleFragmentShader, {
				...maskUniforms,
				levelBuffer: new Uniform(null),
				coarserBuffer: new Uniform(null),
				level: new Uniform(0),
				viewHeight: new Uniform(1),
			}),
		)
	}

	// Returns the texture holding the blended blur from level 1 upward.
	renderLevels(renderer, pyramid, count) {
		const { uniforms } = this.fullscreenMaterial

		for (let level = count - 1; level >= 1; level--) {
			uniforms.levelBuffer.value = pyramid[level - 1].texture
			uniforms.coarserBuffer.value =
				level === count - 1 ? pyramid[level].texture : this.levels[level].texture
			uniforms.level.value = level
			renderer.setRenderTarget(this.levels[level - 1])
			renderer.render(this.scene, this.camera)
		}

		return count > 1 ? this.levels[0].texture : pyramid[0].texture
	}

	setSize(width, height) {
		this.fullscreenMaterial.uniforms.viewHeight.value = height
		super.setSize(width, height)
	}
}

export default class SpeedEffect extends Effect {
	height = 1

	constructor(params) {
		// Shared Uniform objects keep the composite and upsample masks in sync.
		const maskUniforms = {
			intensity: new Uniform(0),
			blurParams: new Uniform(new Vector4()),
			verticalScale: new Uniform(1),
		}
		const blurPyramid = new BlurPyramidPass()
		const blurUpsample = new BlurUpsamplePass(maskUniforms)

		super('SpeedEffect', fragmentShader, {
			attributes: EffectAttribute.CONVOLUTION,
			uniforms: new Map([
				...Object.entries(maskUniforms),
				['aberrationParams', new Uniform(new Vector4())],
				['blurBuffer', new Uniform(null)],
			]),
		})

		this.blurPyramid = blurPyramid
		this.blurUpsample = blurUpsample
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
		const count = this.getRequiredLevels()
		if (count <= 0) return

		this.blurPyramid.renderLevels(renderer, inputBuffer, count)
		this.uniforms.get('blurBuffer').value = this.blurUpsample.renderLevels(
			renderer,
			this.blurPyramid.levels,
			count,
		)
	}

	setSize(width, height) {
		this.height = height
		this.blurPyramid.setSize(width, height)
		this.blurUpsample.setSize(width, height)
	}

	initialize(renderer, alpha, frameBufferType) {
		super.initialize(renderer, alpha, frameBufferType)
		this.blurPyramid.initialize(renderer, alpha, frameBufferType)
		this.blurUpsample.initialize(renderer, alpha, frameBufferType)
	}

	dispose() {
		this.blurPyramid.dispose()
		this.blurUpsample.dispose()
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

function createFullscreenMaterial(name, fragmentShader, uniforms) {
	return new ShaderMaterial({
		name,
		uniforms,
		vertexShader: fullscreenVertexShader,
		fragmentShader,
		blending: NoBlending,
		depthWrite: false,
		depthTest: false,
	})
}
