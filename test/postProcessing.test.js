import assert from 'node:assert/strict'
import test from 'node:test'
import {
	HalfFloatType,
	RGBAFormat,
	RGBFormat,
	SRGBColorSpace,
	UnsignedByteType,
	UnsignedInt101111Type,
} from 'three'
import { createAppParams } from '../src/appParams.js'
import { getSceneBufferFormat } from '../src/postProcessing.js'
import SpeedEffect, { getRequiredBlurLevels } from '../src/speedEffect.js'

// WebGL2 enums the format check reads.
const GL = { RENDERBUFFER: 0x8d41, R11F_G11F_B10F: 0x8c3a, SAMPLES: 0x80a9 }

// A renderer whose context reports `samples` for R11F_G11F_B10F renderbuffers.
function createRenderer({ colorBufferFloat = true, samples = [4, 2] } = {}) {
	const gl = {
		...GL,
		getInternalformatParameter(target, format, name) {
			assert.equal(target, GL.RENDERBUFFER)
			assert.equal(format, GL.R11F_G11F_B10F)
			assert.equal(name, GL.SAMPLES)
			return Int32Array.from(samples)
		},
	}
	return {
		outputColorSpace: SRGBColorSpace,
		getContext: () => gl,
		extensions: { has: (name) => name === 'EXT_color_buffer_float' && colorBufferFloat },
	}
}

test('the tone-mapped scene buffer is R11F_G11F_B10F where it takes 2x MSAA', () => {
	assert.deepEqual(getSceneBufferFormat(createRenderer()), {
		type: UnsignedInt101111Type,
		format: RGBFormat,
	})
})

test('the scene buffer falls back to half float', () => {
	const halfFloat = { type: HalfFloatType, format: RGBAFormat }
	// Not color-renderable without the extension.
	assert.deepEqual(getSceneBufferFormat(createRenderer({ colorBufferFloat: false })), halfFloat)
	// 2 samples would round up to 4, or no multisampling at all.
	assert.deepEqual(getSceneBufferFormat(createRenderer({ samples: [4] })), halfFloat)
	assert.deepEqual(getSceneBufferFormat(createRenderer({ samples: [] })), halfFloat)
})

test('the speed-effect pyramid takes the scene buffer type and format', () => {
	const params = {
		blur: { strength: 0.075, start: 0.35, end: 1.5, curve: 1.2 },
		aberration: { strength: 0.016, start: 0.28, end: 0.9, curve: 2.2 },
		verticalScale: 0.78,
	}
	const renderer = createRenderer()
	for (const [type, format] of [
		[UnsignedInt101111Type, RGBFormat],
		[HalfFloatType, RGBAFormat],
		[UnsignedByteType, RGBAFormat],
	]) {
		const effect = new SpeedEffect(params)
		effect.initialize(renderer, false, type)
		for (const target of [...effect.blurPyramid.levels, ...effect.blurUpsample.levels]) {
			assert.equal(target.texture.type, type)
			assert.equal(target.texture.format, format)
		}
		effect.dispose()
	}
})

test('the blur renders the levels its corners need, within a tolerance', () => {
	// The default mask until 2026-10-12 (as setMaskParams() packs appParams'
	// blur), 1100 pixels tall.
	const blur = { x: 0.075, y: 0.35, z: 1.5, w: 1.2 }
	const levels = (intensity) => getRequiredBlurLevels(blur, intensity, 1100, 0.78)
	assert.equal(levels(0), 0)
	// The idle intensities of idleSpeedEffect 0.4 (about 8.5 corner pixels,
	// formerly four levels) and 0.3 (about 4.1).
	assert.equal(levels(0.259), 3)
	assert.equal(levels(0.126), 2)
	// Full boost saturates at the pyramid's depth.
	assert.equal(levels(1), 4)
	// Any blur at all renders a level for the composite to read.
	assert.equal(getRequiredBlurLevels(blur, 0.126, 280, 0.78), 1)
	assert.equal(getRequiredBlurLevels(blur, 0.01, 1100, 0.78), 0)
	// The current, stronger mask blurs the idle corners by about 12 pixels: all
	// four levels.
	const { postProcessing } = createAppParams({ urlParams: new URLSearchParams(), isMobile: false })
	const { strength, start, end, curve } = postProcessing.blur
	const current = { x: strength, y: start, z: end, w: curve }
	assert.equal(getRequiredBlurLevels(current, 0.126, 1100, postProcessing.verticalScale), 4)
})
