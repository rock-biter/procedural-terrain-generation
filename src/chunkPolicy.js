export function getChunkKey(i, j) {
	return `${i}|${j}`
}

export function getChunkLOD(distance) {
	return Math.floor(distance * 0.7)
}

// Farther chunks are hidden by fog, so they carry no scenery.
export const SCENERY_MAX_LOD = 2

export function hasSceneryAtLOD(LOD) {
	return LOD <= SCENERY_MAX_LOD
}

// Scenery range stays radial: impostors fade out by 950 units whatever the
// heading, so the forward LOD shift must not add scenery inside the fog.
export function hasSceneryAtDistance(distance) {
	return hasSceneryAtLOD(getChunkLOD(distance))
}

// Streaming shape, in chunks. The set reaches `maxDistance` ahead of a segment
// that extends `lookAhead` chunks along the heading, keeps `maxDistance` to the
// sides, and only `rearDistance` behind. `lookAhead` also pushes the LOD rings
// forward, so seams between LODs stay far ahead of a high-flying plane.
export const CHUNK_STREAMING = Object.freeze({
	desktop: Object.freeze({ maxDistance: 6, lookAhead: 2, rearDistance: 3 }),
	mobile: Object.freeze({ maxDistance: 5, lookAhead: 1, rearDistance: 2.5 }),
	headingSectors: 8,
	// Extra fraction of a sector the heading must cross before the set turns.
	headingHysteresis: 0.15,
})

function wrapSector(sector, sectors) {
	return ((sector % sectors) + sectors) % sectors
}

// Quantizes a horizontal heading (+Z is sector 0, +X is a quarter turn) so
// the desired set changes only after a real turn, with hysteresis around the
// sector boundaries. Returns `previous` for a vertical or zero heading.
export function getHeadingSector(
	forwardX,
	forwardZ,
	previous = null,
	sectors = CHUNK_STREAMING.headingSectors,
	hysteresis = CHUNK_STREAMING.headingHysteresis,
) {
	if (Math.hypot(forwardX, forwardZ) < 1e-6) return previous ?? 0

	const sector = (Math.atan2(forwardX, forwardZ) / (Math.PI * 2)) * sectors
	if (previous !== null) {
		const offset = wrapSector(sector - previous + sectors / 2, sectors) - sectors / 2
		if (Math.abs(offset) <= 0.5 + hysteresis) return previous
	}

	return wrapSector(Math.round(sector), sectors)
}

export function getSectorDirection(sector, sectors = CHUNK_STREAMING.headingSectors) {
	const angle = (sector / sectors) * Math.PI * 2
	return [Math.sin(angle), Math.cos(angle)]
}

// Distances in chunks from the center chunk to an offset (di, dj).
// `distance` is radial; `lodDistance` is measured to the look-ahead segment.
export function getStreamingDistances(di, dj, heading = null, lookAhead = 0) {
	const distance = Math.hypot(di, dj)
	if (!heading || lookAhead <= 0) {
		return { distance, lodDistance: distance, along: 0, lateral: distance }
	}

	const [forwardI, forwardJ] = heading
	const along = di * forwardI + dj * forwardJ
	const lateral = Math.abs(di * forwardJ - dj * forwardI)
	const segment = Math.max(0, Math.min(along, lookAhead))
	const lodDistance = Math.hypot(along - segment, lateral)

	return { distance, lodDistance, along, lateral }
}

function isInStreamingShape(
	{ lodDistance, along, lateral },
	maxDistance,
	rearDistance,
) {
	if (along >= 0) return lodDistance <= maxDistance
	// Half ellipse behind the center, continuous with the sides.
	return Math.hypot(along / rearDistance, lateral / maxDistance) <= 1
}

// Without `options.heading` the set is the symmetric disc of `maxDistance`.
// `heading` is a unit [i, j] direction, as from `getSectorDirection()`.
export function getDesiredChunks(centerI, centerJ, maxDistance, options = {}) {
	const {
		heading = null,
		lookAhead = 0,
		rearDistance = maxDistance,
	} = options
	const reach = heading ? maxDistance + Math.max(lookAhead, 0) : maxDistance
	const desired = new Map()

	for (let i = centerI - reach; i <= centerI + reach; i++) {
		for (let j = centerJ - reach; j <= centerJ + reach; j++) {
			const distances = getStreamingDistances(
				i - centerI,
				j - centerJ,
				heading,
				lookAhead,
			)
			if (!isInStreamingShape(distances, maxDistance, rearDistance)) continue

			const key = getChunkKey(i, j)
			desired.set(key, {
				key,
				coords: [i, j],
				distance: distances.distance,
				// Jobs run in this order, so chunks ahead are generated first.
				priority: distances.lodDistance,
				LOD: getChunkLOD(distances.lodDistance),
				scenery: hasSceneryAtDistance(distances.distance),
			})
		}
	}

	return desired
}

// Scenery is placed once per chunk and kept across LOD changes within range.
// Create, regenerate, and scenery-only jobs rebuild it, as does any job queued
// after a scenery-settings change (`refresh`).
export function needsSceneryPlacement(
	jobType,
	inSceneryRange,
	chunkHasScenery,
	refresh = false,
) {
	if (!inSceneryRange) return false
	if (refresh) return true
	return jobType !== 'updateLOD' || !chunkHasScenery
}
