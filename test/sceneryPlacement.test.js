import assert from 'node:assert/strict'
import test from 'node:test'
import { BIOME_BORDER_MARGIN, createBiomeOffset, getBiomeValue } from '../src/biome.js'
import { createTerrainNoises, getHeight } from '../src/chunkGeometry.js'
import {
	IMPOSTOR_INSTANCE_STRIDE,
	IMPOSTOR_TYPE,
} from '../src/impostors/impostorTypes.js'
import {
	SCENERY_CATEGORIES,
	SCENERY_CONFIG,
	SCENERY_DEFAULT_SIZES,
	SCENERY_TYPE_KEYS,
	createScenerySettings,
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
function generate(i, j, overrides = {}, settingsOverrides = {}) {
	return generateSceneryInstances({
		size,
		worldX: (i + 0.5) * size,
		worldZ: (j + 0.5) * size,
		settings: { ...createScenerySettings(), ...settingsOverrides },
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
	assert.throws(() => generate(0, 0, {}, { cellSize: 7 }))
})

test('packs tint channels as bytes', () => {
	assert.equal(packTint(0, 0, 0), 0)
	assert.equal(packTint(2, 2, 2), 255 + 255 * 256 + 255 * 65536)
	assert.equal(packTint(1, 0, 0), 128)
	assert.ok(Number.isInteger(Math.fround(packTint(2, 2, 2))))
})

function countByType(data) {
	const counts = new Map()
	for (let k = 5; k < data.length; k += IMPOSTOR_INSTANCE_STRIDE) {
		counts.set(data[k], (counts.get(data[k]) ?? 0) + 1)
	}
	return counts
}

function generateAll(settingsOverrides) {
	return chunks.map(([i, j]) => generate(i, j, {}, settingsOverrides))
}

function countCategory(results, category) {
	let count = 0
	for (const data of results) {
		const counts = countByType(data)
		for (const type of SCENERY_CATEGORIES[category]) count += counts.get(type) ?? 0
	}
	return count
}

test('changes only the density of the edited category', () => {
	const defaults = createScenerySettings()
	const baseline = chunks.map(([, , data]) => data)
	const denser = generateAll({ density: { ...defaults.density, trees: 1.5 } })
	const noCacti = generateAll({ density: { ...defaults.density, cacti: 0 } })

	assert.ok(countCategory(denser, 'trees') > countCategory(baseline, 'trees'))
	assert.equal(countCategory(denser, 'cacti'), countCategory(baseline, 'cacti'))
	assert.equal(countCategory(denser, 'rocks'), countCategory(baseline, 'rocks'))
	assert.equal(countCategory(noCacti, 'cacti'), 0)
	assert.equal(countCategory(noCacti, 'trees'), countCategory(baseline, 'trees'))
})

test('scales only the edited type', () => {
	const defaults = createScenerySettings()
	const key = SCENERY_TYPE_KEYS[IMPOSTOR_TYPE.CONIFER]
	const [i, j, baseline] = chunks.find(([, , data]) =>
		countByType(data).has(IMPOSTOR_TYPE.CONIFER),
	)
	const scaled = generate(i, j, {}, { size: { ...defaults.size, [key]: 2 } })

	assert.equal(scaled.length, baseline.length)
	for (let k = 0; k < baseline.length; k += IMPOSTOR_INSTANCE_STRIDE) {
		const factor =
			baseline[k + 5] === IMPOSTOR_TYPE.CONIFER ? 2 / defaults.size[key] : 1
		assert.ok(Math.abs(scaled[k + 3] - baseline[k + 3] * factor) < 1e-5)
	}
})

test('defines a default size for every scenery type', () => {
	assert.deepEqual(
		Object.keys(SCENERY_DEFAULT_SIZES).sort(),
		Object.values(SCENERY_TYPE_KEYS).sort(),
	)
	assert.deepEqual(createScenerySettings().size, SCENERY_DEFAULT_SIZES)
})

test('caps instances per chunk with a deterministic subset', () => {
	const [i, j, baseline] = chunks.reduce((best, chunk) =>
		chunk[2].length > best[2].length ? chunk : best,
	)
	const total = baseline.length / IMPOSTOR_INSTANCE_STRIDE
	const cap = Math.floor(total / 3)
	const capped = generate(i, j, {}, { maxPerChunk: cap })

	assert.equal(capped.length / IMPOSTOR_INSTANCE_STRIDE, cap)
	assert.deepEqual(generate(i, j, {}, { maxPerChunk: cap }), capped)
	const kept = new Set()
	for (let k = 0; k < baseline.length; k += IMPOSTOR_INSTANCE_STRIDE) {
		kept.add(`${baseline[k]}|${baseline[k + 2]}`)
	}
	for (let k = 0; k < capped.length; k += IMPOSTOR_INSTANCE_STRIDE) {
		assert.ok(kept.has(`${capped[k]}|${capped[k + 2]}`))
	}
	assert.equal(generate(i, j, {}, { maxPerChunk: 0 }).length, 0)
})
