import assert from 'node:assert/strict'
import test from 'node:test'
import {
	createSeaIceSettings,
	getSeaIceAmount,
	getSeaIceBand,
	getSeaIceShelf,
	isUnderSeaIce,
	SEA_ICE_DEFAULTS,
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

test('settings are mutable copies of the defaults', () => {
	const copy = createSeaIceSettings()
	assert.deepEqual(copy, SEA_ICE_DEFAULTS)
	copy.colors.sheet = '#000000'
	assert.notEqual(SEA_ICE_DEFAULTS.colors.sheet, '#000000')
	for (const color of Object.values(SEA_ICE_DEFAULTS.colors)) assert.match(color, /^#[0-9a-f]{6}$/)
})
