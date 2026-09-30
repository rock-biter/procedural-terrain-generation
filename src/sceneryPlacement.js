import { BIOME, BIOME_BORDER_MARGIN, getBiome, getBiomeValue, snoise } from './biome.js'
import { getHeight, getSurfaceNormal } from './chunkGeometry.js'
import { IMPOSTOR_TYPE } from './impostors/impostorTypes.js'

// Deterministic scenery placement, run in the chunk worker. Candidates come
// from a jittered world-space grid aligned to chunk borders: every cell lies in
// exactly one chunk, so neighbours never duplicate or miss instances. The
// output uses the IMPOSTOR_INSTANCE_STRIDE layout from impostorTypes.js.

export const SCENERY_CONFIG = Object.freeze({
	// Terrain color bands from src/shaders/color-fragment.glsl.
	grassLevel: 1.8,
	landLevel: 14,
	rockLevel: 22,
	// Vertical offset into the ground, in units of instance scale, so bases do
	// not float where coarse terrain LODs cut below the exact height.
	sink: 0.35,
	temperate: {
		maxDensity: 0.55,
		minSlopeNormalY: 0.8,
		bands: {
			grass: [
				[IMPOSTOR_TYPE.ROUND_TREE, 0.62],
				[IMPOSTOR_TYPE.CONIFER, 0.18],
				[IMPOSTOR_TYPE.BOULDER, 0.2],
			],
			land: [
				[IMPOSTOR_TYPE.ROUND_TREE, 0.3],
				[IMPOSTOR_TYPE.CONIFER, 0.55],
				[IMPOSTOR_TYPE.BOULDER, 0.15],
			],
			rocks: [
				[IMPOSTOR_TYPE.CONIFER, 0.5],
				[IMPOSTOR_TYPE.BOULDER, 0.5],
			],
		},
	},
	desert: {
		maxDensity: 0.16,
		minSlopeNormalY: 0.75,
		types: [
			[IMPOSTOR_TYPE.CACTUS_ONE_ARM, 0.36],
			[IMPOSTOR_TYPE.CACTUS_TWO_ARMS, 0.3],
			[IMPOSTOR_TYPE.BOULDER, 0.2],
			[IMPOSTOR_TYPE.LAYERED_ROCK, 0.14],
		],
	},
	// [min scale, max scale, min stretch, max stretch]
	shape: {
		[IMPOSTOR_TYPE.ROUND_TREE]: [0.8, 1.3, 0.9, 1.2],
		[IMPOSTOR_TYPE.CONIFER]: [0.8, 1.35, 0.9, 1.25],
		[IMPOSTOR_TYPE.CACTUS_ONE_ARM]: [0.7, 1.15, 0.85, 1.2],
		[IMPOSTOR_TYPE.CACTUS_TWO_ARMS]: [0.7, 1.15, 0.85, 1.2],
		[IMPOSTOR_TYPE.BOULDER]: [0.6, 1.6, 0.8, 1.1],
		[IMPOSTOR_TYPE.LAYERED_ROCK]: [0.8, 1.8, 0.7, 1.4],
	},
})

// Offsets that decorrelate the cluster noise from the biome field.
const CLUSTER_OFFSET = [7123.4, -3311.9]

export function hashSeed(seed) {
	// FNV-1a over the seed string.
	let hash = 0x811c9dc5
	const text = String(seed)
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i)
		hash = Math.imul(hash, 0x01000193)
	}
	return hash >>> 0
}

// Stateless per-cell random number in [0, 1).
function cellRandom(seedHash, cellX, cellZ, salt) {
	let h = seedHash ^ Math.imul(cellX | 0, 0x27d4eb2d)
	h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
	h ^= Math.imul(cellZ | 0, 0x165667b1)
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
	h ^= Math.imul(salt + 1, 0x9e3779b9)
	h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
	h ^= h >>> 15
	return (h >>> 0) / 4294967296
}

// Tint channels in [0, 2) stored as bytes; decoded in impostor-vertex.glsl.
export function packTint(r, g, b) {
	const byte = (value) => Math.min(255, Math.max(0, Math.round((value / 2) * 255)))
	return byte(r) + byte(g) * 256 + byte(b) * 65536
}

// Mirrors the snow line in color-fragment.glsl.
export function isSnow(x, y, z) {
	return y + Math.sin(x * 0.15) * 5 + Math.cos(z * 0.15) * 5 > 40.2
}

function pickWeighted(table, value) {
	let total = 0
	for (const [, weight] of table) total += weight
	let threshold = value * total
	for (const [type, weight] of table) {
		threshold -= weight
		if (threshold < 0) return type
	}
	return table[table.length - 1][0]
}

function getClusterDensity(x, z, biomeOffset) {
	const cx = x + biomeOffset[0] + CLUSTER_OFFSET[0]
	const cz = z + biomeOffset[1] + CLUSTER_OFFSET[1]
	const forest = snoise(cx * 0.004, cz * 0.004) * 0.7 + snoise(cx * 0.02, cz * 0.02) * 0.3
	return Math.min(Math.max((forest + 0.2) / 0.7, 0), 1)
}

function getTint(type, biome, random) {
	const brightness = 0.86 + random * 0.28
	if (type === IMPOSTOR_TYPE.BOULDER) {
		return biome === BIOME.DESERT
			? packTint(1.02 * brightness, 0.86 * brightness, 0.7 * brightness)
			: packTint(0.8 * brightness, 0.82 * brightness, 0.84 * brightness)
	}
	if (type === IMPOSTOR_TYPE.ROUND_TREE) {
		// Warmer greens on brighter trees.
		const warm = random * 0.18
		return packTint(brightness * (1 + warm), brightness, brightness * (1 - warm))
	}
	return packTint(brightness, brightness, brightness)
}

export function generateSceneryInstances({
	size,
	worldX,
	worldZ,
	cellSize,
	seed,
	noises,
	params,
	biomeOffset,
	config = SCENERY_CONFIG,
}) {
	if (size % cellSize !== 0) {
		throw new Error(`Scenery cell size ${cellSize} must divide chunk size ${size}`)
	}

	const cellsPerSide = size / cellSize
	const minX = worldX - size / 2
	const minZ = worldZ - size / 2
	const firstCellX = Math.round(minX / cellSize)
	const firstCellZ = Math.round(minZ / cellSize)
	const seedHash = hashSeed(seed)
	const normal = [0, 0, 0]
	const output = []

	for (let k = 0; k < cellsPerSide; k++) {
		for (let w = 0; w < cellsPerSide; w++) {
			const cellX = firstCellX + k
			const cellZ = firstCellZ + w
			const x = (cellX + cellRandom(seedHash, cellX, cellZ, 0)) * cellSize
			const z = (cellZ + cellRandom(seedHash, cellX, cellZ, 1)) * cellSize

			const height = getHeight(x, z, noises, params)
			if (height < config.grassLevel || isSnow(x, height, z)) continue

			const biomeValue = getBiomeValue(x, z, biomeOffset)
			if (Math.abs(biomeValue) < BIOME_BORDER_MARGIN) continue
			const biome = getBiome(biomeValue)
			const rules = biome === BIOME.DESERT ? config.desert : config.temperate

			const density =
				biome === BIOME.DESERT
					? rules.maxDensity
					: rules.maxDensity * getClusterDensity(x, z, biomeOffset)
			if (cellRandom(seedHash, cellX, cellZ, 2) >= density) continue

			getSurfaceNormal(x, z, noises, params, normal)
			if (normal[1] < rules.minSlopeNormalY) continue

			let table = rules.types
			if (biome === BIOME.TEMPERATE) {
				if (height < config.landLevel) table = rules.bands.grass
				else if (height < config.rockLevel) table = rules.bands.land
				else table = rules.bands.rocks
			}
			const type = pickWeighted(table, cellRandom(seedHash, cellX, cellZ, 3))
			const [minScale, maxScale, minStretch, maxStretch] = config.shape[type]
			const scale =
				minScale + (maxScale - minScale) * cellRandom(seedHash, cellX, cellZ, 4)
			const stretch =
				minStretch +
				(maxStretch - minStretch) * cellRandom(seedHash, cellX, cellZ, 5)

			output.push(
				x - worldX,
				height - config.sink * scale,
				z - worldZ,
				scale,
				cellRandom(seedHash, cellX, cellZ, 6) * Math.PI * 2,
				type,
				getTint(type, biome, cellRandom(seedHash, cellX, cellZ, 7)),
				stretch,
			)
		}
	}

	return new Float32Array(output)
}
