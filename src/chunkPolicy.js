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
// Finished worker results are committed nearest first, at least one per
// frame, until `commitBytes` of new terrain and scenery buffers (uploaded on
// the next render) or `commitMs` of main-thread time is reached.
export const CHUNK_STREAMING = Object.freeze({
	desktop: Object.freeze({
		maxDistance: 6,
		lookAhead: 2,
		rearDistance: 3,
		commitBytes: 1_500_000,
		commitMs: 4,
	}),
	mobile: Object.freeze({
		maxDistance: 5,
		lookAhead: 1,
		rearDistance: 2.5,
		commitBytes: 400_000,
		commitMs: 3,
	}),
	headingSectors: 8,
	// Extra fraction of a sector the heading must cross before the set turns.
	headingHysteresis: 0.15,
})

// Chunk workers: one on mobile; on desktop half the logical cores, from one
// to four, leaving the rest to the main thread and the browser.
export function getChunkWorkerCount({ isMobile = false, hardwareConcurrency = 2 } = {}) {
	if (isMobile) return 1
	return Math.min(Math.max(Math.floor(hardwareConcurrency / 2), 1), 4)
}

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

function isInStreamingShape({ lodDistance, along, lateral }, maxDistance, rearDistance) {
	if (along >= 0) return lodDistance <= maxDistance
	// Half ellipse behind the center, continuous with the sides.
	return Math.hypot(along / rearDistance, lateral / maxDistance) <= 1
}

// Without `options.heading` the set is the symmetric disc of `maxDistance`.
// `heading` is a unit [i, j] direction, as from `getSectorDirection()`.
export function getDesiredChunks(centerI, centerJ, maxDistance, options = {}) {
	const { heading = null, lookAhead = 0, rearDistance = maxDistance } = options
	const reach = heading ? maxDistance + Math.max(lookAhead, 0) : maxDistance
	const desired = new Map()

	for (let i = centerI - reach; i <= centerI + reach; i++) {
		for (let j = centerJ - reach; j <= centerJ + reach; j++) {
			const distances = getStreamingDistances(i - centerI, j - centerJ, heading, lookAhead)
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
export function needsSceneryPlacement(jobType, inSceneryRange, chunkHasScenery, refresh = false) {
	if (!inSceneryRange) return false
	if (refresh) return true
	return jobType !== 'updateLOD' || !chunkHasScenery
}

// Vertical drop of the curved world at `distance` (3D) from the eye, as in
// project-vertex.glsl.
export function getCurvatureDrop(distance, curvature) {
	return curvature * (1 - Math.cos(distance / curvature))
}

// Bounding sphere, on the curved world, of a box whose center is `distance`
// (3D) from the eye: `horizontal` is the half diagonal of its footprint and
// `halfHeight` its half height. Each point drops by the curvature at its own
// distance, between the drops at `distance ± reach` (`reach` is the box's
// half diagonal), so the box only stretches vertically: the sphere moves down
// by the mean of the two drops and covers the box made taller by their range.
// Growing the box's sphere in every direction instead would keep more chunks
// at the sides of the view.
export function getCurvedBoxSphere(distance, horizontal, halfHeight, curvature) {
	const reach = Math.hypot(horizontal, halfHeight)
	const near = getCurvatureDrop(Math.max(distance - reach, 0), curvature)
	const far = getCurvatureDrop(distance + reach, curvature)
	return {
		drop: (near + far) / 2,
		radius: Math.hypot(horizontal, halfHeight + (far - near) / 2),
	}
}
