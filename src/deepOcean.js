import { BIOME_DEFAULTS, getBiomeFields } from './biome.js'
import { clamp01, lerp, smoothstep } from './math.js'
import { snoise } from './noise.js'
import { cellRandom } from './random.js'
import { TERRAIN_HEIGHT_BANDS } from './terrainBands.js'

// Floor and archipelagos of the deep ocean biome (three-free, so the chunk
// workers import it). getHeight() (src/chunkGeometry.js) sinks the terrain to
// the floor, -depth, over the slope outside the biome, and inside it returns
// getDeepOceanFloor(): the floor, raised by rare archipelagos. They exist only
// on the CPU; the shaders read them through the terrain's height attribute.
//
// The archipelagos stand on a world grid of `isletSpacing` cells, in the
// seeded biome coordinates (createBiomeOffset()) plus ISLET_OFFSET: a cell
// holds one with probability `isletChance`, kept inside it, and only where
// the deep ocean field at its center is at least `isletMargin`. Each is a
// shallow bank, a plateau `bankDepth` deep of radius up to `bankRadius`,
// carrying `isletCount` islets: flat-topped domes of radius up to
// `isletRadius` rising from the bank to a summit up to `isletHeight`, never
// above ISLET_HEIGHT_CAP. A warp of the position frays every outline. The
// settings are params.deepOcean (DEEP_OCEAN_TERRAIN_DEFAULTS in
// src/chunkGeometry.js).

// Highest islet terrain: below the lowest reach of the rocks band's ink line
// (its `line` minus its wave), so the islets show sand, grass, and land, never
// rocks or snow.
export const ISLET_HEIGHT_CAP =
	TERRAIN_HEIGHT_BANDS.rocks.line - 2 * TERRAIN_HEIGHT_BANDS.rocks.amplitude

// Share of `isletRadius` of each islet's radius, and of `isletHeight` of its
// summit.
const RADIUS_RANGE = [0.55, 1]
const SUMMIT_RANGE = [0.5, 1]
// Share of the bank's radius where its plateau ends and where its slope
// starts on a round bank; the islets are laid out inside it.
const BANK_CORE = 0.55
// An irregular bank's plateau edge wanders within this range of bank radii,
// following two simplex layers of the position (BANK_SHAPE: frequency per bank
// radius, then the detail layer's frequency multiple and weight), so its
// outline grows lobes and bays and may leave shoals apart. The slope always
// ends at one bank radius, inside the archipelago's cell.
const BANK_EDGE_RANGE = [0.25, 0.8]
const BANK_SHAPE = Object.freeze({ frequency: 1.8, detail: 2.7, detailWeight: 0.35 })
// The islets' pedestals: under an irregular bank, every islet keeps the
// plateau within its radius and slopes to the floor over this share of the
// bank radius beyond it, still inside the cell, so the islets never move or
// sink whatever the outline does.
// Share of an islet's radius that its flat top covers.
const ISLET_TOP = 0.25
// Least distance between two islet centers, as a share of their radii summed:
// below 1 their slopes meet under water and a sand bar may join them, while
// their tops stay apart.
const ISLET_SPACING = 0.8
// Attempts per islet to find a free spot on the bank.
const ISLET_ATTEMPTS = 3
// Exponent of the union of the islets' heights above the bank, the p-norm
// (sum of h ** p) ** (1 / p): exactly an islet's own height wherever the
// others add nothing (their tops always), and smooth where two slopes meet.
const ISLET_UNION = 4

// Outline warp, as a share of `isletRadius`, and its noise frequency per
// isletRadius. Their product times the simplex slope (about 2.5) stays below
// 1, so the warp never folds the terrain into cliffs. Each axis moves up to
// the amplitude, so a point moves up to its square root of two times.
const WARP = 0.15
const WARP_FREQUENCY = 1.3

// Offset that decorrelates the archipelagos from the other noise layers.
const ISLET_OFFSET = [3517.9, -6143.3]
// And the gaps of their reefs, and the outlines of their banks.
const REEF_OFFSET = [-813.7, 2467.1]
const BANK_SHAPE_OFFSET = [1931.7, -4410.3]
// Half-width, in noise value, of the edge of a reef's stretches.
const REEF_SOFTNESS = 0.15

// Integer seed of the archipelago grid, from the seeded biome offset
// (getHeight() receives the offset, not the seed), salted apart from the ice
// mountains' (getIcePeakSeed() in src/icePeaks.js).
export function getIsletSeed(biomeOffset) {
	let hash = 0x811c9dc5 ^ 0x5bd1e995
	for (let index = 0; index < 4; index++) {
		hash = Math.imul(hash ^ Math.floor(biomeOffset[index] * 4096), 0x01000193)
	}
	return hash >>> 0
}

// Share of the archipelagos at deep ocean field value `ocean`: 0 at the
// biome border, 1 from half the margin in. Whole archipelagos are already
// accepted only at least `isletMargin` inside; this keeps any land off the
// border whatever the field does across a bank.
export function getArchipelagoFade(ocean, settings) {
	return smoothstep(0, Math.max(settings.isletMargin, 1e-6) / 2, ocean)
}

function getWarpAmplitude(settings) {
	return WARP * Math.max(settings.isletRadius, 0)
}

// The bank's radius under `settings`: at most `bankRadius`, and small enough
// for the bank and its warp to stay inside one grid cell.
function getBankRadius(settings) {
	const reach = getWarpAmplitude(settings) * Math.SQRT2
	return Math.min(Math.max(settings.bankRadius, 0), settings.isletSpacing / 2 - reach - 1)
}

// Position in the archipelago grid's coordinates.
function toGrid(value, biomeOffset, axis) {
	return value + biomeOffset[axis] + ISLET_OFFSET[axis]
}

// The warp of grid point (px, pz), written to `out` as [dx, dz].
function getWarp(px, pz, settings, out) {
	const amplitude = getWarpAmplitude(settings)
	if (!(amplitude > 0)) {
		out[0] = 0
		out[1] = 0
		return out
	}
	const frequency = WARP_FREQUENCY / settings.isletRadius
	out[0] = snoise(px * frequency, pz * frequency) * amplitude
	out[1] = snoise(px * frequency + 41.3, pz * frequency - 27.9) * amplitude
	return out
}

// Height of an islet's profile at `t`, its distance over its radius, in [0, 1]
// of the rise from the bank to its summit: flat on top, smooth to the bank.
function getIsletRise(t) {
	return 1 - smoothstep(ISLET_TOP, 1, t)
}

// Distance over the radius where an islet of `summit` on a bank `bankDepth`
// deep meets the sea surface (y = 0): the inverse of getIsletRise().
function getIsletWaterline(summit, bankDepth) {
	const rise = bankDepth / (summit + bankDepth)
	const step = 0.5 - Math.sin(Math.asin(Math.min(Math.max(2 * rise - 1, -1), 1)) / 3)
	return ISLET_TOP + (1 - ISLET_TOP) * step
}

const centerFields = { climate: 0, ice: 0, ocean: 0, ringDriven: false }

// The archipelago of grid cell (cellX, cellZ), or null: its bank's center
// (grid coordinates) and radius, and its islets with their center, radius,
// summit, and waterline radius. `seed` is getIsletSeed(); `params` holds
// params.deepOcean and params.biomes.
export function getArchipelago(cellX, cellZ, seed, biomeOffset, params) {
	const settings = params.deepOcean
	const spacing = settings.isletSpacing
	if (!(spacing > 0 && settings.isletChance > 0)) return null
	if (cellRandom(seed, cellX, cellZ, 0) >= settings.isletChance) return null
	const bankRadius = getBankRadius(settings)
	if (!(bankRadius > 0)) return null
	const reach = bankRadius + getWarpAmplitude(settings) * Math.SQRT2
	const span = spacing - reach * 2
	const x = cellX * spacing + reach + span * cellRandom(seed, cellX, cellZ, 1)
	const z = cellZ * spacing + reach + span * cellRandom(seed, cellX, cellZ, 2)
	return { cellX, cellZ, x, z, bankRadius, reach, islets: null }
}

// Whether `archipelago` stands: the deep ocean field at its center is at least
// `isletMargin`. Costs one evaluation of every biome field.
function isArchipelagoAccepted(archipelago, biomeOffset, params) {
	getBiomeFields(
		archipelago.x - biomeOffset[0] - ISLET_OFFSET[0],
		archipelago.z - biomeOffset[1] - ISLET_OFFSET[1],
		biomeOffset,
		params.biomes,
		centerFields,
	)
	return centerFields.ocean >= params.deepOcean.isletMargin
}

// The islets of `archipelago`, laid out once from its cell: each inside the
// bank's plateau, apart from the others.
function getIslets(archipelago, seed, settings) {
	if (archipelago.islets) return archipelago.islets
	const { cellX, cellZ, x, z, bankRadius } = archipelago
	const random = (salt) => cellRandom(seed, cellX, cellZ, salt)
	const islets = []
	const maxRadius = Math.min(Math.max(settings.isletRadius, 0), bankRadius * BANK_CORE * 0.5)
	const maxSummit = Math.min(Math.max(settings.isletHeight, 0), ISLET_HEIGHT_CAP)
	const bankDepth = Math.max(settings.bankDepth, 0)
	const minCount = Math.max(
		Math.floor(Math.min(settings.isletCount.min, settings.isletCount.max)),
		0,
	)
	const maxCount = Math.max(Math.floor(settings.isletCount.max), minCount)
	const count = minCount + Math.floor(random(3) * (maxCount - minCount + 1))
	if (!(maxRadius > 0 && maxSummit > 0)) return (archipelago.islets = islets)
	for (let index = 0; index < count; index++) {
		const salt = 8 + index * 16
		const radius = maxRadius * lerp(RADIUS_RANGE[0], RADIUS_RANGE[1], random(salt))
		const summit = maxSummit * lerp(SUMMIT_RANGE[0], SUMMIT_RANGE[1], random(salt + 1))
		const room = bankRadius * BANK_CORE - radius
		for (let attempt = 0; attempt < ISLET_ATTEMPTS; attempt++) {
			const angle = random(salt + 2 + attempt * 2) * Math.PI * 2
			const distance = room * Math.sqrt(random(salt + 3 + attempt * 2))
			const isletX = x + Math.cos(angle) * distance
			const isletZ = z + Math.sin(angle) * distance
			const crowded = islets.some(
				(islet) =>
					Math.hypot(islet.x - isletX, islet.z - isletZ) < (islet.radius + radius) * ISLET_SPACING,
			)
			if (crowded) continue
			islets.push({
				index,
				x: isletX,
				z: isletZ,
				radius,
				summit,
				waterline: radius * getIsletWaterline(summit, bankDepth),
			})
			break
		}
	}
	return (archipelago.islets = islets)
}

const warp = [0, 0]

// The bank's plateau edge at grid point (qx, qz), already warped, in bank
// radii: BANK_CORE on a round bank (`bankIrregularity` 0), wandering within
// BANK_EDGE_RANGE on a fully irregular one (1).
function getBankEdge(archipelago, qx, qz, irregularity) {
	if (irregularity <= 0) return BANK_CORE
	const frequency = BANK_SHAPE.frequency / archipelago.bankRadius
	const x = (qx + BANK_SHAPE_OFFSET[0]) * frequency
	const z = (qz + BANK_SHAPE_OFFSET[1]) * frequency
	const detail = BANK_SHAPE.detail
	const shape = snoise(x, z) + snoise(x * detail + 17.1, z * detail - 9.4) * BANK_SHAPE.detailWeight
	const edge = lerp(BANK_EDGE_RANGE[0], BANK_EDGE_RANGE[1], smoothstep(-0.6, 0.6, shape))
	return lerp(BANK_CORE, edge, irregularity)
}

// The bank's shape at grid point (qx, qz), already warped, written to `out`:
// `shallow`, 1 on the plateau to 0 on the floor, and `rim`, how far outside
// the plateau's edge the point lies, in bank radii (negative inside). An
// irregular bank joins its wandering plateau with the islets' pedestals
// (1 - (1 - a)(1 - b): exactly 1 wherever either is, smooth where they meet).
const bankShape = { shallow: 0, rim: 0 }

function getBankShape(archipelago, islets, qx, qz, settings, out = bankShape) {
	const radius = archipelago.bankRadius
	const irregularity = clamp01(settings.bankIrregularity ?? 0)
	const distance = Math.hypot(qx - archipelago.x, qz - archipelago.z) / radius
	const edge = getBankEdge(archipelago, qx, qz, irregularity)
	let deep = smoothstep(edge, 1, distance)
	let rim = distance - edge
	const pedestal = (1 - BANK_CORE) * irregularity * radius
	if (pedestal > 0) {
		for (const islet of islets) {
			const isletDistance = Math.hypot(qx - islet.x, qz - islet.z)
			rim = Math.min(rim, (isletDistance - islet.radius) / radius)
			if (isletDistance < islet.radius + pedestal) {
				deep *= smoothstep(islet.radius, islet.radius + pedestal, isletDistance)
			}
		}
	}
	out.shallow = 1 - deep
	out.rim = rim
	return out
}

// The archipelago's terrain at grid point (px, pz), already warped, before the
// fade: the bank on the floor, and the islets on the bank. `islet` receives
// the islets' highest rise (0 to 1), when given.
function getArchipelagoHeight(archipelago, islets, qx, qz, settings, islet) {
	const floor = -Math.max(settings.depth, 0)
	const bank = Math.max(-Math.max(settings.bankDepth, 0), floor)
	const { shallow } = getBankShape(archipelago, islets, qx, qz, settings)
	let height = lerp(floor, bank, shallow)
	// The islets stand on the bank's plateau, where `height` is `bank`.
	let union = 0
	let rise = 0
	for (const { x, z, radius, summit } of islets) {
		const t = Math.hypot(qx - x, qz - z) / radius
		if (t >= 1) continue
		const isletRise = getIsletRise(t)
		rise = Math.max(rise, isletRise)
		union += ((summit - bank) * isletRise) ** ISLET_UNION
	}
	if (union > 0) height += union ** (1 / ISLET_UNION)
	if (islet) islet.rise = rise
	return Math.min(height, ISLET_HEIGHT_CAP)
}

// The settings an archipelago's layout and acceptance depend on.
const LAYOUT_KEYS = [
	'isletSpacing',
	'isletChance',
	'isletMargin',
	'bankRadius',
	'bankDepth',
	'isletRadius',
	'isletHeight',
]
const BIOME_KEYS = Object.keys(BIOME_DEFAULTS)

// The last grid cell looked up and its standing archipelago (or null): the
// samples of one bank fall in one cell, so its acceptance (an evaluation of
// every biome field) and its islets are computed once. The key holds the cell,
// the offset, and every setting they depend on, by value, because the main
// thread edits params in place.
const lastCell = { key: [], archipelago: null }
const cellKey = []

function writeCellKey(cellX, cellZ, biomeOffset, params) {
	const { deepOcean, biomes } = params
	let index = 0
	cellKey[index++] = cellX
	cellKey[index++] = cellZ
	for (let axis = 0; axis < 4; axis++) cellKey[index++] = biomeOffset[axis]
	for (const key of LAYOUT_KEYS) cellKey[index++] = deepOcean[key]
	cellKey[index++] = deepOcean.isletCount.min
	cellKey[index++] = deepOcean.isletCount.max
	for (const key of BIOME_KEYS) cellKey[index++] = biomes[key]
	cellKey.length = index
}

function isSameKey(a, b) {
	if (a.length !== b.length) return false
	for (let index = 0; index < a.length; index++) {
		if (a[index] !== b[index]) return false
	}
	return true
}

// The standing archipelago of grid cell (cellX, cellZ), with its islets laid
// out, or null; memoized for the last cell.
function getStandingArchipelago(cellX, cellZ, biomeOffset, params) {
	writeCellKey(cellX, cellZ, biomeOffset, params)
	if (isSameKey(cellKey, lastCell.key)) return lastCell.archipelago
	const seed = getIsletSeed(biomeOffset)
	let archipelago = getArchipelago(cellX, cellZ, seed, biomeOffset, params)
	if (archipelago && isArchipelagoAccepted(archipelago, biomeOffset, params)) {
		getIslets(archipelago, seed, params.deepOcean)
	} else {
		archipelago = null
	}
	lastCell.key = cellKey.slice()
	lastCell.archipelago = archipelago
	return archipelago
}

// The archipelago reaching world point (x, z) with its fields, or null.
function getReachingArchipelago(x, z, ocean, biomeOffset, params) {
	const settings = params.deepOcean
	if (getArchipelagoFade(ocean, settings) <= 0) return null
	const px = toGrid(x, biomeOffset, 0)
	const pz = toGrid(z, biomeOffset, 1)
	const spacing = settings.isletSpacing
	if (!(spacing > 0)) return null
	const archipelago = getStandingArchipelago(
		Math.floor(px / spacing),
		Math.floor(pz / spacing),
		biomeOffset,
		params,
	)
	if (!archipelago) return null
	if (Math.hypot(px - archipelago.x, pz - archipelago.z) >= archipelago.reach) return null
	return { archipelago, islets: archipelago.islets, px, pz }
}

const influence = { rise: 0 }

// The deep ocean terrain at (x, z), where the deep ocean field is `ocean`
// (>= 0): the floor at -depth, raised by the archipelago that reaches the
// point. `params` holds params.deepOcean and params.biomes.
export function getDeepOceanFloor(x, z, ocean, biomeOffset, params) {
	const settings = params.deepOcean
	const floor = -Math.max(settings.depth, 0)
	const reaching = getReachingArchipelago(x, z, ocean, biomeOffset, params)
	if (!reaching) return floor
	const { archipelago, islets, px, pz } = reaching
	getWarp(px, pz, settings, warp)
	const height = getArchipelagoHeight(archipelago, islets, px + warp[0], pz + warp[1], settings)
	return lerp(floor, height, getArchipelagoFade(ocean, settings))
}

// How much (x, z) lies on an archipelago's reef, 0 off it to 1 on its middle:
// the ring of its bank's rim, where the plateau's shallow water starts to
// turn deep, broken into stretches by gaps, as on an atoll. `reef` is the sea
// rocks' reef settings (settings.seaRocks.reef in src/sceneryPlacement.js):
// the ring is `width` bank radii wide on each side of a line `width / 2`
// outside the plateau's edge (getBankShape(), which follows an irregular
// outline), and its gaps open where a simplex field at
// `patchFrequency` per unit falls below `patchThreshold`. Sea rocks of the
// deep ocean deeper than the islets' slopes stand only where it is above 0.
export function getReefInfluence(x, z, ocean, biomeOffset, params, reef) {
	const { width, patchFrequency, patchThreshold } = reef
	if (!(width > 0)) return 0
	const reaching = getReachingArchipelago(x, z, ocean, biomeOffset, params)
	if (!reaching) return 0
	const { archipelago, islets, px, pz } = reaching
	getWarp(px, pz, params.deepOcean, warp)
	const { rim } = getBankShape(archipelago, islets, px + warp[0], pz + warp[1], params.deepOcean)
	const ring = 1 - smoothstep(0, width, Math.abs(rim - width / 2))
	if (ring <= 0) return 0
	const gaps = snoise(
		(px + REEF_OFFSET[0]) * patchFrequency,
		(pz + REEF_OFFSET[1]) * patchFrequency,
	)
	return ring * smoothstep(patchThreshold - REEF_SOFTNESS, patchThreshold + REEF_SOFTNESS, gaps)
}

// How far up an islet's slope (x, z) lies, 0 off every islet to 1 on a top:
// sea rocks of the deep ocean stand there, or on a reef (getReefInfluence()).
export function getIsletInfluence(x, z, ocean, biomeOffset, params) {
	const reaching = getReachingArchipelago(x, z, ocean, biomeOffset, params)
	if (!reaching) return 0
	const { archipelago, islets, px, pz } = reaching
	getWarp(px, pz, params.deepOcean, warp)
	getArchipelagoHeight(archipelago, islets, px + warp[0], pz + warp[1], params.deepOcean, influence)
	return influence.rise
}

// Every islet that may reach the world rectangle [minX, maxX] x [minZ, maxZ],
// with world coordinates: `x`, `z` its visible center (its center moved back
// by the warp there), `radius`, `summit`, `waterline` (radius of its shore),
// and `cellX`, `cellZ`, `index` to seed what stands on it.
export function getArchipelagoIslets(minX, minZ, maxX, maxZ, biomeOffset, params) {
	const settings = params.deepOcean
	const spacing = settings.isletSpacing
	if (!(spacing > 0 && settings.isletChance > 0)) return []
	const firstX = Math.floor(toGrid(minX, biomeOffset, 0) / spacing)
	const lastX = Math.floor(toGrid(maxX, biomeOffset, 0) / spacing)
	const firstZ = Math.floor(toGrid(minZ, biomeOffset, 1) / spacing)
	const lastZ = Math.floor(toGrid(maxZ, biomeOffset, 1) / spacing)
	const result = []
	for (let cellX = firstX; cellX <= lastX; cellX++) {
		for (let cellZ = firstZ; cellZ <= lastZ; cellZ++) {
			const archipelago = getStandingArchipelago(cellX, cellZ, biomeOffset, params)
			if (!archipelago) continue
			for (const islet of archipelago.islets) {
				getWarp(islet.x, islet.z, settings, warp)
				result.push({
					...islet,
					cellX,
					cellZ,
					x: islet.x - warp[0] - biomeOffset[0] - ISLET_OFFSET[0],
					z: islet.z - warp[1] - biomeOffset[1] - ISLET_OFFSET[1],
				})
			}
		}
	}
	return result
}
