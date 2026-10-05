import assert from 'node:assert/strict'
import test from 'node:test'
import { BIOME_BORDER_MARGIN, createBiomeOffset, getBiomeValue } from '../src/biome.js'
import {
	SEA_SURFACE_Y,
	TERRAIN_DEFAULTS,
	createTerrainNoises,
	getHeight,
} from '../src/chunkGeometry.js'
import { getCoastRockMask } from '../src/coast.js'
import { IMPOSTOR_INSTANCE_STRIDE, IMPOSTOR_TYPE } from '../src/impostors/impostorTypes.js'
import {
	BOAT_DEFAULTS,
	SCENERY_CATEGORIES,
	SCENERY_CONFIG,
	SCENERY_DEFAULT_SIZES,
	SCENERY_TYPE_KEYS,
	SEA_ROCK_DEFAULTS,
	createScenerySettings,
	generateSceneryInstances,
	isCoastBand,
	isSceneryBand,
	packTint,
} from '../src/sceneryPlacement.js'
import { getTerrainBand, TERRAIN_BAND, TERRAIN_BANDS } from '../src/terrainBands.js'

// The production terrain.
const params = TERRAIN_DEFAULTS
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
			yaw: data[k + 4],
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

// Farthest a sea rock satellite can stand from its candidate.
const coast = SCENERY_CONFIG.coast
const satelliteReach =
	SEA_ROCK_DEFAULTS.satellites.distance.max *
	coast.footprint *
	SEA_ROCK_DEFAULTS.scale.max *
	SCENERY_DEFAULT_SIZES.seaRock

test('keeps every instance inside its own chunk without duplicates', () => {
	const seen = new Set()
	for (const [i, j, data] of chunks) {
		for (const instance of instances(data, i, j)) {
			// Sea rock satellites belong to their candidate's chunk, even across its border.
			const reach = instance.type === IMPOSTOR_TYPE.SEA_ROCK ? satelliteReach : 0
			assert.ok(instance.localX >= -size / 2 - reach && instance.localX < size / 2 + reach)
			assert.ok(instance.localZ >= -size / 2 - reach && instance.localZ < size / 2 + reach)
			const key = `${instance.x.toFixed(3)}|${instance.z.toFixed(3)}`
			assert.equal(seen.has(key), false)
			seen.add(key)
		}
	}
})

test('scenery grows only on the grass, land, and rocks bands', () => {
	assert.deepEqual(
		TERRAIN_BANDS.filter((_, band) => isSceneryBand(band)),
		Object.keys(SCENERY_CONFIG.temperate.bands),
	)
})

test('sea rocks stand on sand and the shallow sea, rising above the surface', () => {
	assert.deepEqual(
		TERRAIN_BANDS.filter((_, band) => isCoastBand(band)),
		['sea', 'sand'],
	)
	let count = 0
	for (const [i, j, data] of chunks) {
		for (const instance of instances(data, i, j)) {
			if (instance.type !== IMPOSTOR_TYPE.SEA_ROCK) continue
			const height = getHeight(instance.x, instance.z, noises, params, biomeOffset)
			assert.ok(height >= -SEA_ROCK_DEFAULTS.maxDepth)
			const base = Math.max(height, SEA_SURFACE_Y) - coast.sink * instance.scale
			assert.ok(Math.abs(instance.y - base) < 1e-3)
			count++
		}
	}
	assert.ok(count > 0)
})

test('gathers sea rocks on rocky coast', () => {
	let rocky = 0
	let plain = 0
	for (const [i, j, data] of chunks) {
		for (const instance of instances(data, i, j)) {
			if (instance.type !== IMPOSTOR_TYPE.SEA_ROCK) continue
			const mask = getCoastRockMask(instance.x, instance.z, biomeOffset, params.coast.mask)
			if (mask > 0.5) rocky++
			else plain++
		}
	}
	assert.ok(rocky > plain, `${rocky} rocks on rocky coast, ${plain} elsewhere`)
})

function seaRocksOf(results) {
	const rocks = []
	results.forEach((data, index) => {
		const [i, j] = chunks[index]
		for (const instance of instances(data, i, j)) {
			if (instance.type === IMPOSTOR_TYPE.SEA_ROCK) rocks.push(instance)
		}
	})
	return rocks
}

test('places sea rocks by their depth, scale, and satellite settings', () => {
	const baseline = seaRocksOf(chunks.map(([, , data]) => data))
	const seaRocks = (overrides) => ({
		seaRocks: { ...createScenerySettings().seaRocks, ...overrides },
	})
	const size = SCENERY_DEFAULT_SIZES.seaRock

	const shallow = seaRocksOf(generateAll(seaRocks({ maxDepth: 1.5 })))
	assert.ok(shallow.length > 0 && shallow.length < baseline.length)
	for (const rock of shallow) {
		assert.ok(getHeight(rock.x, rock.z, noises, params, biomeOffset) >= -1.5)
	}

	const alone = seaRocksOf(
		generateAll(seaRocks({ satellites: { ...SEA_ROCK_DEFAULTS.satellites, count: 0 } })),
	)
	assert.ok(alone.length > 0 && alone.length < baseline.length)

	// Without satellites, every rock draws its scale from the range.
	const scale = { min: 1, max: 1.5, bias: 1 }
	const ranged = seaRocksOf(
		generateAll(seaRocks({ scale, satellites: { ...SEA_ROCK_DEFAULTS.satellites, count: 0 } })),
	)
	assert.equal(ranged.length, alone.length)
	for (const rock of ranged) {
		assert.ok(rock.scale >= scale.min * size - 1e-5 && rock.scale <= scale.max * size + 1e-5)
	}

	// Sea rock settings leave the other scenery unchanged; the boats avoid the
	// rocks, so they may move.
	const others = (results) =>
		results.reduce((count, data) => count + data.length, 0) / IMPOSTOR_INSTANCE_STRIDE -
		seaRocksOf(results).length -
		countCategory(results, 'boats')
	assert.equal(
		others(generateAll(seaRocks({ maxDepth: 1.5 }))),
		others(chunks.map(([, , data]) => data)),
	)
})

test('follows the rocky coast mask settings', () => {
	const mask = { ...params.coast.mask, threshold: params.coast.mask.threshold + 0.5 }
	const lessRocky = { ...params, coast: { ...params.coast, mask } }
	const rocks = seaRocksOf(chunks.map(([i, j]) => generate(i, j, { params: lessRocky })))
	const baseline = seaRocksOf(chunks.map(([, , data]) => data))
	assert.ok(rocks.length < baseline.length, `${rocks.length} rocks, ${baseline.length} before`)
})

test('places only sea rocks and boats in water or on beaches, and nothing on snow', () => {
	const bands = new Set()
	for (const [i, j, data] of chunks) {
		for (const instance of instances(data, i, j)) {
			if (instance.type === IMPOSTOR_TYPE.SEA_ROCK || instance.type === IMPOSTOR_TYPE.BOAT) continue
			const height = getHeight(instance.x, instance.z, noises, params, biomeOffset)
			const band = getTerrainBand(instance.x, height, instance.z)
			assert.ok(band >= TERRAIN_BAND.grass && band <= TERRAIN_BAND.rocks)
			assert.ok(Math.abs(instance.y - (height - SCENERY_CONFIG.sink * instance.scale)) < 1e-3)
			// Temperate types follow the band the shader colors under them.
			if (getBiomeValue(instance.x, instance.z, biomeOffset) > 0) {
				const table = SCENERY_CONFIG.temperate.bands[TERRAIN_BANDS[band]]
				assert.ok(table.some(([type]) => type === instance.type))
			}
			bands.add(band)
		}
	}
	assert.ok(bands.size > 1)
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
			// Sea rocks and boats float in both biomes, up to the border.
			if (instance.type === IMPOSTOR_TYPE.SEA_ROCK || instance.type === IMPOSTOR_TYPE.BOAT) continue
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

test('painted types vary in brightness only: their hue comes from the palettes', () => {
	const painted = new Set([
		IMPOSTOR_TYPE.ROUND_TREE,
		IMPOSTOR_TYPE.CONIFER,
		IMPOSTOR_TYPE.CACTUS_ONE_ARM,
		IMPOSTOR_TYPE.CACTUS_TWO_ARMS,
		IMPOSTOR_TYPE.SEA_ROCK,
	])
	let count = 0
	for (const [, , data] of chunks) {
		for (let k = 0; k < data.length; k += IMPOSTOR_INSTANCE_STRIDE) {
			if (!painted.has(data[k + 5])) continue
			const tint = data[k + 6]
			const r = tint % 256
			const g = Math.floor(tint / 256) % 256
			const b = Math.floor(tint / 65536)
			assert.ok(r === g && g === b, `gray tint, got ${r} ${g} ${b}`)
			count++
		}
	}
	assert.ok(count > 0)
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
	assert.equal(countCategory(denser, 'seaRocks'), countCategory(baseline, 'seaRocks'))
	assert.equal(countCategory(noCacti, 'cacti'), 0)
	const noSeaRocks = generateAll({ density: { ...defaults.density, seaRocks: 0 } })
	assert.equal(countCategory(noSeaRocks, 'seaRocks'), 0)
	assert.equal(countCategory(noSeaRocks, 'trees'), countCategory(baseline, 'trees'))
	assert.equal(countCategory(noCacti, 'trees'), countCategory(baseline, 'trees'))
})

test('scales only the edited type', () => {
	const defaults = createScenerySettings()
	const key = SCENERY_TYPE_KEYS[IMPOSTOR_TYPE.CONIFER]
	const [i, j, baseline] = chunks.find(([, , data]) => countByType(data).has(IMPOSTOR_TYPE.CONIFER))
	const scaled = generate(i, j, {}, { size: { ...defaults.size, [key]: 2 } })

	assert.equal(scaled.length, baseline.length)
	for (let k = 0; k < baseline.length; k += IMPOSTOR_INSTANCE_STRIDE) {
		const factor = baseline[k + 5] === IMPOSTOR_TYPE.CONIFER ? 2 / defaults.size[key] : 1
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
	// The boats have their own cap (settings.boats.maxPerChunk).
	const boats = countCategory([baseline], 'boats')
	const total = baseline.length / IMPOSTOR_INSTANCE_STRIDE - boats
	const cap = Math.floor(total / 3)
	const capped = generate(i, j, {}, { maxPerChunk: cap })

	assert.equal(capped.length / IMPOSTOR_INSTANCE_STRIDE, cap + boats)
	assert.deepEqual(generate(i, j, {}, { maxPerChunk: cap }), capped)
	const kept = new Set()
	for (let k = 0; k < baseline.length; k += IMPOSTOR_INSTANCE_STRIDE) {
		kept.add(`${baseline[k]}|${baseline[k + 2]}`)
	}
	for (let k = 0; k < capped.length; k += IMPOSTOR_INSTANCE_STRIDE) {
		assert.ok(kept.has(`${capped[k]}|${capped[k + 2]}`))
	}
	assert.equal(generate(i, j, {}, { maxPerChunk: 0 }).length / IMPOSTOR_INSTANCE_STRIDE, boats)
})

// Boats, as instances with world-space bases, of every chunk of `results`.
function boatsOf(results) {
	return results.flatMap((data, index) => {
		const [i, j] = chunks[index]
		return [...instances(data, i, j)].filter((instance) => instance.type === IMPOSTOR_TYPE.BOAT)
	})
}

const boat = SCENERY_CONFIG.boat
const depthAt = (x, z) => -getHeight(x, z, noises, params, biomeOffset)
// Every candidate spot active, so the rules see many boats whatever the
// default density.
const boatDensity = { density: { ...createScenerySettings().density, boats: 1 } }
const boatChunks = generateAll(boatDensity)

test('places boats in the sea depth band, afloat, inside their chunk', () => {
	const { depth, draft, maxPerChunk, rockClearance } = BOAT_DEFAULTS
	let count = 0
	for (const [index, [i, j]] of chunks.entries()) {
		const data = boatChunks[index]
		const boats = boatsOf([data]).length
		assert.ok(boats <= maxPerChunk, `${boats} boats in chunk ${i}, ${j}`)
		for (const instance of instances(data, i, j)) {
			if (instance.type !== IMPOSTOR_TYPE.BOAT) continue
			const { x, z, yaw, scale } = instance
			// Stored as a 32-bit float.
			assert.equal(scale, Math.fround(SCENERY_DEFAULT_SIZES.boat))
			const centerDepth = depthAt(x, z)
			assert.ok(centerDepth >= depth.min && centerDepth <= depth.max, `depth ${centerDepth}`)
			// Bow and stern along the yaw, as rotateYaw() turns local +Z.
			const half = (boat.length / 2) * scale
			for (const sign of [-1, 1]) {
				const endDepth = depthAt(x + sign * Math.sin(yaw) * half, z + sign * Math.cos(yaw) * half)
				assert.ok(endDepth >= depth.min, `hull end depth ${endDepth}`)
			}
			assert.ok(Math.abs(instance.y - (SEA_SURFACE_Y - draft * scale)) < 1e-3)
			// Half a boat and half the clearance from the chunk's border.
			const limit = size / 2 - half - rockClearance / 2 + 1e-3
			assert.ok(Math.abs(instance.localX) <= limit && Math.abs(instance.localZ) <= limit)
			count++
		}
	}
	assert.ok(count > 0)
})

// Distance from (px, pz) to the segment from (ax, az) to (bx, bz).
function segmentDistance(px, pz, ax, az, bx, bz) {
	const dx = bx - ax
	const dz = bz - az
	const t = Math.min(Math.max(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0), 1)
	return Math.hypot(px - (ax + dx * t), pz - (az + dz * t))
}

// Every boat's hull capsule keeps the clearance from every rock (of any chunk)
// and every other boat.
function assertBoatsClear(results, clearance) {
	const boats = boatsOf(results)
	const rocks = seaRocksOf(results)
	for (const { x, z, yaw, scale } of boats) {
		const half = ((boat.length - boat.beam) / 2) * scale
		const [ax, az, bx, bz] = [
			x - Math.sin(yaw) * half,
			z - Math.cos(yaw) * half,
			x + Math.sin(yaw) * half,
			z + Math.cos(yaw) * half,
		]
		for (const rock of rocks) {
			const distance = segmentDistance(rock.x, rock.z, ax, az, bx, bz)
			const needed = coast.footprint * rock.scale + (boat.beam / 2) * scale + clearance
			assert.ok(distance >= needed - 1e-3, `rock ${distance.toFixed(2)} < ${needed.toFixed(2)}`)
		}
	}
	for (let a = 0; a < boats.length; a++) {
		for (let b = a + 1; b < boats.length; b++) {
			const distance = Math.hypot(boats[a].x - boats[b].x, boats[a].z - boats[b].z)
			const needed = (boat.length / 2) * (boats[a].scale + boats[b].scale) + clearance
			assert.ok(distance >= needed - 1e-3, `boats ${distance.toFixed(2)} apart`)
		}
	}
	return boats.length
}

test('keeps boats clear of every sea rock and of each other, across chunk borders', () => {
	assert.ok(
		assertBoatsClear(
			chunks.map(([, , data]) => data),
			BOAT_DEFAULTS.rockClearance,
		) > 0,
	)
	assert.ok(assertBoatsClear(boatChunks, BOAT_DEFAULTS.rockClearance) > 0)
	// A wider clearance and larger rocks with far satellites still hold.
	const defaults = createScenerySettings()
	const settings = {
		...boatDensity,
		size: { ...defaults.size, seaRock: 3 },
		seaRocks: {
			...defaults.seaRocks,
			satellites: { ...defaults.seaRocks.satellites, count: 4, distance: { min: 2, max: 3 } },
		},
		boats: { ...defaults.boats, rockClearance: 10 },
	}
	assert.ok(assertBoatsClear(generateAll(settings), 10) > 0)
})

test('follows the boat settings: density, size, count, and depth band', () => {
	const defaults = createScenerySettings()
	const baseline = chunks.map(([, , data]) => data)
	const withoutBoats = (results) =>
		results.map((data) => {
			const kept = []
			for (let k = 0; k < data.length; k += IMPOSTOR_INSTANCE_STRIDE) {
				if (data[k + 5] !== IMPOSTOR_TYPE.BOAT) {
					kept.push(...data.subarray(k, k + IMPOSTOR_INSTANCE_STRIDE))
				}
			}
			return kept
		})

	const none = generateAll({ density: { ...defaults.density, boats: 0 } })
	assert.equal(countCategory(none, 'boats'), 0)
	assert.deepEqual(withoutBoats(none), withoutBoats(baseline))

	// One size for every boat, set by the boat size alone.
	const larger = generateAll({ ...boatDensity, size: { ...defaults.size, boat: 1.5 } })
	assert.deepEqual(withoutBoats(larger), withoutBoats(baseline))
	assert.deepEqual(withoutBoats(boatChunks), withoutBoats(baseline))
	assert.ok(boatsOf(larger).every(({ scale }) => scale === 1.5))
	assert.ok(boatsOf(larger).length > 0)

	assert.ok(boatChunks.some((data) => boatsOf([data]).length > 1))
	const single = generateAll({ ...boatDensity, boats: { ...defaults.boats, maxPerChunk: 1 } })
	assert.ok(single.every((data) => boatsOf([data]).length <= 1))
	assert.ok(boatsOf(single).length > 0)
	const noneAllowed = generateAll({ ...boatDensity, boats: { ...defaults.boats, maxPerChunk: 0 } })
	assert.equal(countCategory(noneAllowed, 'boats'), 0)

	const depth = { min: 10, max: 14 }
	const band = boatsOf(generateAll({ ...boatDensity, boats: { ...defaults.boats, depth } }))
	assert.ok(band.length > 0)
	for (const { x, z } of band) {
		const centerDepth = depthAt(x, z)
		assert.ok(centerDepth >= depth.min && centerDepth <= depth.max)
	}
})
