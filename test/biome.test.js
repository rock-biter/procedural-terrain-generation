import assert from 'node:assert/strict'
import test from 'node:test'
import {
	BIOME,
	BIOME_BORDER_MARGIN,
	BIOME_DEFAULTS,
	createBiomeOffset,
	createBiomeSettings,
	getBiome,
	getBiomeFields,
	getBiomeGradientBounds,
	getClimateNoise,
	getIceValue,
	ICE_BORDER_MARGIN,
	isNearBiomeBorder,
} from '../src/biome.js'
import { snoise } from '../src/noise.js'

const settings = BIOME_DEFAULTS

test('creates a deterministic seed-dependent biome offset', () => {
	assert.deepEqual(createBiomeOffset('alpha'), createBiomeOffset('alpha'))
	assert.notDeepEqual(createBiomeOffset('alpha'), createBiomeOffset('beta'))

	const [x, z, u, v] = createBiomeOffset('alpha')
	assert.ok(Math.abs(x) <= 10000 && Math.abs(z) <= 10000)
	// The ice offset lies in a small noise-space window: float32 shaders keep
	// their precision there.
	assert.ok(u >= 0 && u < 16 && v >= 0 && v < 16)
})

test('keeps the two-biome world offset of every seed', () => {
	// The first two values predate the ice field; drawing more must not move
	// them, so seeds keep their climate layout and rocky coast.
	assert.deepEqual(createBiomeOffset('review').slice(0, 2), [550.0173196196556, 2212.3039420694113])
})

test('keeps the simplex port bounded and continuous', () => {
	for (let i = 0; i < 2000; i++) {
		const x = ((i * 37.13) % 500) - 250
		const z = ((i * 91.71) % 500) - 250
		const value = snoise(x, z)

		assert.ok(value >= -1 && value <= 1, `snoise(${x}, ${z}) = ${value}`)
		assert.ok(Math.abs(snoise(x + 0.001, z) - value) < 0.01)
	}
})

// Biome counts and land-free shares over a coarse grid of several seeds.
function sampleBiomes(biomes = settings, seeds = ['alpha', 'beta', 'gamma', 'delta']) {
	const counts = { [BIOME.DESERT]: 0, [BIOME.TEMPERATE]: 0, [BIOME.ICE]: 0 }
	const fields = {}
	for (const seed of seeds) {
		const offset = createBiomeOffset(seed)
		for (let i = -60; i <= 60; i++) {
			for (let j = -60; j <= 60; j++) {
				getBiomeFields(i * 1000, j * 1000, offset, biomes, fields)
				counts[getBiome(fields)]++
			}
		}
	}
	const total = counts[BIOME.DESERT] + counts[BIOME.TEMPERATE] + counts[BIOME.ICE]
	return {
		counts,
		desert: counts[BIOME.DESERT] / total,
		temperate: counts[BIOME.TEMPERATE] / total,
		ice: counts[BIOME.ICE] / total,
	}
}

test('makes the ice rare and the desert a little larger than the forest', () => {
	const { desert, temperate, ice } = sampleBiomes()
	assert.ok(ice > 0.03 && ice < 0.12, `ice ${ice}`)
	assert.ok(desert > temperate, `desert ${desert}, forest ${temperate}`)
	assert.ok(desert / (desert + temperate) < 0.6)
})

test('the bias and threshold move the shares monotonically', () => {
	const base = sampleBiomes(settings, ['alpha'])
	const moreDesert = sampleBiomes({ ...settings, desertBias: settings.desertBias + 0.1 }, ['alpha'])
	const lessIce = sampleBiomes({ ...settings, iceThreshold: settings.iceThreshold + 0.1 }, [
		'alpha',
	])
	assert.ok(moreDesert.desert > base.desert)
	assert.ok(lessIce.ice < base.ice)
})

test('the forest ring keeps the desert away from the ice', () => {
	const offset = createBiomeOffset('ring')
	const bounds = getBiomeGradientBounds(settings)
	// Narrowest possible ring in world units.
	const ringWidth = settings.iceRing / bounds.ice
	const fields = {}
	let ice = 0
	for (let i = -300; i <= 300; i++) {
		for (let j = -300; j <= 300; j++) {
			const x = i * 200
			const z = j * 200
			getBiomeFields(x, z, offset, settings, fields)
			const biome = getBiome(fields)
			if (biome === BIOME.DESERT) assert.ok(fields.ice < -settings.iceRing)
			if (biome !== BIOME.ICE) continue
			ice++
			// No desert within the narrowest ring of any ice point.
			for (const [dx, dz] of [
				[ringWidth, 0],
				[-ringWidth, 0],
				[0, ringWidth],
				[0, -ringWidth],
			]) {
				const neighbour = getBiomeFields(x + dx * 0.9, z + dz * 0.9, offset, settings)
				assert.notEqual(getBiome(neighbour), BIOME.DESERT)
			}
		}
	}
	assert.ok(ice > 0)
})

test('the gradient bounds hold and keep the former constant at size 1', () => {
	assert.ok(
		Math.abs(getBiomeGradientBounds({ ...settings, size: 1, iceSize: 1 }).climate - 0.014) < 1e-4,
	)
	const bounds = getBiomeGradientBounds(settings)
	const offset = createBiomeOffset('gradient')
	const step = 0.5
	for (let index = 0; index < 4000; index++) {
		const x = ((index * 7919) % 60000) - 30000
		const z = ((index * 104729) % 60000) - 30000
		const climate = getClimateNoise(x, z, offset, settings)
		const climateSlope =
			Math.hypot(
				getClimateNoise(x + step, z, offset, settings) - climate,
				getClimateNoise(x, z + step, offset, settings) - climate,
			) / step
		assert.ok(climateSlope < bounds.climate, `climate slope ${climateSlope}`)
		const ice = getIceValue(x, z, offset, settings)
		const iceSlope =
			Math.hypot(
				getIceValue(x + step, z, offset, settings) - ice,
				getIceValue(x, z + step, offset, settings) - ice,
			) / step
		assert.ok(iceSlope < bounds.ice, `ice slope ${iceSlope}`)
	}
})

test('the size settings zoom the fields', () => {
	const offset = [0, 0, 3.5, 7.25]
	const doubled = { ...settings, size: settings.size * 2, iceSize: settings.iceSize * 2 }
	for (const [x, z] of [
		[120, -480],
		[-3300, 9100],
		[25000, 17000],
	]) {
		const near = getBiomeFields(x, z, offset, settings)
		const far = getBiomeFields(x * 2, z * 2, offset, doubled)
		assert.ok(Math.abs(near.climate - far.climate) < 1e-9)
		assert.ok(Math.abs(near.ice - far.ice) < 1e-9)
	}
})

test('picks the biome and the border margins from both fields', () => {
	assert.equal(getBiome({ climate: -1, ice: 0 }), BIOME.ICE)
	assert.equal(getBiome({ climate: 0, ice: -0.5 }), BIOME.TEMPERATE)
	assert.equal(getBiome({ climate: -0.01, ice: -0.5 }), BIOME.DESERT)

	assert.equal(isNearBiomeBorder({ climate: 1, ice: ICE_BORDER_MARGIN / 2 }), true)
	assert.equal(isNearBiomeBorder({ climate: 1, ice: ICE_BORDER_MARGIN * 2 }), false)
	assert.equal(isNearBiomeBorder({ climate: BIOME_BORDER_MARGIN / 2, ice: -1 }), true)
	assert.equal(isNearBiomeBorder({ climate: BIOME_BORDER_MARGIN * 2, ice: -1 }), false)
	// Along the ring the climate follows the ice field, so it takes its margin.
	const ringDriven = { climate: ICE_BORDER_MARGIN * 2, ice: -0.2, ringDriven: true }
	assert.equal(isNearBiomeBorder(ringDriven), false)
})

test('settings are mutable copies of the defaults', () => {
	const copy = createBiomeSettings()
	assert.deepEqual(copy, BIOME_DEFAULTS)
	copy.size = 3
	assert.notEqual(BIOME_DEFAULTS.size, 3)
})
