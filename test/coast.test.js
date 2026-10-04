import assert from 'node:assert/strict'
import test from 'node:test'
import { createBiomeOffset } from '../src/biome.js'
import {
	COAST_RELIEF_WINDOW,
	getCoastRelief,
	getCoastReliefWindow,
	getCoastRockMask,
} from '../src/coast.js'
import { COAST_TERRAIN_DEFAULTS } from '../src/chunkGeometry.js'

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
