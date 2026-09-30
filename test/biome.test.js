import assert from 'node:assert/strict'
import test from 'node:test'
import {
	BIOME,
	createBiomeOffset,
	getBiome,
	getBiomeValue,
	snoise,
} from '../src/biome.js'

test('creates a deterministic seed-dependent biome offset', () => {
	assert.deepEqual(createBiomeOffset('alpha'), createBiomeOffset('alpha'))
	assert.notDeepEqual(createBiomeOffset('alpha'), createBiomeOffset('beta'))

	for (const value of createBiomeOffset('alpha')) {
		assert.ok(Math.abs(value) <= 10000)
	}
})

test('keeps the simplex port bounded and continuous', () => {
	for (let i = 0; i < 2000; i++) {
		const x = (i * 37.13) % 500 - 250
		const z = (i * 91.71) % 500 - 250
		const value = snoise(x, z)

		assert.ok(value >= -1 && value <= 1, `snoise(${x}, ${z}) = ${value}`)
		assert.ok(Math.abs(snoise(x + 0.001, z) - value) < 0.01)
	}
})

test('produces both biomes and depends on the offset', () => {
	const offset = createBiomeOffset('biomes')
	const counts = { [BIOME.DESERT]: 0, [BIOME.TEMPERATE]: 0 }
	let differs = false

	for (let i = -20; i <= 20; i++) {
		for (let j = -20; j <= 20; j++) {
			const x = i * 500
			const z = j * 500
			const value = getBiomeValue(x, z, offset)
			counts[getBiome(value)]++
			if (Math.abs(value - getBiomeValue(x, z, [0, 0])) > 1e-6) differs = true
		}
	}

	assert.ok(counts[BIOME.DESERT] > 0)
	assert.ok(counts[BIOME.TEMPERATE] > 0)
	assert.equal(differs, true)
})
