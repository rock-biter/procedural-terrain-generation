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

// Scenery is placed once per chunk and kept across LOD changes within range;
// a create or regenerate job always rebuilds it.
export function needsSceneryPlacement(jobType, LOD, chunkHasScenery) {
	if (!hasSceneryAtLOD(LOD)) return false
	return jobType !== 'updateLOD' || !chunkHasScenery
}

export function getDesiredChunks(centerI, centerJ, maxDistance) {
	const desired = new Map()

	for (let i = centerI - maxDistance; i <= centerI + maxDistance; i++) {
		for (let j = centerJ - maxDistance; j <= centerJ + maxDistance; j++) {
			const distance = Math.hypot(i - centerI, j - centerJ)
			if (distance > maxDistance) continue

			const key = getChunkKey(i, j)
			desired.set(key, {
				key,
				coords: [i, j],
				distance,
				LOD: getChunkLOD(distance),
			})
		}
	}

	return desired
}
