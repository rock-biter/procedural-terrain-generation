import assert from 'node:assert/strict'
import test from 'node:test'
import {
	createSeaIceSettings,
	getSeaIceAmount,
	getSeaIceBand,
	getSeaIceBandAt,
	getSeaIceCrackScaleAt,
	getSeaIceNightGrowth,
	getSeaIceShelf,
	getSeaIceShelfAt,
	isUnderSeaIce,
	SEA_ICE_DEFAULTS,
	SEA_ICE_NIGHT,
} from '../src/seaIcePolicy.js'
import { SAND_LEVEL } from '../src/terrainBands.js'

const settings = SEA_ICE_DEFAULTS

test('the shelf and band taper to nothing at the ice border', () => {
	for (const ice of [-1, -0.01, 0]) {
		assert.equal(getSeaIceAmount(ice, settings), 0)
		assert.equal(getSeaIceShelf(ice, settings), 0)
		assert.equal(getSeaIceBand(ice, settings), 0)
	}
	assert.equal(getSeaIceShelf(settings.fade, settings), settings.shelf)
	assert.equal(getSeaIceBand(settings.fade * 3, settings), settings.band)
	let previous = 0
	for (let ice = 0; ice <= settings.fade; ice += settings.fade / 20) {
		const shelf = getSeaIceShelf(ice, settings)
		assert.ok(shelf >= previous)
		previous = shelf
	}
})

test('the sheet covers the sea down to the shelf, only inside the ice', () => {
	const inside = settings.fade * 2
	assert.equal(isUnderSeaIce(-settings.shelf + 0.1, inside, settings), true)
	assert.equal(isUnderSeaIce(-settings.shelf - 0.1, inside, settings), false)
	assert.equal(isUnderSeaIce(-1, -0.01, settings), false)
	// Land is not sea.
	assert.equal(isUnderSeaIce(SAND_LEVEL + 0.01, inside, settings), false)
})

test('the sea freezes through the night and melts back by noon', () => {
	const { freeze, peak, melt } = SEA_ICE_NIGHT
	// Noon to sunset: the daytime sheet.
	for (let time = melt; time <= freeze; time += 0.01) {
		assert.equal(getSeaIceNightGrowth(time), 0)
	}
	assert.equal(getSeaIceNightGrowth(peak), 1)
	// Rising from sunset to sunrise (across midnight), falling until noon.
	let previous = 0
	for (let step = 0; step <= 100; step++) {
		const growth = getSeaIceNightGrowth(freeze + step * 0.005)
		assert.ok(growth >= previous - 1e-12)
		previous = growth
	}
	for (let time = peak; time <= melt; time += 0.005) {
		const growth = getSeaIceNightGrowth(time)
		assert.ok(growth <= previous + 1e-12)
		previous = growth
	}
	// Continuous and periodic.
	for (let time = 0; time < 1; time += 0.001) {
		assert.ok(Math.abs(getSeaIceNightGrowth(time + 0.001) - getSeaIceNightGrowth(time)) < 0.02)
		assert.ok(Math.abs(getSeaIceNightGrowth(time + 1) - getSeaIceNightGrowth(time)) < 1e-9)
	}
	// Half grown at midnight, halfway through the night.
	assert.ok(Math.abs(getSeaIceNightGrowth(0) - 0.5) < 1e-9)
})

test('the shelf deepens by nightShelf at sunrise', () => {
	assert.ok(settings.nightShelf > 0)
	assert.equal(getSeaIceShelfAt(settings, SEA_ICE_NIGHT.melt), settings.shelf)
	assert.equal(getSeaIceShelfAt(settings, SEA_ICE_NIGHT.peak), settings.shelf + settings.nightShelf)
	const still = { ...settings, nightShelf: 0 }
	for (const time of [0, 0.25, 0.5, 0.9])
		assert.equal(getSeaIceShelfAt(still, time), settings.shelf)
	// A deeper shelf covers more sea.
	const inside = settings.fade * 2
	const depth = -settings.shelf - 1
	assert.equal(isUnderSeaIce(depth, inside, settings), false)
	const night = { ...settings, shelf: getSeaIceShelfAt(settings, SEA_ICE_NIGHT.peak) }
	assert.equal(isUnderSeaIce(depth, inside, night), true)
})

test('the floe band deepens by nightBand and the cracks narrow by nightCrack at sunrise', () => {
	assert.ok(settings.nightBand > 0)
	assert.ok(settings.nightCrack > 0 && settings.nightCrack <= 1)
	assert.equal(getSeaIceBandAt(settings, SEA_ICE_NIGHT.melt), settings.band)
	assert.equal(getSeaIceBandAt(settings, SEA_ICE_NIGHT.peak), settings.band + settings.nightBand)
	assert.equal(getSeaIceCrackScaleAt(settings, SEA_ICE_NIGHT.melt), 1)
	assert.equal(getSeaIceCrackScaleAt(settings, SEA_ICE_NIGHT.peak), 1 - settings.nightCrack)
	// Both follow the night growth, never past their sunrise values.
	for (let time = 0; time < 1; time += 0.01) {
		const growth = getSeaIceNightGrowth(time)
		assert.ok(
			Math.abs(getSeaIceBandAt(settings, time) - settings.band - settings.nightBand * growth) <
				1e-9,
		)
		const scale = getSeaIceCrackScaleAt(settings, time)
		assert.ok(scale >= 1 - settings.nightCrack - 1e-12 && scale <= 1)
	}
	// Without night settings, or with a closing beyond 1, nothing breaks.
	const still = { ...settings, nightBand: undefined, nightCrack: undefined }
	assert.equal(getSeaIceBandAt(still, SEA_ICE_NIGHT.peak), settings.band)
	assert.equal(getSeaIceCrackScaleAt(still, SEA_ICE_NIGHT.peak), 1)
	assert.equal(getSeaIceCrackScaleAt({ ...settings, nightCrack: 2 }, SEA_ICE_NIGHT.peak), 0)
})

test('settings are mutable copies of the defaults', () => {
	const copy = createSeaIceSettings()
	assert.deepEqual(copy, SEA_ICE_DEFAULTS)
	copy.colors.sheet = '#000000'
	assert.notEqual(SEA_ICE_DEFAULTS.colors.sheet, '#000000')
	for (const color of Object.values(SEA_ICE_DEFAULTS.colors)) assert.match(color, /^#[0-9a-f]{6}$/)
})
