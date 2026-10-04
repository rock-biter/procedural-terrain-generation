import { BIOME, BIOME_BORDER_MARGIN, getBiome, getBiomeValue } from './biome.js'
import { snoise } from './noise.js'
import { cellRandom, hashSeed, pickWeighted } from './random.js'
import { getHeight, getSurfaceNormal } from './chunkGeometry.js'
import { getTerrainBand, TERRAIN_BAND, TERRAIN_BANDS } from './terrainBands.js'
import { IMPOSTOR_INSTANCE_STRIDE, IMPOSTOR_TYPE } from './impostors/impostorTypes.js'

// Deterministic scenery placement, run in the chunk worker. Candidates come
// from a jittered world-space grid aligned to chunk borders: every cell lies in
// exactly one chunk, so neighbours never duplicate or miss instances. The
// output uses the IMPOSTOR_INSTANCE_STRIDE layout from impostorTypes.js.

// Scenery grows from the grass band up to the rocks band (src/terrainBands.js,
// the borders the terrain shader colors): never on sand, the sea, or snow.
export const SCENERY_CONFIG = Object.freeze({
	// Vertical offset into the ground, in units of instance scale, so bases do
	// not float where coarse terrain LODs cut below the exact height.
	sink: 0.35,
	temperate: {
		maxDensity: 0.55,
		minSlopeNormalY: 0.8,
		// Type weights per terrain band.
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

// Settings keys for each type; the debug GUI edits values under these names.
export const SCENERY_TYPE_KEYS = Object.freeze({
	[IMPOSTOR_TYPE.ROUND_TREE]: 'roundTree',
	[IMPOSTOR_TYPE.CONIFER]: 'conifer',
	[IMPOSTOR_TYPE.CACTUS_ONE_ARM]: 'cactusOneArm',
	[IMPOSTOR_TYPE.CACTUS_TWO_ARMS]: 'cactusTwoArms',
	[IMPOSTOR_TYPE.BOULDER]: 'boulder',
	[IMPOSTOR_TYPE.LAYERED_ROCK]: 'layeredRock',
})

// Density is set per category; each type belongs to one.
export const SCENERY_CATEGORIES = Object.freeze({
	trees: [IMPOSTOR_TYPE.ROUND_TREE, IMPOSTOR_TYPE.CONIFER],
	cacti: [IMPOSTOR_TYPE.CACTUS_ONE_ARM, IMPOSTOR_TYPE.CACTUS_TWO_ARMS],
	rocks: [IMPOSTOR_TYPE.BOULDER, IMPOSTOR_TYPE.LAYERED_ROCK],
})

const TYPE_CATEGORY = Object.fromEntries(
	Object.entries(SCENERY_CATEGORIES).flatMap(([category, types]) =>
		types.map((type) => [type, category]),
	),
)

// Divisors of the 256-unit chunk offered for the scenery grid.
export const SCENERY_CELL_SIZES = Object.freeze([4, 8, 16, 32])

// Initial size multiplier per type, applied on top of the SCENERY_CONFIG
// scale range. Keys match SCENERY_TYPE_KEYS.
export const SCENERY_DEFAULT_SIZES = Object.freeze({
	roundTree: 1.35,
	conifer: 1.7,
	cactusOneArm: 1.29,
	cactusTwoArms: 1.68,
	boulder: 0.6,
	layeredRock: 0.85,
})

// Runtime settings sent with every placement request. Density and size are
// multipliers on SCENERY_CONFIG. Density multiplies the acceptance
// probability of its category, capped at one instance per grid cell.
export function createScenerySettings({ isMobile = false } = {}) {
	return {
		cellSize: isMobile ? 16 : 8,
		maxPerChunk: 1000,
		density: { trees: 0.75, cacti: 0.2, rocks: 0.65 },
		size: { ...SCENERY_DEFAULT_SIZES },
	}
}

// Offsets that decorrelate the cluster noise from the biome field.
const CLUSTER_OFFSET = [7123.4, -3311.9]

// Tint channels in [0, 2) stored as bytes; decoded in impostor-vertex.glsl.
export function packTint(r, g, b) {
	const byte = (value) => Math.min(255, Math.max(0, Math.round((value / 2) * 255)))
	return byte(r) + byte(g) * 256 + byte(b) * 65536
}

// Whether scenery may stand on terrain band `band` (a TERRAIN_BAND index).
export function isSceneryBand(band) {
	return band >= TERRAIN_BAND.grass && band < TERRAIN_BAND.snow
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
	// Trees take their hue from the crown palette in the shaders
	// (src/sceneryPalettePolicy.js), so they vary in brightness only, like
	// the cacti and layered rocks.
	return packTint(brightness, brightness, brightness)
}

export function generateSceneryInstances({
	size,
	worldX,
	worldZ,
	seed,
	noises,
	params,
	biomeOffset,
	settings = createScenerySettings(),
	config = SCENERY_CONFIG,
}) {
	const { cellSize } = settings
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
	const instances = []

	for (let k = 0; k < cellsPerSide; k++) {
		for (let w = 0; w < cellsPerSide; w++) {
			const cellX = firstCellX + k
			const cellZ = firstCellZ + w
			const x = (cellX + cellRandom(seedHash, cellX, cellZ, 0)) * cellSize
			const z = (cellZ + cellRandom(seedHash, cellX, cellZ, 1)) * cellSize

			const height = getHeight(x, z, noises, params, biomeOffset)
			const band = getTerrainBand(x, height, z)
			if (!isSceneryBand(band)) continue

			const biomeValue = getBiomeValue(x, z, biomeOffset)
			if (Math.abs(biomeValue) < BIOME_BORDER_MARGIN) continue
			const biome = getBiome(biomeValue)
			const rules = biome === BIOME.DESERT ? config.desert : config.temperate

			// The type is drawn before acceptance, from an independent random
			// value, so a category's density only adds or removes that category.
			const table = biome === BIOME.DESERT ? rules.types : rules.bands[TERRAIN_BANDS[band]]
			const type = pickWeighted(table, cellRandom(seedHash, cellX, cellZ, 3))

			const baseDensity =
				biome === BIOME.DESERT
					? rules.maxDensity
					: rules.maxDensity * getClusterDensity(x, z, biomeOffset)
			const density = baseDensity * settings.density[TYPE_CATEGORY[type]]
			if (cellRandom(seedHash, cellX, cellZ, 2) >= density) continue

			getSurfaceNormal(x, z, noises, params, biomeOffset, normal)
			if (normal[1] < rules.minSlopeNormalY) continue

			const [minScale, maxScale, minStretch, maxStretch] = config.shape[type]
			const scale =
				(minScale + (maxScale - minScale) * cellRandom(seedHash, cellX, cellZ, 4)) *
				settings.size[SCENERY_TYPE_KEYS[type]]
			if (scale <= 0) continue
			const stretch = minStretch + (maxStretch - minStretch) * cellRandom(seedHash, cellX, cellZ, 5)

			instances.push({
				priority: cellRandom(seedHash, cellX, cellZ, 8),
				values: [
					x - worldX,
					height - config.sink * scale,
					z - worldZ,
					scale,
					cellRandom(seedHash, cellX, cellZ, 6) * Math.PI * 2,
					type,
					getTint(type, biome, cellRandom(seedHash, cellX, cellZ, 7)),
					stretch,
				],
			})
		}
	}

	// Over the cap, keep the lowest random priorities: the thinning stays
	// deterministic and spatially uniform instead of filling one corner first.
	let kept = instances
	if (instances.length > settings.maxPerChunk) {
		kept = [...instances]
			.sort((a, b) => a.priority - b.priority)
			.slice(0, Math.max(0, settings.maxPerChunk))
	}

	const output = new Float32Array(kept.length * IMPOSTOR_INSTANCE_STRIDE)
	kept.forEach(({ values }, index) => output.set(values, index * IMPOSTOR_INSTANCE_STRIDE))
	return output
}
