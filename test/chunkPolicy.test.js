import assert from 'node:assert/strict'
import test from 'node:test'
import {
	CHUNK_STREAMING,
	getChunkKey,
	getDesiredChunks,
	getHeadingSector,
	getSectorDirection,
	hasSceneryAtDistance,
	hasSceneryAtLOD,
	needsSceneryPlacement,
} from '../src/chunkPolicy.js'

function getForwardSet(sector, streaming = CHUNK_STREAMING.desktop) {
	return getDesiredChunks(0, 0, streaming.maxDistance, {
		heading: getSectorDirection(sector),
		lookAhead: streaming.lookAhead,
		rearDistance: streaming.rearDistance,
	})
}

test('creates symmetric desktop and mobile desired sets', () => {
	assert.equal(getDesiredChunks(0, 0, 5).size, 81)
	assert.equal(getDesiredChunks(0, 0, 4).size, 49)
})

test('keeps the desired set symmetric around negative coordinates', () => {
	const centerI = -12
	const centerJ = 7
	const desired = getDesiredChunks(centerI, centerJ, 5)

	for (const {
		coords: [i, j],
	} of desired.values()) {
		const mirroredKey = getChunkKey(2 * centerI - i, 2 * centerJ - j)
		assert.equal(desired.has(mirroredKey), true)
	}
})

test('preserves the existing distance-based LOD policy', () => {
	const desired = getDesiredChunks(0, 0, 5)

	assert.equal(desired.get('0|0').LOD, 0)
	assert.equal(desired.get('1|0').LOD, 0)
	assert.equal(desired.get('2|0').LOD, 1)
	assert.equal(desired.get('4|0').LOD, 2)
	assert.equal(desired.get('5|0').LOD, 3)
})

test('places scenery only in near LODs and only when missing', () => {
	assert.equal(hasSceneryAtLOD(0), true)
	assert.equal(hasSceneryAtLOD(2), true)
	assert.equal(hasSceneryAtLOD(3), false)
	assert.equal(hasSceneryAtDistance(4), true)
	assert.equal(hasSceneryAtDistance(5), false)

	assert.equal(needsSceneryPlacement('create', true, false), true)
	assert.equal(needsSceneryPlacement('create', false, false), false)
	assert.equal(needsSceneryPlacement('updateLOD', true, true), false)
	assert.equal(needsSceneryPlacement('updateLOD', true, false), true)
	assert.equal(needsSceneryPlacement('regenerate', true, true), true)
	assert.equal(needsSceneryPlacement('scenery', true, true), true)
	assert.equal(needsSceneryPlacement('updateLOD', true, true, true), true)
	assert.equal(needsSceneryPlacement('updateLOD', false, false, true), false)
})

test('quantizes the heading with hysteresis around sector boundaries', () => {
	const sectors = 8
	const direction = (degrees) => {
		const angle = (degrees * Math.PI) / 180
		return [Math.sin(angle), Math.cos(angle)]
	}

	assert.equal(getHeadingSector(0, 1, null, sectors, 0.15), 0)
	assert.equal(getHeadingSector(1, 0, null, sectors, 0.15), 2)
	assert.equal(getHeadingSector(-1, 0, null, sectors, 0.15), 6)
	assert.equal(getHeadingSector(...direction(-10), null, sectors, 0.15), 0)

	// 25 degrees is past the 22.5 degree boundary but inside the hysteresis.
	assert.equal(getHeadingSector(...direction(25), 0, sectors, 0.15), 0)
	assert.equal(getHeadingSector(...direction(35), 0, sectors, 0.15), 1)
	assert.equal(getHeadingSector(...direction(-25), 0, sectors, 0.15), 0)
	assert.equal(getHeadingSector(...direction(-35), 0, sectors, 0.15), 7)
	// Wrapping across 180 degrees keeps the previous sector.
	assert.equal(getHeadingSector(...direction(175), 4, sectors, 0.15), 4)
	assert.equal(getHeadingSector(...direction(-175), 4, sectors, 0.15), 4)
	// A vertical heading keeps the previous sector.
	assert.equal(getHeadingSector(0, 0, 3, sectors, 0.15), 3)

	for (let sector = 0; sector < sectors; sector++) {
		const [x, z] = getSectorDirection(sector, sectors)
		assert.equal(getHeadingSector(x, z, null, sectors, 0.15), sector)
	}
})

test('streams farther ahead than behind along the heading', () => {
	const streaming = CHUNK_STREAMING.desktop
	const reachAhead = streaming.maxDistance + streaming.lookAhead
	const north = getForwardSet(0)

	assert.equal(north.has('0|0'), true)
	assert.equal(north.has(getChunkKey(0, reachAhead)), true)
	assert.equal(north.has(getChunkKey(0, reachAhead + 1)), false)
	assert.equal(north.has(getChunkKey(0, -streaming.rearDistance)), true)
	assert.equal(north.has(getChunkKey(0, -streaming.rearDistance - 1)), false)
	assert.equal(north.has(getChunkKey(streaming.maxDistance, 0)), true)
	assert.equal(north.has(getChunkKey(-streaming.maxDistance, 0)), true)

	// Turning mirrors the shape.
	const east = getForwardSet(2)
	assert.equal(east.has(getChunkKey(reachAhead, 0)), true)
	assert.equal(east.has(getChunkKey(-streaming.rearDistance - 1, 0)), false)
})

test('shifts LOD rings forward and keeps the rear radial', () => {
	const streaming = CHUNK_STREAMING.desktop
	const north = getForwardSet(0)

	for (let j = 0; j <= streaming.lookAhead; j++) {
		assert.equal(north.get(getChunkKey(0, j)).LOD, 0)
		assert.equal(north.get(getChunkKey(1, j)).LOD, 0)
	}
	assert.equal(north.get(getChunkKey(0, streaming.lookAhead + 2)).LOD, 1)
	assert.equal(north.get(getChunkKey(0, -1)).LOD, 0)
	assert.equal(north.get(getChunkKey(0, -2)).LOD, 1)
	assert.equal(north.get(getChunkKey(2, 0)).LOD, 1)

	// Chunks ahead are scheduled before chunks equally far behind.
	assert.ok(
		north.get(getChunkKey(0, 2)).priority <
			north.get(getChunkKey(0, -2)).priority,
	)
})

test('keeps scenery range radial when LOD is shifted forward', () => {
	for (const target of getForwardSet(0).values()) {
		assert.equal(target.scenery, hasSceneryAtDistance(target.distance))
	}
	const north = getForwardSet(0)
	assert.equal(north.get(getChunkKey(0, 5)).LOD <= 2, true)
	assert.equal(north.get(getChunkKey(0, 5)).scenery, false)
})

test('keeps forward sets connected and centered on the current chunk', () => {
	for (const streaming of [CHUNK_STREAMING.desktop, CHUNK_STREAMING.mobile]) {
		for (let sector = 0; sector < CHUNK_STREAMING.headingSectors; sector++) {
			const desired = getForwardSet(sector, streaming)
			for (const [di, dj] of [
				[0, 0],
				[1, 0],
				[-1, 0],
				[0, 1],
				[0, -1],
				[1, 1],
				[-1, -1],
				[1, -1],
				[-1, 1],
			]) {
				assert.equal(desired.has(getChunkKey(di, dj)), true)
			}
		}
	}
})
