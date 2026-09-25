export function getChunkKey(i, j) {
	return `${i}|${j}`
}

export function getChunkLOD(distance) {
	return Math.floor(distance * 0.7)
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
