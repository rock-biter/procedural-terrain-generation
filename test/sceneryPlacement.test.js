import assert from 'node:assert/strict'
import test from 'node:test'
import {
	BIOME,
	createBiomeOffset,
	getBiome,
	getBiomeFields,
	getIceValue,
	ICE_BORDER_MARGIN,
	isNearBiomeBorder,
} from '../src/biome.js'
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
	ICE_SPIKE_DEFAULTS,
	SCENERY_CATEGORIES,
	SCENERY_CONFIG,
	SCENERY_DEFAULT_SIZES,
	SCENERY_TYPE_KEYS,
	SEA_ROCK_DEFAULTS,
	createScenerySettings,
	generateSceneryInstances,
	getIceSpikeMask,
	isCoastBand,
	isSceneryBand,
	packBoatTint,
	packTint,
} from '../src/sceneryPlacement.js'
import { SEA_BOAT_DEPTH_STEP } from '../src/seaSurfacePolicy.js'
import { SCENERY_BIOME_SLOTS, SCENERY_PAINTED_TYPES } from '../src/sceneryPalettePolicy.js'
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
			tint: data[k + 6],
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

test('places only sea rocks, boats, and palms in water or on beaches, and nothing on snow', () => {
	const bands = new Set()
	for (const [i, j, data] of chunks) {
		for (const instance of instances(data, i, j)) {
			if (instance.type === IMPOSTOR_TYPE.SEA_ROCK || instance.type === IMPOSTOR_TYPE.BOAT) continue
			const height = getHeight(instance.x, instance.z, noises, params, biomeOffset)
			const band = getTerrainBand(instance.x, height, instance.z)
			// The deep ocean's palms stand on its islets' beaches too.
			const lowest = instance.type === IMPOSTOR_TYPE.PALM ? TERRAIN_BAND.sand : TERRAIN_BAND.grass
			assert.ok(band >= lowest && band <= TERRAIN_BAND.rocks)
			assert.ok(Math.abs(instance.y - (height - SCENERY_CONFIG.sink * instance.scale)) < 1e-3)
			// Temperate types follow the band the shader colors under them.
			const fields = getBiomeFields(instance.x, instance.z, biomeOffset, params.biomes)
			if (getBiome(fields) === BIOME.TEMPERATE) {
				const table = SCENERY_CONFIG.temperate.bands[TERRAIN_BANDS[band]]
				assert.ok(table.some(([type]) => type === instance.type))
			}
			bands.add(band)
		}
	}
	assert.ok(bands.size > 1)
})

// The types each biome may place, whatever the band.
const biomeTypes = {
	[BIOME.TEMPERATE]: new Set(
		Object.values(SCENERY_CONFIG.temperate.bands).flatMap((table) => table.map(([type]) => type)),
	),
	[BIOME.DESERT]: new Set(SCENERY_CONFIG.desert.types.map(([type]) => type)),
	[BIOME.ICE]: new Set(SCENERY_CONFIG.ice.types.map(([type]) => type)),
	// The deep ocean's islets carry only their palms.
	[BIOME.DEEP_OCEAN]: new Set([SCENERY_CONFIG.palm.type]),
}

// Every land instance stands off the biome borders, in a biome that places
// its type; returns the count per biome.
function assertBiomeTypes(results, offset, coords) {
	const counts = { [BIOME.DESERT]: 0, [BIOME.TEMPERATE]: 0, [BIOME.ICE]: 0, [BIOME.DEEP_OCEAN]: 0 }
	results.forEach((data, index) => {
		const [i, j] = coords[index]
		for (const instance of instances(data, i, j)) {
			// Sea rocks and boats float in every biome, up to the border.
			if (instance.type === IMPOSTOR_TYPE.SEA_ROCK || instance.type === IMPOSTOR_TYPE.BOAT) continue
			const fields = getBiomeFields(instance.x, instance.z, offset, params.biomes)
			assert.equal(isNearBiomeBorder(fields), false)
			const biome = getBiome(fields)
			assert.ok(biomeTypes[biome].has(instance.type), `type ${instance.type} in biome ${biome}`)
			counts[biome]++
		}
	})
	return counts
}

test('keeps desert and temperate types in their biome', () => {
	const counts = assertBiomeTypes(
		chunks.map(([, , data]) => data),
		biomeOffset,
		chunks,
	)
	assert.ok(counts[BIOME.DESERT] + counts[BIOME.TEMPERATE] > 0)
	// Cacti only in the desert, trees only in the temperate biome.
	assert.ok(!biomeTypes[BIOME.TEMPERATE].has(IMPOSTOR_TYPE.CACTUS_ONE_ARM))
	assert.ok(!biomeTypes[BIOME.DESERT].has(IMPOSTOR_TYPE.ROUND_TREE))
})

// A seed whose spawn lies in the ice, by a frozen coast.
const iceSeed = 'ice194'
const iceNoises = createTerrainNoises(iceSeed, params.octaves)
const iceOffset = createBiomeOffset(iceSeed)
const iceCoords = []
for (let i = -3; i <= 3; i++) {
	for (let j = -3; j <= 3; j++) iceCoords.push([i, j])
}
function generateIce(settingsOverrides = {}) {
	return iceCoords.map(([i, j]) =>
		generate(i, j, { seed: iceSeed, noises: iceNoises, biomeOffset: iceOffset }, settingsOverrides),
	)
}
const iceChunks = generateIce()

test('places boulders and ice spikes in the ice', () => {
	const { BOULDER, LAYERED_ROCK, ICE_SPIKES_TWO, ICE_SPIKES_THREE } = IMPOSTOR_TYPE
	assert.deepEqual(
		[...biomeTypes[BIOME.ICE]].sort(),
		[BOULDER, ICE_SPIKES_TWO, ICE_SPIKES_THREE].sort(),
	)
	// The layered rocks stand only in the desert, the spikes only in the ice.
	assert.ok(biomeTypes[BIOME.DESERT].has(LAYERED_ROCK))
	for (const type of [LAYERED_ROCK, ...SCENERY_CONFIG.iceSpikes.types]) {
		const biomes = Object.values(BIOME).filter((biome) => biomeTypes[biome].has(type))
		assert.equal(biomes.length, 1, `type ${type} in one biome`)
	}
	// The boulder palette frosts them (src/sceneryPalettePolicy.js).
	const counts = assertBiomeTypes(iceChunks, iceOffset, iceCoords)
	assert.ok(counts[BIOME.ICE] > 0)
	assert.ok(SCENERY_CONFIG.ice.maxDensity < SCENERY_CONFIG.desert.maxDensity)
	const spikes = iceSpikesOf(iceChunks)
	assert.ok(spikes.some(({ type }) => type === ICE_SPIKES_TWO))
	assert.ok(spikes.some(({ type }) => type === ICE_SPIKES_THREE))
	assert.ok(iceChunks.some((data) => countByType(data).has(BOULDER)))
})

// Farthest an ice spike satellite can stand from its candidate.
const spikeReach =
	ICE_SPIKE_DEFAULTS.satellites.distance.max *
	SCENERY_CONFIG.iceSpikes.footprint *
	ICE_SPIKE_DEFAULTS.scale.max *
	Math.max(SCENERY_DEFAULT_SIZES.iceSpikesTwo, SCENERY_DEFAULT_SIZES.iceSpikesThree)

const iceSpikeTypes = new Set(SCENERY_CATEGORIES.iceSpikes)

function iceSpikesOf(results) {
	const spikes = []
	results.forEach((data, index) => {
		const [i, j] = iceCoords[index]
		for (const instance of instances(data, i, j)) {
			if (iceSpikeTypes.has(instance.type)) spikes.push(instance)
		}
	})
	return spikes
}

test('keeps ice spike satellites within their reach of the chunk, without duplicates', () => {
	const seen = new Set()
	iceChunks.forEach((data, index) => {
		const [i, j] = iceCoords[index]
		for (const instance of instances(data, i, j)) {
			// Sea rock and ice spike satellites belong to their candidate's chunk.
			const reach =
				instance.type === IMPOSTOR_TYPE.SEA_ROCK
					? satelliteReach
					: iceSpikeTypes.has(instance.type)
						? spikeReach
						: 0
			assert.ok(instance.localX >= -size / 2 - reach && instance.localX < size / 2 + reach)
			assert.ok(instance.localZ >= -size / 2 - reach && instance.localZ < size / 2 + reach)
			const key = `${instance.x.toFixed(3)}|${instance.z.toFixed(3)}`
			assert.equal(seen.has(key), false)
			seen.add(key)
		}
	})
})

test('gathers ice spikes in patches', () => {
	let patch = 0
	let elsewhere = 0
	for (const spike of iceSpikesOf(iceChunks)) {
		if (getIceSpikeMask(spike.x, spike.z, iceOffset) > 0.5) patch++
		else elsewhere++
	}
	assert.ok(patch > elsewhere * 2, `${patch} spikes in patches, ${elsewhere} elsewhere`)
})

test('follows the ice spike settings without changing other scenery', () => {
	const iceSpikes = (overrides) => ({
		iceSpikes: { ...createScenerySettings().iceSpikes, ...overrides },
	})
	const baseline = iceSpikesOf(iceChunks)
	const size = SCENERY_DEFAULT_SIZES.iceSpikesTwo

	const aloneResults = generateIce(
		iceSpikes({ satellites: { ...ICE_SPIKE_DEFAULTS.satellites, count: 0 } }),
	)
	const alone = iceSpikesOf(aloneResults)
	assert.ok(alone.length > 0 && alone.length < baseline.length)

	// Without satellites, every group draws its scale from the range.
	const scale = { min: 1, max: 1.2, bias: 1 }
	const ranged = iceSpikesOf(
		generateIce(iceSpikes({ scale, satellites: { ...ICE_SPIKE_DEFAULTS.satellites, count: 0 } })),
	)
	assert.equal(ranged.length, alone.length)
	for (const spike of ranged) {
		assert.ok(spike.scale >= scale.min * size - 1e-5 && spike.scale <= scale.max * size + 1e-5)
	}

	const mask = { ...ICE_SPIKE_DEFAULTS.mask, threshold: ICE_SPIKE_DEFAULTS.mask.threshold + 0.5 }
	const fewerPatches = iceSpikesOf(generateIce(iceSpikes({ mask })))
	assert.ok(fewerPatches.length < baseline.length)

	const noneResults = generateIce({ density: { ...createScenerySettings().density, iceSpikes: 0 } })
	assert.equal(iceSpikesOf(noneResults).length, 0)

	// The other scenery stays where it was.
	const others = (results) =>
		results.reduce((count, data) => count + data.length, 0) / IMPOSTOR_INSTANCE_STRIDE -
		iceSpikesOf(results).length
	assert.equal(others(aloneResults), others(iceChunks))
	assert.equal(others(noneResults), others(iceChunks))
})

test('boats stay white and store their depth for the waves', () => {
	assert.equal(packBoatTint(0) % 65536, packTint(1, 1, 1) % 65536)
	assert.equal(Math.floor(packBoatTint(7.4) / 65536) * SEA_BOAT_DEPTH_STEP, 7.5)
	assert.equal(Math.floor(packBoatTint(1000) / 65536), 255)
	let boats = 0
	for (let i = -3; i <= 3; i++) {
		for (let j = -3; j <= 3; j++) {
			const data = generate(i, j, {}, { density: { ...createScenerySettings().density, boats: 1 } })
			for (const instance of instances(data, i, j)) {
				if (instance.type !== IMPOSTOR_TYPE.BOAT) continue
				boats++
				const depth = Math.floor(instance.tint / 65536) * SEA_BOAT_DEPTH_STEP
				const expected = -getHeight(instance.x, instance.z, noises, params, biomeOffset)
				assert.ok(Math.abs(depth - expected) <= SEA_BOAT_DEPTH_STEP / 2 + 1e-9)
				assert.equal(instance.tint % 65536, packTint(1, 1, 1) % 65536)
			}
		}
	}
	assert.ok(boats > 0)
})

test('keeps boats out of the frozen sea of the ice', () => {
	const results = generateIce({ density: { ...createScenerySettings().density, boats: 1 } })
	let seaRocks = 0
	results.forEach((data, index) => {
		const [i, j] = iceCoords[index]
		for (const instance of instances(data, i, j)) {
			const ice = getIceValue(instance.x, instance.z, iceOffset, params.biomes)
			if (instance.type === IMPOSTOR_TYPE.BOAT) assert.ok(ice <= -ICE_BORDER_MARGIN)
			if (instance.type === IMPOSTOR_TYPE.SEA_ROCK && ice >= 0) seaRocks++
		}
	})
	// Sea rocks still stand in the ice.
	assert.ok(seaRocks > 0)
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

test('painted types vary in brightness only and carry their biome slot', () => {
	const painted = new Set(SCENERY_PAINTED_TYPES)
	assert.ok(painted.has(IMPOSTOR_TYPE.BOULDER) && painted.has(IMPOSTOR_TYPE.LAYERED_ROCK))
	const slots = new Set()
	const check = (data, i, j, offset) => {
		for (let k = 0; k < data.length; k += IMPOSTOR_INSTANCE_STRIDE) {
			const type = data[k + 5]
			if (!painted.has(type)) continue
			const tint = data[k + 6]
			const r = tint % 256
			const g = Math.floor(tint / 256) % 256
			const slot = Math.floor(tint / 65536)
			assert.equal(r, g, 'gray tint')
			// Land instances carry the biome under them; a sea rock group its
			// first rock's, so only land types are checked here.
			if (type !== IMPOSTOR_TYPE.SEA_ROCK) {
				const x = data[k] + (i + 0.5) * size
				const z = data[k + 2] + (j + 0.5) * size
				const biome = getBiome(getBiomeFields(x, z, offset, params.biomes))
				assert.equal(slot, SCENERY_BIOME_SLOTS[biome])
			}
			assert.ok(Object.values(SCENERY_BIOME_SLOTS).includes(slot))
			slots.add(slot)
		}
	}
	for (const [i, j, data] of chunks) check(data, i, j, biomeOffset)
	iceChunks.forEach((data, index) => check(data, ...iceCoords[index], iceOffset))
	assert.ok(slots.has(SCENERY_BIOME_SLOTS[BIOME.ICE]))
	assert.ok(slots.size > 1)
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
