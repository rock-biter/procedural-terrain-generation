import assert from 'node:assert/strict'
import test from 'node:test'
import { BIOME_BORDER_MARGIN, createBiomeOffset, getBiomeValue } from '../src/biome.js'
import { createTerrainNoises, getHeight } from '../src/chunkGeometry.js'
import {
	IMPOSTOR_INSTANCE_STRIDE,
	IMPOSTOR_TYPE,
} from '../src/impostors/impostorTypes.js'
import {
	SCENERY_CONFIG,
	generateSceneryInstances,
	isSnow,
	packTint,
} from '../src/sceneryPlacement.js'

const params = {
	amplitude: 23,
	frequency: { x: 0.5, z: 0.5 },
	octaves: 3,
	lacunarity: 2,
	persistance: 0.5,
}
const seed = 'scenery-test'
const noises = createTerrainNoises(seed, params.octaves)
const biomeOffset = createBiomeOffset(seed)
const size = 256
const cellSize = 8

function generate(i, j, overrides = {}) {
	return generateSceneryInstances({
		size,
		worldX: (i + 0.5) * size,
		worldZ: (j + 0.5) * size,
		cellSize,
		seed,
		noises,
		params,
		biomeOffset,
		...overrides,
	})
}

function* instances(data, i, j) {
	for (let k = 0; k < data.length; k += IMPOSTOR_INSTANCE_STRIDE) {
		yield {
			x: data[k] + (i + 0.5) * size,
			y: data[k + 1],
			z: data[k + 2] + (j + 0.5) * size,
			localX: data[k],
			localZ: data[k + 2],
			scale: data[k + 3],
			type: data[k + 5],
		}
	}
}

// Sample a block of chunks large enough to cross biomes.
const chunks = []
for (let i = -3; i <= 3; i++) {
	for (let j = -3; j <= 3; j++) chunks.push([i, j, generate(i, j)])
}

test('produces deterministic output independent of generation order', () => {
	const [i, j, data] = chunks[10]
	assert.deepEqual(generate(i, j), data)
	assert.ok(chunks.some(([, , chunk]) => chunk.length > 0))
})

test('keeps every instance inside its own chunk without duplicates', () => {
	const seen = new Set()
	for (const [i, j, data] of chunks) {
		for (const instance of instances(data, i, j)) {
			assert.ok(instance.localX >= -size / 2 && instance.localX < size / 2)
			assert.ok(instance.localZ >= -size / 2 && instance.localZ < size / 2)
			const key = `${instance.x.toFixed(3)}|${instance.z.toFixed(3)}`
			assert.equal(seen.has(key), false)
			seen.add(key)
		}
	}
})

test('never places scenery in water, on beaches, or on snow', () => {
	for (const [i, j, data] of chunks) {
		for (const instance of instances(data, i, j)) {
			const height = getHeight(instance.x, instance.z, noises, params)
			assert.ok(height >= SCENERY_CONFIG.grassLevel)
			assert.equal(isSnow(instance.x, height, instance.z), false)
			assert.ok(
				Math.abs(instance.y - (height - SCENERY_CONFIG.sink * instance.scale)) < 1e-3,
			)
		}
	}
})

test('keeps desert and temperate types in their biome', () => {
	const desertOnly = new Set([
		IMPOSTOR_TYPE.CACTUS_ONE_ARM,
		IMPOSTOR_TYPE.CACTUS_TWO_ARMS,
		IMPOSTOR_TYPE.LAYERED_ROCK,
	])
	const temperateOnly = new Set([IMPOSTOR_TYPE.ROUND_TREE, IMPOSTOR_TYPE.CONIFER])
	let desertCount = 0
	let temperateCount = 0

	for (const [i, j, data] of chunks) {
		for (const instance of instances(data, i, j)) {
			const biomeValue = getBiomeValue(instance.x, instance.z, biomeOffset)
			assert.ok(Math.abs(biomeValue) >= BIOME_BORDER_MARGIN)
			if (desertOnly.has(instance.type)) {
				assert.ok(biomeValue < 0)
				desertCount++
			}
			if (temperateOnly.has(instance.type)) {
				assert.ok(biomeValue > 0)
				temperateCount++
			}
		}
	}

	assert.ok(desertCount + temperateCount > 0)
})

test('rejects cell sizes that do not divide the chunk', () => {
	assert.throws(() => generate(0, 0, { cellSize: 7 }))
})

test('packs tint channels as bytes', () => {
	assert.equal(packTint(0, 0, 0), 0)
	assert.equal(packTint(2, 2, 2), 255 + 255 * 256 + 255 * 65536)
	assert.equal(packTint(1, 0, 0), 128)
	assert.ok(Number.isInteger(Math.fround(packTint(2, 2, 2))))
})
