import { BIOME, getBiome, getIceValue, ICE_BORDER_MARGIN, isNearBiomeBorder } from './biome.js'
import { smoothstep } from './math.js'
import { snoise } from './noise.js'
import { cellRandom, hashSeed, pickWeighted } from './random.js'
import { SEA_SURFACE_Y, getHeight, getSurfaceNormal } from './chunkGeometry.js'
import { getCoastRockMask } from './coast.js'
import { getTerrainBand, TERRAIN_BAND, TERRAIN_BANDS } from './terrainBands.js'
import { SCENERY_BIOME_SLOTS } from './sceneryPalettePolicy.js'
import { IMPOSTOR_INSTANCE_STRIDE, IMPOSTOR_TYPE } from './impostors/impostorTypes.js'

// Deterministic scenery placement, run in the chunk worker. Candidates come
// from a jittered world-space grid aligned to chunk borders: every cell lies in
// exactly one chunk, so neighbours never duplicate or miss instances. The
// output uses the IMPOSTOR_INSTANCE_STRIDE layout from impostorTypes.js.

// Scenery grows from the grass band up to the rocks band (src/terrainBands.js,
// the borders the terrain shader colors): never on snow. Each biome
// (src/biome.js) has its rules: woods in the temperate biome, cacti and rocks
// in the desert, sparse snowy boulders and patches of ice spikes in the ice.
// The sand and the shallow sea carry only sea rocks (`coast`), and a band of
// deeper sea outside the ice the boats (`boat`).
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
	// Boulders, frosted by the boulder palette's ice color, accepted at
	// maxDensity; a cell that draws an ice spike type brings a group of them
	// instead (`iceSpikes`).
	ice: {
		maxDensity: 0.08,
		minSlopeNormalY: 0.75,
		types: [
			[IMPOSTOR_TYPE.BOULDER, 0.4],
			[IMPOSTOR_TYPE.ICE_SPIKES_TWO, 0.3],
			[IMPOSTOR_TYPE.ICE_SPIKES_THREE, 0.3],
		],
	},
	// Ice spike groups, gathered in patches (getIceSpikeMask(), with
	// settings.iceSpikes.mask) like the sea rocks on rocky coast: acceptance
	// grows from `baseDensity` (isolated groups anywhere in the ice) to
	// `maxDensity` where the mask is 1. `footprint` is the larger source's
	// horizontal radius at scale 1 (src/impostors/impostorArchetypes.js),
	// which spaces the satellites; each satellite is of either type. Scale and
	// satellites are runtime settings (settings.iceSpikes, ICE_SPIKE_DEFAULTS).
	iceSpikes: {
		types: [IMPOSTOR_TYPE.ICE_SPIKES_TWO, IMPOSTOR_TYPE.ICE_SPIKES_THREE],
		baseDensity: 0.01,
		maxDensity: 0.25,
		footprint: 1.8,
	},
	// Sea rocks on the sand and the shallow sea of every biome, gathered on
	// rocky coast (getCoastRockMask() in src/coast.js, with params.coast.mask).
	// Acceptance grows from `baseDensity` (isolated rocks on any coast) to
	// `maxDensity` where the mask is 1. The base sits `sink` (in scale units)
	// below the ground, or below the sea surface over deeper water, so every
	// rock rises above the sea. `footprint` is the source's horizontal radius
	// at scale 1 (src/impostors/impostorArchetypes.js), which spaces the
	// satellites. Depth, scale, and satellites are runtime settings
	// (settings.seaRocks, SEA_ROCK_DEFAULTS).
	coast: {
		type: IMPOSTOR_TYPE.SEA_ROCK,
		baseDensity: 0.03,
		maxDensity: 0.3,
		sink: 0.2,
		footprint: 2.5,
	},
	// Boats on the sea (placeBoats()). The model is scaled to `length` at scale
	// 1 (src/impostors/boatSources.js), its bow along local +Z; `beam` is its
	// width at that length. Each chunk offers `candidates` spots. Depth band,
	// count, draft, and clearance are runtime settings (settings.boats,
	// BOAT_DEFAULTS).
	boat: {
		type: IMPOSTOR_TYPE.BOAT,
		candidates: 8,
		length: 12,
		beam: 7.2,
	},
	// [min scale, max scale, min stretch, max stretch]
	shape: {
		[IMPOSTOR_TYPE.ROUND_TREE]: [0.8, 1.3, 0.9, 1.2],
		[IMPOSTOR_TYPE.CONIFER]: [0.8, 1.35, 0.9, 1.25],
		[IMPOSTOR_TYPE.CACTUS_ONE_ARM]: [0.7, 1.15, 0.85, 1.2],
		[IMPOSTOR_TYPE.CACTUS_TWO_ARMS]: [0.7, 1.15, 0.85, 1.2],
		[IMPOSTOR_TYPE.BOULDER]: [0.6, 1.6, 0.8, 1.1],
		[IMPOSTOR_TYPE.LAYERED_ROCK]: [0.8, 1.8, 0.7, 1.4],
		// Its scale range is only the default of settings.seaRocks.scale.
		[IMPOSTOR_TYPE.SEA_ROCK]: [0.35, 2.1, 0.8, 1.35],
		// One size for every boat: the boat size setting alone scales it.
		[IMPOSTOR_TYPE.BOAT]: [1, 1, 1, 1],
		// Their scale range is only the default of settings.iceSpikes.scale.
		[IMPOSTOR_TYPE.ICE_SPIKES_TWO]: [0.7, 1.5, 0.85, 1.35],
		[IMPOSTOR_TYPE.ICE_SPIKES_THREE]: [0.7, 1.5, 0.85, 1.35],
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
	[IMPOSTOR_TYPE.SEA_ROCK]: 'seaRock',
	[IMPOSTOR_TYPE.BOAT]: 'boat',
	[IMPOSTOR_TYPE.ICE_SPIKES_TWO]: 'iceSpikesTwo',
	[IMPOSTOR_TYPE.ICE_SPIKES_THREE]: 'iceSpikesThree',
})

// Density is set per category; each type belongs to one.
export const SCENERY_CATEGORIES = Object.freeze({
	trees: [IMPOSTOR_TYPE.ROUND_TREE, IMPOSTOR_TYPE.CONIFER],
	cacti: [IMPOSTOR_TYPE.CACTUS_ONE_ARM, IMPOSTOR_TYPE.CACTUS_TWO_ARMS],
	rocks: [IMPOSTOR_TYPE.BOULDER, IMPOSTOR_TYPE.LAYERED_ROCK],
	seaRocks: [IMPOSTOR_TYPE.SEA_ROCK],
	boats: [IMPOSTOR_TYPE.BOAT],
	iceSpikes: [IMPOSTOR_TYPE.ICE_SPIKES_TWO, IMPOSTOR_TYPE.ICE_SPIKES_THREE],
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
	seaRock: 1.6,
	boat: 1.65,
	iceSpikesTwo: 1,
	iceSpikesThree: 1,
})

// Default sea rock settings. Rocks stand where the sea is at most `maxDepth`
// deep (and on the sand). Their scale spans `scale.min` to `scale.max` (times
// the seaRock size), drawn as random ** scale.bias, so above 1 small rocks
// are common and large ones rare. Each rock brings up to `satellites.count`
// smaller ones around it, at `satellites.distance` (× footprint × scale) from
// it and `satellites.scale` of its scale.
export const SEA_ROCK_DEFAULTS = Object.freeze({
	maxDepth: 8.5,
	scale: Object.freeze({
		min: SCENERY_CONFIG.shape[IMPOSTOR_TYPE.SEA_ROCK][0],
		max: SCENERY_CONFIG.shape[IMPOSTOR_TYPE.SEA_ROCK][1],
		bias: 1.6,
	}),
	satellites: Object.freeze({
		count: 2,
		distance: Object.freeze({ min: 1.1, max: 1.8 }),
		scale: Object.freeze({ min: 0.4, max: 0.7 }),
	}),
})

// A mutable copy of SEA_ROCK_DEFAULTS.
export function createSeaRockSettings() {
	const { satellites } = SEA_ROCK_DEFAULTS
	return {
		maxDepth: SEA_ROCK_DEFAULTS.maxDepth,
		scale: { ...SEA_ROCK_DEFAULTS.scale },
		satellites: {
			count: satellites.count,
			distance: { ...satellites.distance },
			scale: { ...satellites.scale },
		},
	}
}

// Default ice spike settings. `mask` picks the patches where the groups
// gather (getIceSpikeMask(), with the fields of COAST_MASK_DEFAULTS in
// src/coast.js). The scale and satellites work like the sea rocks' (times the
// size of the group's first type), the satellites spaced by
// SCENERY_CONFIG.iceSpikes.footprint.
export const ICE_SPIKE_DEFAULTS = Object.freeze({
	mask: Object.freeze({
		frequency: 0.004,
		detailFrequency: 0.016,
		detailWeight: 0.35,
		threshold: 0.3,
		softness: 0.2,
	}),
	scale: Object.freeze({
		min: SCENERY_CONFIG.shape[IMPOSTOR_TYPE.ICE_SPIKES_TWO][0],
		max: SCENERY_CONFIG.shape[IMPOSTOR_TYPE.ICE_SPIKES_TWO][1],
		bias: 1.3,
	}),
	satellites: Object.freeze({
		count: 4,
		distance: Object.freeze({ min: 0.8, max: 1.6 }),
		scale: Object.freeze({ min: 0.45, max: 0.8 }),
	}),
})

// A mutable copy of ICE_SPIKE_DEFAULTS.
export function createIceSpikeSettings() {
	const { mask, scale, satellites } = ICE_SPIKE_DEFAULTS
	return {
		mask: { ...mask },
		scale: { ...scale },
		satellites: {
			count: satellites.count,
			distance: { ...satellites.distance },
			scale: { ...satellites.scale },
		},
	}
}

// Default boat settings. A boat's center stands where the sea is between
// `depth.min` and `depth.max` deep (measured from y = 0, like the sea rocks'
// maxDepth): away from the coast, short of the deep sea. Its bow, stern, and
// sides need at least `depth.min`, and the sea floor stays below its keel. A
// chunk holds at most `maxPerChunk` boats, each `rockClearance` units from any
// sea rock and other boat. The hull sinks `draft` (times its scale) below the
// sea surface.
export const BOAT_DEFAULTS = Object.freeze({
	maxPerChunk: 2,
	depth: Object.freeze({ min: 6, max: 18 }),
	draft: 0.3,
	rockClearance: 4,
})

// A mutable copy of BOAT_DEFAULTS.
export function createBoatSettings() {
	return {
		maxPerChunk: BOAT_DEFAULTS.maxPerChunk,
		depth: { ...BOAT_DEFAULTS.depth },
		draft: BOAT_DEFAULTS.draft,
		rockClearance: BOAT_DEFAULTS.rockClearance,
	}
}

// Runtime settings sent with every placement request. Density and size are
// multipliers on SCENERY_CONFIG. Density multiplies the acceptance
// probability of its category, capped at one instance per grid cell (for
// boats, per candidate spot). `seaRocks` holds the sea rocks' depth, scale,
// and satellites; `iceSpikes` the ice spikes' patches, scale, and
// satellites; `boats` the boats' depth band, count, draft, and clearance.
export function createScenerySettings({ isMobile = false } = {}) {
	return {
		cellSize: isMobile ? 16 : 8,
		maxPerChunk: 1000,
		density: { trees: 0.75, cacti: 0.2, rocks: 0.65, seaRocks: 0.7, boats: 0.13, iceSpikes: 1 },
		size: { ...SCENERY_DEFAULT_SIZES },
		seaRocks: createSeaRockSettings(),
		iceSpikes: createIceSpikeSettings(),
		boats: createBoatSettings(),
	}
}

// Offsets that decorrelate the cluster noise from the biome field.
const CLUSTER_OFFSET = [7123.4, -3311.9]
// And the ice spike patches from the other layers.
const ICE_SPIKE_OFFSET = [-2719.6, 5381.2]

// Tint channels in [0, 2) stored as bytes; decoded in impostor-vertex.glsl.
export function packTint(r, g, b) {
	const byte = (value) => Math.min(255, Math.max(0, Math.round((value / 2) * 255)))
	return byte(r) + byte(g) * 256 + byte(b) * 65536
}

// Whether scenery may stand on terrain band `band` (a TERRAIN_BAND index).
export function isSceneryBand(band) {
	return band >= TERRAIN_BAND.grass && band < TERRAIN_BAND.snow
}

// Whether sea rocks may stand on terrain band `band`: the sand and the sea.
export function isCoastBand(band) {
	return band === TERRAIN_BAND.sea || band === TERRAIN_BAND.sand
}

function getClusterDensity(x, z, biomeOffset) {
	const cx = x + biomeOffset[0] + CLUSTER_OFFSET[0]
	const cz = z + biomeOffset[1] + CLUSTER_OFFSET[1]
	const forest = snoise(cx * 0.004, cz * 0.004) * 0.7 + snoise(cx * 0.02, cz * 0.02) * 0.3
	return Math.min(Math.max((forest + 0.2) / 0.7, 0), 1)
}

// Where the ice spikes gather: 1 in their patches, 0 elsewhere. Two simplex
// layers at the seeded biome coordinates, like getCoastRockMask() in
// src/coast.js, with `mask` (settings.iceSpikes.mask); placement alone reads
// it, so it has no shader twin.
export function getIceSpikeMask(x, z, biomeOffset, mask = ICE_SPIKE_DEFAULTS.mask) {
	const cx = x + biomeOffset[0] + ICE_SPIKE_OFFSET[0]
	const cz = z + biomeOffset[1] + ICE_SPIKE_OFFSET[1]
	const { frequency, detailFrequency, detailWeight, threshold, softness } = mask
	const value =
		snoise(cx * frequency, cz * frequency) +
		snoise(cx * detailFrequency, cz * detailFrequency) * detailWeight
	return smoothstep(threshold - softness, threshold + softness, value)
}

// Packed tint of a painted instance in `biome`. Every type but the boat takes
// its hue from the palettes in the shaders (src/sceneryPalettePolicy.js): the
// trees and cacti from world-space noise, the rocks by biome. The tint only
// varies the brightness (red and green bytes); the blue byte holds the
// biome's palette slot (SCENERY_BIOME_SLOTS), read by
// getSceneryPaletteTints() in scenery-instance-pars-vertex.glsl.
export function getPaintedTint(random, biome) {
	const brightness = 0.86 + random * 0.28
	return packTint(brightness, brightness, 0) + SCENERY_BIOME_SLOTS[biome] * 65536
}

// The jittered candidate of grid cell (cellX, cellZ), its ground, and its
// biome fields (getBiomeFields()).
function getCellCandidate(cellX, cellZ, { seedHash, noises, params, biomeOffset, settings }) {
	const { cellSize } = settings
	const x = (cellX + cellRandom(seedHash, cellX, cellZ, 0)) * cellSize
	const z = (cellZ + cellRandom(seedHash, cellX, cellZ, 1)) * cellSize
	const fields = {}
	const height = getHeight(x, z, noises, params, biomeOffset, fields)
	return { x, z, height, band: getTerrainBand(x, height, z), cellX, cellZ, fields }
}

// Whether a cell candidate may bring sea rocks: on the sand or the sea, no
// deeper than settings.seaRocks.maxDepth.
function isSeaRockCandidate({ band, height }, settings) {
	return isCoastBand(band) && height >= -settings.seaRocks.maxDepth
}

// The instance values of a sea rock (from getSeaRockGroup()).
function getSeaRockValues({ x, z, height, scale, yaw, tint, stretch }, context) {
	const { config, worldX, worldZ } = context
	const baseY = Math.max(height, SEA_SURFACE_Y) - config.coast.sink * scale
	return [x - worldX, baseY, z - worldZ, scale, yaw, config.coast.type, tint, stretch]
}

// Appends to `group` the satellites of its first member: up to
// `satellites.count` smaller ones around it, at `satellites.distance` times
// `footprint` times its scale, scaled by `satellites.scale` of its scale. Every
// value comes from the group's cell through `random` (salt 9 for the count,
// then 8 salts per satellite from 10, the last one free for `extra`).
// `stand(x, z)` returns a satellite's ground height, or null where it may not
// stand; `tint(salt)` packs its tint; `extra(salt)` adds values of its own.
function addGroupSatellites(group, { satellites, footprint, stretch, random, tint, stand, extra }) {
	const [{ x, z, scale }] = group
	const [minStretch, maxStretch] = stretch
	const count = Math.floor(random(9) * (Math.floor(satellites.count) + 1))
	const { min: minDistance, max: maxDistance } = satellites.distance
	const { min: minShare, max: maxShare } = satellites.scale
	for (let index = 0; index < count; index++) {
		const salt = 10 + index * 8
		const angle = random(salt) * Math.PI * 2
		const distance =
			(minDistance + (maxDistance - minDistance) * random(salt + 1)) * footprint * scale
		const satelliteX = x + Math.cos(angle) * distance
		const satelliteZ = z + Math.sin(angle) * distance
		const satelliteHeight = stand(satelliteX, satelliteZ)
		if (satelliteHeight === null) continue
		group.push({
			priority: random(salt + 6),
			x: satelliteX,
			z: satelliteZ,
			height: satelliteHeight,
			scale: scale * (minShare + (maxShare - minShare) * random(salt + 2)),
			yaw: random(salt + 3) * Math.PI * 2,
			tint: tint(salt + 4),
			stretch: minStretch + (maxStretch - minStretch) * random(salt + 5),
			...extra?.(salt),
		})
	}
}

// The sea rocks of one coastal candidate (see isSeaRockCandidate()): the rock,
// if accepted, and its smaller satellites, with world-space bases. Every value
// comes from the candidate's cell (salts 2 to 8 like other scenery, then 9 and
// up for the satellites), so the group is deterministic, belongs to the
// candidate's chunk even where a satellite crosses its border, and any chunk
// can recompute it (the boats avoid the rocks of neighbouring chunks).
function getSeaRockGroup({ x, z, height, cellX, cellZ, fields }, context) {
	const { seedHash, noises, params, biomeOffset, settings, config } = context
	const coast = config.coast
	const type = coast.type
	const random = (salt) => cellRandom(seedHash, cellX, cellZ, salt)
	const rocks = settings.seaRocks
	const group = []

	const mask = getCoastRockMask(x, z, biomeOffset, params.coast?.mask)
	const density =
		(coast.baseDensity + (coast.maxDensity - coast.baseDensity) * mask) *
		settings.density[TYPE_CATEGORY[type]]
	if (random(2) >= density) return group

	const [, , minStretch, maxStretch] = config.shape[type]
	const { min: minScale, max: maxScale, bias } = rocks.scale
	const scale =
		(minScale + (maxScale - minScale) * random(4) ** bias) * settings.size[SCENERY_TYPE_KEYS[type]]
	if (scale <= 0) return group
	// The palette gives the hue, from the biome of the group's first rock.
	const biome = getBiome(fields)
	const tint = (salt) => getPaintedTint(random(salt), biome)
	group.push({
		priority: random(8),
		x,
		z,
		height,
		scale,
		yaw: random(6) * Math.PI * 2,
		tint: tint(7),
		stretch: minStretch + (maxStretch - minStretch) * random(5),
	})

	addGroupSatellites(group, {
		satellites: rocks.satellites,
		footprint: coast.footprint,
		stretch: [minStretch, maxStretch],
		random,
		tint,
		stand: (satelliteX, satelliteZ) => {
			const satelliteHeight = getHeight(satelliteX, satelliteZ, noises, params, biomeOffset)
			return satelliteHeight < -rocks.maxDepth ? null : satelliteHeight
		},
	})
	return group
}

// Whether the ground at (x, z) is gentle enough for the ice's scenery.
function isIceSlopeGentle(x, z, context) {
	const { noises, params, biomeOffset, config, normal } = context
	getSurfaceNormal(x, z, noises, params, biomeOffset, normal)
	return normal[1] >= config.ice.minSlopeNormalY
}

// The ice spikes of one ice candidate (on a scenery band, off the biome
// borders) that drew spike type `type`: the group, if accepted, and its
// smaller satellites, each of either spike type, with world-space bases.
// Acceptance grows with the ice spike mask, so the groups gather in patches.
// Every satellite stands like other ice scenery: on a scenery band, in the
// ice off its border, on a gentle slope. The values come from the candidate's
// cell like the sea rocks' (getSeaRockGroup()), and the satellites belong to
// its chunk.
function getIceSpikeGroup({ x, z, height, cellX, cellZ }, type, context) {
	const { seedHash, noises, params, biomeOffset, settings, config } = context
	const rules = config.iceSpikes
	const spikes = settings.iceSpikes
	const random = (salt) => cellRandom(seedHash, cellX, cellZ, salt)
	const group = []

	const mask = getIceSpikeMask(x, z, biomeOffset, spikes.mask)
	const density =
		(rules.baseDensity + (rules.maxDensity - rules.baseDensity) * mask) *
		settings.density[TYPE_CATEGORY[type]]
	if (random(2) >= density) return group
	if (!isIceSlopeGentle(x, z, context)) return group

	const [, , minStretch, maxStretch] = config.shape[type]
	const { min: minScale, max: maxScale, bias } = spikes.scale
	const scale =
		(minScale + (maxScale - minScale) * random(4) ** bias) * settings.size[SCENERY_TYPE_KEYS[type]]
	if (scale <= 0) return group
	const tint = (salt) => getPaintedTint(random(salt), BIOME.ICE)
	group.push({
		type,
		priority: random(8),
		x,
		z,
		height,
		scale,
		yaw: random(6) * Math.PI * 2,
		tint: tint(7),
		stretch: minStretch + (maxStretch - minStretch) * random(5),
	})

	const fields = {}
	addGroupSatellites(group, {
		satellites: spikes.satellites,
		footprint: rules.footprint,
		stretch: [minStretch, maxStretch],
		random,
		tint,
		stand: (satelliteX, satelliteZ) => {
			const satelliteHeight = getHeight(satelliteX, satelliteZ, noises, params, biomeOffset, fields)
			if (!isSceneryBand(getTerrainBand(satelliteX, satelliteHeight, satelliteZ))) return null
			if (isNearBiomeBorder(fields) || getBiome(fields) !== BIOME.ICE) return null
			return isIceSlopeGentle(satelliteX, satelliteZ, context) ? satelliteHeight : null
		},
		extra: (salt) => ({
			type: rules.types[
				Math.min(Math.floor(random(salt + 7) * rules.types.length), rules.types.length - 1)
			],
		}),
	})
	return group
}

// The instance values of an ice spike (from getIceSpikeGroup()), sunk like
// other land scenery.
function getIceSpikeValues({ x, z, height, scale, yaw, type, tint, stretch }, context) {
	const { config, worldX, worldZ } = context
	return [x - worldX, height - config.sink * scale, z - worldZ, scale, yaw, type, tint, stretch]
}

// The sea rocks of grid cell (cellX, cellZ), computed once per placement
// (context.seaRockCells).
function getCellSeaRocks(cellX, cellZ, context) {
	const key = `${cellX}:${cellZ}`
	let rocks = context.seaRockCells.get(key)
	if (!rocks) {
		const candidate = getCellCandidate(cellX, cellZ, context)
		rocks = isSeaRockCandidate(candidate, context.settings)
			? getSeaRockGroup(candidate, context)
			: []
		context.seaRockCells.set(key, rocks)
	}
	return rocks
}

// Farthest a sea rock's edge can reach from its cell's candidate under
// `settings`: the largest rock, or a satellite at its largest distance.
function getSeaRockReach(settings, config) {
	const { scale, satellites } = settings.seaRocks
	const footprint = config.coast.footprint
	const largest =
		Math.max(scale.min, scale.max, 0) *
		Math.max(settings.size[SCENERY_TYPE_KEYS[config.coast.type]], 0)
	if (Math.floor(satellites.count) < 1) return footprint * largest
	const distance =
		Math.max(satellites.distance.min, satellites.distance.max, 0) * footprint * largest
	const satellite = footprint * largest * Math.max(satellites.scale.min, satellites.scale.max, 1)
	return distance + satellite
}

// Distance from (px, pz) to the segment from (ax, az) to (bx, bz).
function getSegmentDistance(px, pz, ax, az, bx, bz) {
	const dx = bx - ax
	const dz = bz - az
	const lengthSquared = dx * dx + dz * dz
	const t =
		lengthSquared > 0
			? Math.min(Math.max(((px - ax) * dx + (pz - az) * dz) / lengthSquared, 0), 1)
			: 0
	return Math.hypot(px - (ax + dx * t), pz - (az + dz * t))
}

// Whether the sea is deep enough under a boat at (x, z): its center within
// the depth band, its bow, stern, and sides at least `depth.min` deep and
// below its keel at `keelY`. (sin yaw, cos yaw) is the bow's direction, as
// rotateYaw() in rotate-yaw.glsl turns local +Z.
function isBoatInDepthBand(x, z, sinYaw, cosYaw, scale, keelY, context) {
	const { noises, params, biomeOffset, settings, config } = context
	const { depth } = settings.boats
	const centerDepth = -getHeight(x, z, noises, params, biomeOffset)
	if (centerDepth < depth.min || centerDepth > depth.max) return false
	const minDepth = Math.max(depth.min, -keelY)
	const halfLength = (config.boat.length / 2) * scale
	const halfBeam = (config.boat.beam / 2) * scale
	const points = [
		[sinYaw * halfLength, cosYaw * halfLength],
		[-sinYaw * halfLength, -cosYaw * halfLength],
		[cosYaw * halfBeam, -sinYaw * halfBeam],
		[-cosYaw * halfBeam, sinYaw * halfBeam],
	]
	return points.every(
		([dx, dz]) => -getHeight(x + dx, z + dz, noises, params, biomeOffset) >= minDepth,
	)
}

// Whether a boat at (x, z) keeps `clearance` from every sea rock: the hull is
// a capsule along its bow direction, the beam wide; the rocks are circles of
// their footprint, from every grid cell close enough to reach the boat.
function isBoatClearOfRocks(x, z, sinYaw, cosYaw, scale, context) {
	const { settings, config } = context
	const { cellSize } = settings
	const clearance = settings.boats.rockClearance
	const radius = (config.boat.beam / 2) * scale
	const half = Math.max(config.boat.length - config.boat.beam, 0) * 0.5 * scale
	const ax = x - sinYaw * half
	const az = z - cosYaw * half
	const bx = x + sinYaw * half
	const bz = z + cosYaw * half
	const reach = half + radius + clearance + getSeaRockReach(settings, config)
	const minCellX = Math.floor((x - reach) / cellSize)
	const maxCellX = Math.floor((x + reach) / cellSize)
	const minCellZ = Math.floor((z - reach) / cellSize)
	const maxCellZ = Math.floor((z + reach) / cellSize)
	for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
		for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
			for (const rock of getCellSeaRocks(cellX, cellZ, context)) {
				const rockRadius = config.coast.footprint * rock.scale
				if (getSegmentDistance(rock.x, rock.z, ax, az, bx, bz) < rockRadius + radius + clearance) {
					return false
				}
			}
		}
	}
	return true
}

// The boats of one chunk, as instance values. Its `candidates` spots come from
// the chunk's own hash (not the grid cells'), each active with the boats'
// density, inside the chunk by half a boat and half the clearance, so boats of
// neighbouring chunks never meet. In priority order, a spot keeps its boat
// when it lies outside the ice biome (whose sea freezes), the sea is deep
// enough (isBoatInDepthBand()), no sea rock or kept boat is within the
// clearance, and the chunk holds fewer than maxPerChunk.
function placeBoats(context) {
	const { seed, size, worldX, worldZ, settings, config, params, biomeOffset } = context
	const boatConfig = config.boat
	const type = boatConfig.type
	const boats = settings.boats
	const maxPerChunk = Math.floor(boats.maxPerChunk)
	const density = settings.density[TYPE_CATEGORY[type]]
	if (maxPerChunk < 1 || density <= 0) return []

	const minX = worldX - size / 2
	const minZ = worldZ - size / 2
	const chunkX = Math.round(minX / size)
	const chunkZ = Math.round(minZ / size)
	const boatHash = hashSeed(`${seed}:boats`)
	const random = (salt) => cellRandom(boatHash, chunkX, chunkZ, salt)

	const [minScale, maxScale, minStretch, maxStretch] = config.shape[type]
	const clearance = Math.max(boats.rockClearance, 0)
	const candidates = []
	for (let index = 0; index < boatConfig.candidates; index++) {
		const salt = index * 8
		if (random(salt) >= density) continue
		const scale =
			(minScale + (maxScale - minScale) * random(salt + 1)) * settings.size[SCENERY_TYPE_KEYS[type]]
		if (scale <= 0) continue
		const margin = (boatConfig.length / 2) * scale + clearance / 2
		const span = size - margin * 2
		if (span <= 0) continue
		candidates.push({
			priority: random(salt + 2),
			x: minX + margin + span * random(salt + 3),
			z: minZ + margin + span * random(salt + 4),
			yaw: random(salt + 5) * Math.PI * 2,
			scale,
			stretch: minStretch + (maxStretch - minStretch) * random(salt + 6),
		})
	}
	candidates.sort((a, b) => a.priority - b.priority)

	const kept = []
	for (const candidate of candidates) {
		if (kept.length >= maxPerChunk) break
		const { x, z, yaw, scale, stretch } = candidate
		const sinYaw = Math.sin(yaw)
		const cosYaw = Math.cos(yaw)
		const keelY = SEA_SURFACE_Y - boats.draft * scale
		if (getIceValue(x, z, biomeOffset, params.biomes) > -ICE_BORDER_MARGIN) continue
		if (!isBoatInDepthBand(x, z, sinYaw, cosYaw, scale, keelY, context)) continue
		const crowded = kept.some(
			(boat) =>
				Math.hypot(boat.x - x, boat.z - z) <
				(boatConfig.length / 2) * (boat.scale + scale) + clearance,
		)
		if (crowded) continue
		if (!isBoatClearOfRocks(x, z, sinYaw, cosYaw, scale, context)) continue
		kept.push(candidate)
		candidate.values = [x - worldX, keelY, z - worldZ, scale, yaw, type, packTint(1, 1, 1), stretch]
	}
	return kept.map(({ values }) => values)
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
	const context = {
		seed,
		seedHash,
		noises,
		params,
		biomeOffset,
		settings,
		config,
		size,
		worldX,
		worldZ,
		// Sea rocks per grid cell, shared by this chunk's rocks and its boats.
		seaRockCells: new Map(),
		// Scratch surface normal.
		normal,
	}

	for (let k = 0; k < cellsPerSide; k++) {
		for (let w = 0; w < cellsPerSide; w++) {
			const cellX = firstCellX + k
			const cellZ = firstCellZ + w
			const candidate = getCellCandidate(cellX, cellZ, context)
			const { x, z, height, band, fields } = candidate
			if (!isSceneryBand(band)) {
				const rocks = isSeaRockCandidate(candidate, settings)
					? getSeaRockGroup(candidate, context)
					: []
				context.seaRockCells.set(`${cellX}:${cellZ}`, rocks)
				for (const rock of rocks) {
					instances.push({ priority: rock.priority, values: getSeaRockValues(rock, context) })
				}
				continue
			}
			context.seaRockCells.set(`${cellX}:${cellZ}`, [])

			if (isNearBiomeBorder(fields)) continue
			const biome = getBiome(fields)
			const temperate = biome === BIOME.TEMPERATE
			const rules = temperate ? config.temperate : biome === BIOME.ICE ? config.ice : config.desert

			// The type is drawn before acceptance, from an independent random
			// value, so a category's density only adds or removes that category.
			const table = temperate ? rules.bands[TERRAIN_BANDS[band]] : rules.types
			const type = pickWeighted(table, cellRandom(seedHash, cellX, cellZ, 3))
			if (biome === BIOME.ICE && config.iceSpikes.types.includes(type)) {
				for (const spike of getIceSpikeGroup(candidate, type, context)) {
					instances.push({ priority: spike.priority, values: getIceSpikeValues(spike, context) })
				}
				continue
			}

			const baseDensity = temperate
				? rules.maxDensity * getClusterDensity(x, z, biomeOffset)
				: rules.maxDensity
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
					getPaintedTint(cellRandom(seedHash, cellX, cellZ, 7), biome),
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
	// Boats come after the cap: they are few, and maxPerChunk of their own
	// bounds them.
	const boats = placeBoats(context)

	const output = new Float32Array((kept.length + boats.length) * IMPOSTOR_INSTANCE_STRIDE)
	kept.forEach(({ values }, index) => output.set(values, index * IMPOSTOR_INSTANCE_STRIDE))
	boats.forEach((values, index) =>
		output.set(values, (kept.length + index) * IMPOSTOR_INSTANCE_STRIDE),
	)
	return output
}
