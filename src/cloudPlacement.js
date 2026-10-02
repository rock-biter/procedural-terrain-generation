import { snoise } from './biome.js'
import { cellRandom, hashSeed, packTint } from './sceneryPlacement.js'
import { CLOUD_TYPE } from './impostors/impostorTypes.js'

// Deterministic cloud placement for the world-level cloud field
// (src/clouds.js). Candidates come from a jittered world-space grid: each cell
// holds at most one cloud, which depends only on the seed, the cell, and the
// settings, so the field can be rebuilt around any center and every cloud
// stays where it was. The output uses the IMPOSTOR_INSTANCE_STRIDE layout with
// world-space bases (the flat bottom of the cloud) and the yaw slot holding
// only the dither seed: the shaders turn every cloud to face the airplane
// (getFacingYaw()).

export const CLOUD_CONFIG = Object.freeze({
	cellSize: 160,
	// Share of the cell on each side the base never enters.
	jitterMargin: 0.12,
	// Wavelength of the coverage noise, in world units: whole regions of sky
	// are cloudy or clear.
	coverageScale: 1400,
	// Softness of the coverage edge, in noise units.
	coverageSoftness: 0.2,
	types: Object.freeze([
		[CLOUD_TYPE.BANK, 0.35],
		[CLOUD_TYPE.HEAP, 0.3],
		[CLOUD_TYPE.PUFF, 0.35],
	]),
	// [min scale, max scale, min stretch, max stretch]
	shape: Object.freeze({
		[CLOUD_TYPE.BANK]: Object.freeze([0.85, 1.35, 0.9, 1.1]),
		[CLOUD_TYPE.HEAP]: Object.freeze([0.85, 1.4, 0.9, 1.15]),
		[CLOUD_TYPE.PUFF]: Object.freeze([0.7, 1.6, 0.85, 1.15]),
	}),
	// Upper bounds of each source model at scale 1 (cloudArchetypes.js):
	// [half width (x), height (y), half depth (z)], so neighbours that could
	// cut through each other are dropped. Clouds turn, so the test uses the
	// footprint circle, of radius hypot(half width, half depth).
	extent: Object.freeze({
		[CLOUD_TYPE.BANK]: Object.freeze([39, 28, 10]),
		[CLOUD_TYPE.HEAP]: Object.freeze([34, 33, 11]),
		[CLOUD_TYPE.PUFF]: Object.freeze([19, 20, 8]),
	}),
})

// Settings keys for each type; the debug GUI edits values under these names.
export const CLOUD_TYPE_KEYS = Object.freeze({
	[CLOUD_TYPE.BANK]: 'bank',
	[CLOUD_TYPE.HEAP]: 'heap',
	[CLOUD_TYPE.PUFF]: 'puff',
})

// Field radius around the airplane, in world units. Clouds shrink into the
// fog before it (getCloudFarFade()), and the curved horizon hides them beyond
// about 1,500 units.
export const CLOUD_FIELD_RADIUS = Object.freeze({ desktop: 1500, mobile: 1100 })

// Eye distances inside the field radius where cloud impostors shrink into the
// fog, so clouds entering or leaving the field never pop.
export const CLOUD_FAR_FADE_MARGINS = Object.freeze({ start: 250, end: 50 })

// [start, end] of the far fade for a field `radius`.
export function getCloudFarFade(radius, margins = CLOUD_FAR_FADE_MARGINS) {
	const end = Math.max(radius - margins.end, 1)
	return [Math.min(Math.max(radius - margins.start, 0), end - 1), end]
}

// Runtime settings. `density` is the share of cells holding a cloud where the
// sky is cloudy, `coverage` the share of sky that is cloudy, `altitude` the
// band (world Y) of the cloud bases, and `size` a multiplier per type.
// `regional` varies density, coverage, and size smoothly across the world
// (getCloudRegion()): `scale` is the wavelength of its noise fields in world
// units, and each amplitude is the largest change, `0` for none. Altitude and
// radius never vary.
export function createCloudSettings({ isMobile = false } = {}) {
	return {
		radius: isMobile ? CLOUD_FIELD_RADIUS.mobile : CLOUD_FIELD_RADIUS.desktop,
		density: 0.55,
		coverage: 0.6,
		altitude: { min: 130, range: 60 },
		size: { bank: 1, heap: 1, puff: 1 },
		regional: {
			scale: 4000,
			// Relative: density × (1 ± amount).
			density: 0.6,
			// Absolute share of sky: coverage ± amount.
			coverage: 0.3,
			// Stops: size × 2^(± amount).
			size: 0.5,
		},
	}
}

// [cos, sin] of the yaw that turns a cloud at (baseX, baseZ) so its front
// face (local -Z) looks at (targetX, targetZ): rotating local -Z by it gives
// the horizontal direction to the target. With the target straight above or
// below, it keeps the starting orientation. GLSL twin: scenery-facing.glsl.
export function getFacingYaw(baseX, baseZ, targetX, targetZ) {
	const dx = targetX - baseX
	const dz = targetZ - baseZ
	const distance = Math.hypot(dx, dz)
	if (distance <= 1e-3) return [1, 0]
	return [-dz / distance, -dx / distance]
}

export function getCloudCell(x, z, cellSize = CLOUD_CONFIG.cellSize) {
	return [Math.floor(x / cellSize), Math.floor(z / cellSize)]
}

function smoothstep(edge0, edge1, x) {
	const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1)
	return t * t * (3 - 2 * t)
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

// 0 in clear sky, 1 in cloudy sky, for a local `coverage` share.
function getCloudiness(x, z, offset, coverage, config) {
	const noise =
		snoise((x + offset[0]) / config.coverageScale, (z + offset[1]) / config.coverageScale) * 0.5 + 0.5
	// Coverage 0 puts the whole soft edge above the noise range (clear sky),
	// coverage 1 below it (cloudy everywhere).
	const softness = config.coverageSoftness
	const threshold = (1 - coverage) * (1 + softness * 2) - softness
	return smoothstep(threshold - softness, threshold + softness, noise)
}

// Seeded offsets of the noise fields, so every seed has its own sky:
// `coverage` for the cloudy and clear patches, and one per regional field.
export function getCloudFieldOffsets(seed) {
	const seedHash = hashSeed(seed)
	const offset = (salt) => [
		(cellRandom(seedHash, 0, 0, salt) - 0.5) * 200000,
		(cellRandom(seedHash, 0, 0, salt + 1) - 0.5) * 200000,
	]
	return {
		coverage: offset(101),
		density: offset(103),
		regionCoverage: offset(105),
		size: offset(107),
	}
}

// Smooth noise in [-1, 1] with a wavelength of `scale` world units: two
// octaves, stretched so regions reach the extremes, as in getSceneryTint().
function getRegionNoise(x, z, offset, scale) {
	const u = (x + offset[0]) / scale
	const v = (z + offset[1]) / scale
	const noise = snoise(u, v) * 0.7 + snoise(u * 2.3 + 17.1, v * 2.3 - 5.3) * 0.3
	return Math.min(Math.max(noise * 1.5, -1), 1)
}

function clamp01(value) {
	return Math.min(Math.max(value, 0), 1)
}

// Local density, coverage, and size multiplier at (x, z): settings modulated
// by three independent low-frequency fields (settings.regional), so some
// regions hold packed, scattered, large, or small clouds. Continuous in x and
// z, and independent of the field center. `offsets` comes from
// getCloudFieldOffsets().
export function getCloudRegion(x, z, offsets, settings, target = {}) {
	const { scale, density, coverage, size } = settings.regional
	target.density = clamp01(
		settings.density * (1 + density * getRegionNoise(x, z, offsets.density, scale)),
	)
	target.coverage = clamp01(
		settings.coverage + coverage * getRegionNoise(x, z, offsets.regionCoverage, scale),
	)
	target.size = 2 ** (size * getRegionNoise(x, z, offsets.size, scale))
	return target
}

// The cell's cloud before the neighbour test, or null.
function getCandidate(seedHash, cellX, cellZ, offsets, settings, config, region) {
	const span = 1 - config.jitterMargin * 2
	const x = (cellX + config.jitterMargin + span * cellRandom(seedHash, cellX, cellZ, 0)) * config.cellSize
	const z = (cellZ + config.jitterMargin + span * cellRandom(seedHash, cellX, cellZ, 1)) * config.cellSize
	getCloudRegion(x, z, offsets, settings, region)
	const density = region.density * getCloudiness(x, z, offsets.coverage, region.coverage, config)
	if (cellRandom(seedHash, cellX, cellZ, 2) >= density) return null

	const type = pickWeighted(config.types, cellRandom(seedHash, cellX, cellZ, 3))
	const [minScale, maxScale, minStretch, maxStretch] = config.shape[type]
	const scale =
		(minScale + (maxScale - minScale) * cellRandom(seedHash, cellX, cellZ, 4)) *
		settings.size[CLOUD_TYPE_KEYS[type]] *
		region.size
	if (scale <= 0) return null
	const stretch = minStretch + (maxStretch - minStretch) * cellRandom(seedHash, cellX, cellZ, 5)
	const y = settings.altitude.min + settings.altitude.range * cellRandom(seedHash, cellX, cellZ, 9)
	const [halfWidth, height, halfDepth] = config.extent[type]
	// Clouds turn toward the airplane, so their footprint is a circle.
	return {
		x,
		y,
		z,
		type,
		scale,
		stretch,
		footprint: Math.hypot(halfWidth, halfDepth) * scale,
		height: height * scale * stretch,
		priority: cellRandom(seedHash, cellX, cellZ, 8),
	}
}

function overlaps(a, b) {
	return (
		Math.hypot(a.x - b.x, a.z - b.z) < a.footprint + b.footprint &&
		a.y < b.y + b.height &&
		b.y < a.y + a.height
	)
}

// Clouds whose base lies within `radius` (horizontal) of (centerX, centerZ).
// A candidate that would cut through a neighbour with a lower priority value
// is dropped; the test reads only the raw neighbouring candidates, so the
// result never depends on the center.
export function generateCloudInstances({
	seed,
	centerX,
	centerZ,
	settings = createCloudSettings(),
	config = CLOUD_CONFIG,
}) {
	const { cellSize } = config
	const radius = settings.radius
	const seedHash = hashSeed(seed)
	const offsets = getCloudFieldOffsets(seed)
	const region = {}
	const [minCellX, minCellZ] = getCloudCell(centerX - radius, centerZ - radius, cellSize)
	const [maxCellX, maxCellZ] = getCloudCell(centerX + radius, centerZ + radius, cellSize)

	// Candidates of the scanned cells plus a one-cell border for the
	// neighbour test, computed once each.
	const columns = maxCellX - minCellX + 3
	const candidates = new Array(columns * (maxCellZ - minCellZ + 3))
	const getCell = (cellX, cellZ) => {
		const index = (cellZ - minCellZ + 1) * columns + (cellX - minCellX + 1)
		if (candidates[index] === undefined) {
			candidates[index] = getCandidate(seedHash, cellX, cellZ, offsets, settings, config, region)
		}
		return candidates[index]
	}

	const values = []
	const radiusSquared = radius * radius
	for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
		for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
			const cloud = getCell(cellX, cellZ)
			if (!cloud) continue
			const dx = cloud.x - centerX
			const dz = cloud.z - centerZ
			if (dx * dx + dz * dz > radiusSquared) continue

			let blocked = false
			for (let z = -1; z <= 1 && !blocked; z++) {
				for (let x = -1; x <= 1 && !blocked; x++) {
					if (x === 0 && z === 0) continue
					const neighbour = getCell(cellX + x, cellZ + z)
					blocked = Boolean(
						neighbour && neighbour.priority < cloud.priority && overlaps(cloud, neighbour),
					)
				}
			}
			if (blocked) continue

			const brightness = 0.94 + cellRandom(seedHash, cellX, cellZ, 7) * 0.12
			values.push(
				cloud.x,
				cloud.y,
				cloud.z,
				cloud.scale,
				cellRandom(seedHash, cellX, cellZ, 6) * Math.PI * 2,
				cloud.type,
				packTint(brightness, brightness, brightness * 0.98),
				cloud.stretch,
			)
		}
	}

	return new Float32Array(values)
}
