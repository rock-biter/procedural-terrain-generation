import assert from 'node:assert/strict'
import test from 'node:test'
import { createBiomeOffset } from '../src/biome.js'
import { Vector2, Vector3 } from 'three'
import {
	COAST_MASK_DEFAULTS,
	COAST_RELIEF_WINDOW,
	getCoastRelief,
	getCoastReliefWindow,
	getCoastRockMask,
} from '../src/coast.js'
import { COAST_TERRAIN_DEFAULTS, createTerrainSettings } from '../src/chunkGeometry.js'
import { updateCoastMaskUniforms } from '../src/sharedUniforms.js'

const offset = createBiomeOffset('coast-test')

function* grid(step = 37, extent = 6000) {
	for (let x = -extent; x <= extent; x += step * 7) {
		for (let z = -extent; z <= extent; z += step * 5) yield [x, z]
	}
}

test('the rocky coast mask spans [0, 1] and depends on the seed', () => {
	let zeros = 0
	let ones = 0
	let differs = false
	const other = createBiomeOffset('another-seed')
	for (const [x, z] of grid()) {
		const mask = getCoastRockMask(x, z, offset)
		assert.ok(mask >= 0 && mask <= 1)
		assert.equal(mask, getCoastRockMask(x, z, offset))
		if (mask === 0) zeros++
		if (mask === 1) ones++
		if (mask !== getCoastRockMask(x, z, other)) differs = true
	}
	assert.ok(zeros > 0 && ones > 0, 'plain and rocky coast both exist')
	assert.ok(differs)
})

test('the mask follows its settings', () => {
	let base = 0
	let higher = 0
	let finer = false
	const raised = { ...COAST_MASK_DEFAULTS, threshold: COAST_MASK_DEFAULTS.threshold + 0.4 }
	const fine = { ...COAST_MASK_DEFAULTS, frequency: COAST_MASK_DEFAULTS.frequency * 3 }
	for (const [x, z] of grid()) {
		base += getCoastRockMask(x, z, offset)
		higher += getCoastRockMask(x, z, offset, raised)
		if (getCoastRockMask(x, z, offset, fine) !== getCoastRockMask(x, z, offset)) finer = true
	}
	assert.ok(higher < base, 'a higher threshold leaves less rocky coast')
	assert.ok(finer)
})

test('terrain settings copy the mask, and the shader uniforms mirror it', () => {
	const settings = createTerrainSettings()
	assert.deepEqual(settings.coast.mask, COAST_MASK_DEFAULTS)
	assert.notEqual(settings.coast.mask, COAST_TERRAIN_DEFAULTS.mask)
	const uniforms = {
		uCoastRockNoise: { value: new Vector3() },
		uCoastRockEdge: { value: new Vector2() },
	}
	updateCoastMaskUniforms(uniforms, settings.coast.mask)
	const { frequency, detailFrequency, detailWeight, threshold, softness } = settings.coast.mask
	assert.deepEqual(uniforms.uCoastRockNoise.value.toArray(), [
		frequency,
		detailFrequency,
		detailWeight,
	])
	assert.deepEqual(uniforms.uCoastRockEdge.value.toArray(), [threshold, softness])
})

test('the relief window covers only the heights around the waterline', () => {
	const { min, max, ramp } = COAST_RELIEF_WINDOW
	assert.equal(getCoastReliefWindow(min), 0)
	assert.equal(getCoastReliefWindow(max), 0)
	assert.equal(getCoastReliefWindow(min + ramp), 1)
	assert.equal(getCoastReliefWindow(0), 1)
	assert.equal(getCoastReliefWindow(max - ramp), 1)
})

test('the relief is never negative, and zero outside the window or without amplitude', () => {
	let raised = 0
	for (const [x, z] of grid()) {
		const relief = getCoastRelief(x, z, 0, offset, COAST_TERRAIN_DEFAULTS)
		assert.ok(relief >= 0 && relief <= COAST_TERRAIN_DEFAULTS.amplitude)
		if (relief > 0) {
			raised++
			assert.ok(getCoastRockMask(x, z, offset) > 0, 'only on rocky coast')
		}
		assert.equal(
			getCoastRelief(x, z, COAST_RELIEF_WINDOW.min - 1, offset, COAST_TERRAIN_DEFAULTS),
			0,
		)
		assert.equal(
			getCoastRelief(x, z, COAST_RELIEF_WINDOW.max + 1, offset, COAST_TERRAIN_DEFAULTS),
			0,
		)
		assert.equal(getCoastRelief(x, z, 0, offset, { ...COAST_TERRAIN_DEFAULTS, amplitude: 0 }), 0)
	}
	assert.ok(raised > 0)
})
