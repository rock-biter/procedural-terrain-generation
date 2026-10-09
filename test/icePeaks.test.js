import assert from 'node:assert/strict'
import test from 'node:test'
import { createBiomeOffset } from '../src/biome.js'
import { ICE_TERRAIN_DEFAULTS } from '../src/chunkGeometry.js'
import { ICE_PEAK_SHORE, getIcePeakFade, getIcePeakSeed, getIcePeaks } from '../src/icePeaks.js'

const settings = ICE_TERRAIN_DEFAULTS
const offset = createBiomeOffset('ice-peaks-test')

// Deep in the ice, on land well above the shore.
const ICE = 1
const LAND = 50
const PLAIN = 5

function* grid(step = 8, extent = 6000) {
	for (let x = -extent; x <= extent; x += step) {
		for (let z = -extent; z <= extent; z += step) yield [x, z]
	}
}

test('seeds the mountain grid from the biome offset', () => {
	assert.equal(getIcePeakSeed(offset), getIcePeakSeed(createBiomeOffset('ice-peaks-test')))
	assert.notEqual(getIcePeakSeed(offset), getIcePeakSeed(createBiomeOffset('another-seed')))
	assert.ok(Number.isInteger(getIcePeakSeed(offset)) && getIcePeakSeed(offset) >= 0)
})

test('fades the mountains in from the ice border and the shore', () => {
	assert.equal(getIcePeakFade(0, LAND, settings), 0)
	assert.equal(getIcePeakFade(-0.1, LAND, settings), 0)
	assert.equal(getIcePeakFade(ICE, 0, settings), 0)
	assert.equal(getIcePeakFade(ICE, -3, settings), 0)
	assert.equal(getIcePeakFade(settings.depth, ICE_PEAK_SHORE, settings), 1)
	const partial = getIcePeakFade(settings.depth / 2, ICE_PEAK_SHORE / 2, settings)
	assert.ok(partial > 0 && partial < 1)
})

test('raises sparse mountains up to peakHeight, never lowering the plain', () => {
	let raised = 0
	let total = 0
	let tallest = PLAIN
	for (const [x, z] of grid()) {
		const height = getIcePeaks(x, z, PLAIN, LAND, ICE, offset, settings)
		assert.equal(height, getIcePeaks(x, z, PLAIN, LAND, ICE, offset, settings))
		assert.ok(height >= PLAIN && height <= settings.peakHeight)
		if (height > PLAIN) raised++
		tallest = Math.max(tallest, height)
		total++
	}
	// A few mountains, and some reach most of peakHeight.
	assert.ok(raised > 0 && raised < total * 0.15, `${raised} of ${total} raised`)
	assert.ok(tallest > settings.peakHeight * 0.7, `tallest ${tallest}`)
})

test('leaves the terrain unchanged without mountains, at the border, or at sea', () => {
	const none = [
		{ ...settings, peakChance: 0 },
		{ ...settings, peakHeight: 0 },
		{ ...settings, peakRadius: 0 },
	]
	for (const [x, z] of grid(97)) {
		for (const disabled of none) {
			assert.equal(getIcePeaks(x, z, PLAIN, LAND, ICE, offset, disabled), PLAIN)
		}
		assert.equal(getIcePeaks(x, z, PLAIN, LAND, 0, offset, settings), PLAIN)
		assert.equal(getIcePeaks(x, z, PLAIN, 0, ICE, offset, settings), PLAIN)
	}
})

test('follows the mountain settings and the seed', () => {
	const other = createBiomeOffset('another-seed')
	const lower = { ...settings, peakHeight: 40 }
	const denser = { ...settings, peakChance: 0.9 }
	let differs = false
	let raised = 0
	let raisedDenser = 0
	for (const [x, z] of grid(16)) {
		const height = getIcePeaks(x, z, PLAIN, LAND, ICE, offset, settings)
		assert.ok(getIcePeaks(x, z, PLAIN, LAND, ICE, offset, lower) <= 40)
		if (height !== getIcePeaks(x, z, PLAIN, LAND, ICE, other, settings)) differs = true
		if (height > PLAIN) raised++
		if (getIcePeaks(x, z, PLAIN, LAND, ICE, offset, denser) > PLAIN) raisedDenser++
	}
	assert.ok(differs)
	assert.ok(raisedDenser > raised)
})

test('keeps the mountain slopes continuous', () => {
	// Through the tallest point of a coarse scan, at 0.1 unit steps.
	let best = [0, 0, PLAIN]
	for (const [x, z] of grid(16)) {
		const height = getIcePeaks(x, z, PLAIN, LAND, ICE, offset, settings)
		if (height > best[2]) best = [x, z, height]
	}
	const [x0, z0] = best
	let previous = getIcePeaks(x0 - 400, z0, PLAIN, LAND, ICE, offset, settings)
	for (let step = 1; step <= 8000; step++) {
		const x = x0 - 400 + step * 0.1
		const height = getIcePeaks(x, z0, PLAIN, LAND, ICE, offset, settings)
		assert.ok(Math.abs(height - previous) < 0.5, `jump at x=${x}`)
		previous = height
	}
})
