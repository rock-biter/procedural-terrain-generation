import assert from 'node:assert/strict'
import test from 'node:test'
import {
	BIOME,
	createBiomeOffset,
	getBiome,
	getBiomeFields,
	isNearBiomeBorder,
	OCEAN_BORDER_MARGIN,
} from '../src/biome.js'
import {
	DEEP_OCEAN_TERRAIN_DEFAULTS,
	TERRAIN_DEFAULTS,
	createTerrainNoises,
	createTerrainSettings,
	generateChunkGeometryData,
	getDeepOceanWeight,
	getHeight,
} from '../src/chunkGeometry.js'
import {
	ISLET_HEIGHT_CAP,
	getArchipelagoIslets,
	getIsletInfluence,
	getIsletSeed,
} from '../src/deepOcean.js'
import { getIcePeakSeed } from '../src/icePeaks.js'
import { IMPOSTOR_INSTANCE_STRIDE, IMPOSTOR_TYPE } from '../src/impostors/impostorTypes.js'
import {
	PALM_DEFAULTS,
	SCENERY_CONFIG,
	createScenerySettings,
	generateSceneryInstances,
} from '../src/sceneryPlacement.js'
import { SCENERY_BIOME_SLOTS } from '../src/sceneryPalettePolicy.js'
import { getTerrainBand, TERRAIN_BAND, TERRAIN_HEIGHT_BANDS } from '../src/terrainBands.js'

// The production terrain.
const params = TERRAIN_DEFAULTS
const seed = 'deep-ocean-test'
const noises = createTerrainNoises(seed, params.octaves)
const biomeOffset = createBiomeOffset(seed)
const { depth, blend } = DEEP_OCEAN_TERRAIN_DEFAULTS
const size = 256

function getFields(x, z) {
	return getBiomeFields(x, z, biomeOffset, params.biomes)
}

// Points of a fixed scattered grid that pass `predicate`.
function findPoints(predicate, count) {
	const points = []
	for (let index = 0; points.length < count && index < 200000; index++) {
		const x = ((index * 7919) % 80000) - 40000
		const z = ((index * 104729) % 80000) - 40000
		if (predicate(x, z)) points.push([x, z])
	}
	assert.equal(points.length, count)
	return points
}

// The islets within 40 km, nearest first, and the one this suite studies.
const islets = getArchipelagoIslets(-40000, -40000, 40000, 40000, biomeOffset, params).sort(
	(a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z),
)
const [islet] = islets

test('keeps the islets apart from the ice mountains and under the rocks band', () => {
	assert.notEqual(getIsletSeed(biomeOffset), getIcePeakSeed(biomeOffset))
	// The lowest reach of the rocks band's ink line.
	const { line, amplitude } = TERRAIN_HEIGHT_BANDS.rocks
	assert.equal(ISLET_HEIGHT_CAP, line - 2 * amplitude)
	assert.ok(DEEP_OCEAN_TERRAIN_DEFAULTS.isletHeight <= ISLET_HEIGHT_CAP)
	assert.ok(islets.length > 0)
})

test('sinks the terrain to the floor outside the biome, before its border', () => {
	assert.equal(getDeepOceanWeight(0, params), 1)
	assert.equal(getDeepOceanWeight(-blend, params), 0)
	assert.equal(getDeepOceanWeight(1, params), 1)
	// Deep inside and at the border, away from the archipelagos, the floor is
	// flat; no land touches the border.
	const off = (x, z) => getIsletInfluence(x, z, getFields(x, z).ocean, biomeOffset, params) === 0
	const inside = (x, z) => getFields(x, z).ocean >= 0 && off(x, z)
	for (const [x, z] of findPoints(inside, 200)) {
		const height = getHeight(x, z, noises, params, biomeOffset)
		// The banks rise from the floor without islets on them.
		assert.ok(height >= -depth && height <= -DEEP_OCEAN_TERRAIN_DEFAULTS.bankDepth + 1e-9)
	}
	const border = (x, z) => Math.abs(getFields(x, z).ocean) < 0.002
	for (const [x, z] of findPoints(border, 50)) {
		assert.ok(getHeight(x, z, noises, params, biomeOffset) < 0, 'no land on the border')
	}
})

test('keeps the islets low, in the deep ocean, and their palms on them', () => {
	let land = 0
	for (const { x, z, summit, waterline } of islets.slice(0, 40)) {
		assert.ok(summit <= ISLET_HEIGHT_CAP)
		const height = getHeight(x, z, noises, params, biomeOffset)
		assert.ok(height <= ISLET_HEIGHT_CAP + 1e-9)
		const fields = getFields(x, z)
		assert.equal(getBiome(fields), BIOME.DEEP_OCEAN)
		assert.ok(waterline > 0)
		if (height > 0) land++
		// Above the sand, never the rocks band.
		for (let step = 0; step < 16; step++) {
			const angle = (step / 16) * Math.PI * 2
			const px = x + Math.sin(angle) * waterline * 0.4
			const pz = z + Math.cos(angle) * waterline * 0.4
			const ground = getHeight(px, pz, noises, params, biomeOffset)
			assert.ok(getTerrainBand(px, ground, pz) < TERRAIN_BAND.rocks)
		}
	}
	// The visible center stands on dry land.
	assert.ok(land > 30, `${land} islet centers on land`)
})

test('raises the islets continuously, with no seams across chunk edges', () => {
	const worldX = Math.floor(islet.x / 16) * 16 + 8
	const worldZ = Math.floor(islet.z / 16) * 16 + 8
	const generate = (offsetX) =>
		generateChunkGeometryData({
			size: 16,
			LOD: 0,
			density: 2,
			worldX: worldX + offsetX,
			worldZ,
			params,
			seed,
			biomeOffset,
			noises,
		})
	const left = generate(0)
	const right = generate(16)
	for (let row = 0; row < 9; row++) {
		assert.equal(left.height[row * 9 + 8], right.height[row * 9])
	}
	// Steps of a tenth of a unit across the islet never jump.
	let previous = getHeight(islet.x - islet.radius * 1.5, islet.z, noises, params, biomeOffset)
	for (let step = 1; step <= islet.radius * 30; step++) {
		const x = islet.x - islet.radius * 1.5 + step * 0.1
		const height = getHeight(x, islet.z, noises, params, biomeOffset)
		assert.ok(Math.abs(height - previous) < 0.5, `jump at x=${x}`)
		previous = height
	}
})

test('follows settings edited in place, as the panel edits them', () => {
	const live = createTerrainSettings()
	assert.ok(getHeight(islet.x, islet.z, noises, live, biomeOffset) > 0)
	live.deepOcean.isletChance = 0
	assert.equal(getHeight(islet.x, islet.z, noises, live, biomeOffset), -live.deepOcean.depth)
	live.deepOcean.isletChance = DEEP_OCEAN_TERRAIN_DEFAULTS.isletChance
	live.biomes.oceanThreshold = 2
	// No deep ocean left: the land terms are back.
	assert.ok(getFields(islet.x, islet.z).ocean >= 0)
	assert.ok(getHeight(islet.x, islet.z, noises, live, biomeOffset) > -depth)
})

test('writes every biome field, also where the floor skips the land terms', () => {
	const [[x, z]] = findPoints((px, pz) => getFields(px, pz).ocean > 0.1, 1)
	const fields = { climate: NaN, ice: NaN, ocean: NaN, ringDriven: null }
	getHeight(x, z, noises, params, biomeOffset, fields)
	assert.deepEqual(fields, getFields(x, z))
})

// Chunks around the studied islet's archipelago.
const chunkX = Math.floor(islet.x / size)
const chunkZ = Math.floor(islet.z / size)
const coords = []
for (let i = chunkX - 2; i <= chunkX + 2; i++) {
	for (let j = chunkZ - 2; j <= chunkZ + 2; j++) coords.push([i, j])
}

function generate(settingsOverrides = {}) {
	return coords.map(([i, j]) =>
		generateSceneryInstances({
			size,
			worldX: (i + 0.5) * size,
			worldZ: (j + 0.5) * size,
			settings: { ...createScenerySettings(), ...settingsOverrides },
			seed,
			noises,
			params,
			biomeOffset,
		}),
	)
}

function* instances(results) {
	for (const [index, data] of results.entries()) {
		const [i, j] = coords[index]
		for (let k = 0; k < data.length; k += IMPOSTOR_INSTANCE_STRIDE) {
			yield {
				x: data[k] + (i + 0.5) * size,
				y: data[k + 1],
				z: data[k + 2] + (j + 0.5) * size,
				localX: data[k],
				localZ: data[k + 2],
				scale: data[k + 3],
				type: data[k + 5],
				tint: data[k + 6],
			}
		}
	}
}

const results = generate()

// The islet of each palm: the nearest center.
function getIsletOf({ x, z }) {
	let nearest = null
	let best = Infinity
	for (const candidate of islets) {
		const distance = Math.hypot(candidate.x - x, candidate.z - z)
		if (distance < best) {
			best = distance
			nearest = candidate
		}
	}
	return nearest
}

test('places at most a few palms per islet, on its beaches and lawns', () => {
	const perIslet = new Map()
	let palms = 0
	for (const instance of instances(results)) {
		if (instance.type !== IMPOSTOR_TYPE.PALM) continue
		palms++
		// Inside its own chunk.
		assert.ok(Math.abs(instance.localX) <= size / 2 && Math.abs(instance.localZ) <= size / 2)
		const fields = {}
		const height = getHeight(instance.x, instance.z, noises, params, biomeOffset, fields)
		assert.ok(height >= PALM_DEFAULTS.minHeight)
		const band = getTerrainBand(instance.x, height, instance.z)
		assert.ok(band >= TERRAIN_BAND.sand && band <= TERRAIN_BAND.land)
		assert.equal(getBiome(fields), BIOME.DEEP_OCEAN)
		assert.equal(isNearBiomeBorder(fields), false)
		assert.ok(Math.abs(instance.y - (height - SCENERY_CONFIG.sink * instance.scale)) < 1e-3)
		assert.equal(Math.floor(instance.tint / 65536), SCENERY_BIOME_SLOTS[BIOME.DEEP_OCEAN])
		const owner = getIsletOf(instance)
		perIslet.set(owner, (perIslet.get(owner) ?? 0) + 1)
	}
	assert.ok(palms > 0)
	for (const count of perIslet.values()) assert.ok(count <= PALM_DEFAULTS.maxPerIslet)

	// The settings bound them.
	const one = generate({ palms: { ...PALM_DEFAULTS, maxPerIslet: 1 } })
	const counts = new Map()
	for (const instance of instances(one)) {
		if (instance.type !== IMPOSTOR_TYPE.PALM) continue
		const owner = getIsletOf(instance)
		counts.set(owner, (counts.get(owner) ?? 0) + 1)
	}
	for (const count of counts.values()) assert.equal(count, 1)
	const none = generate({ density: { ...createScenerySettings().density, palms: 0 } })
	assert.ok([...instances(none)].every(({ type }) => type !== IMPOSTOR_TYPE.PALM))
})

test('keeps only palms on the islets, sea rocks around them, and no boats', () => {
	const busy = generate({ density: { ...createScenerySettings().density, boats: 1 } })
	let rocks = 0
	for (const instance of instances(busy)) {
		const fields = getFields(instance.x, instance.z)
		if (instance.type === IMPOSTOR_TYPE.BOAT) {
			assert.ok(fields.ocean <= -OCEAN_BORDER_MARGIN, 'no boats in the deep ocean')
			continue
		}
		if (getBiome(fields) !== BIOME.DEEP_OCEAN) continue
		assert.ok(
			instance.type === IMPOSTOR_TYPE.PALM || instance.type === IMPOSTOR_TYPE.SEA_ROCK,
			`type ${instance.type} in the deep ocean`,
		)
		if (instance.type === IMPOSTOR_TYPE.SEA_ROCK) rocks++
	}
	assert.ok(rocks > 0)
	// Every first rock of a group stands on an islet's slope; the satellites
	// stay near it.
	const reach = 2 * SCENERY_CONFIG.coast.footprint * 2.1 * 1.6
	for (const instance of instances(results)) {
		if (instance.type !== IMPOSTOR_TYPE.SEA_ROCK) continue
		if (getBiome(getFields(instance.x, instance.z)) !== BIOME.DEEP_OCEAN) continue
		const owner = getIsletOf(instance)
		assert.ok(Math.hypot(owner.x - instance.x, owner.z - instance.z) < owner.radius * 1.3 + reach)
	}
})
