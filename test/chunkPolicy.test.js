import assert from 'node:assert/strict'
import test from 'node:test'
import {
	CHUNK_STREAMING,
	getChunkKey,
	getChunkWorkerCount,
	getCurvatureDrop,
	getCurvedBoxSphere,
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
	assert.ok(north.get(getChunkKey(0, 2)).priority < north.get(getChunkKey(0, -2)).priority)
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

test('uses one worker on mobile and half the cores on desktop, up to four', () => {
	assert.equal(getChunkWorkerCount({ isMobile: true, hardwareConcurrency: 8 }), 1)
	assert.equal(getChunkWorkerCount({ hardwareConcurrency: 1 }), 1)
	assert.equal(getChunkWorkerCount({ hardwareConcurrency: 2 }), 1)
	assert.equal(getChunkWorkerCount({ hardwareConcurrency: 4 }), 2)
	assert.equal(getChunkWorkerCount({ hardwareConcurrency: 8 }), 4)
	assert.equal(getChunkWorkerCount({ hardwareConcurrency: 16 }), 4)
	assert.equal(getChunkWorkerCount(), 1)
})

test('commit budgets allow at least a few full-detail chunks per frame', () => {
	for (const [streaming, segments] of [
		[CHUNK_STREAMING.desktop, 128],
		[CHUNK_STREAMING.mobile, 64],
	]) {
		// position, normal, and height: 7 floats per vertex.
		const bytes = (segments + 1) ** 2 * 7 * 4
		assert.ok(streaming.commitBytes >= bytes * 3)
		assert.ok(streaming.commitMs > 0)
	}
})

test('the curved sphere encloses every point of the box after its drop', () => {
	const curvature = 3000
	assert.equal(getCurvatureDrop(0, curvature), 0)
	assert.ok(getCurvatureDrop(2000, curvature) > getCurvatureDrop(1000, curvature))
	// A 256-unit chunk with 40 units of relief, from near the eye to beyond the fog.
	const half = 128
	const halfHeight = 20
	for (const centerDistance of [0, 100, 600, 1500, 3000]) {
		const { drop, radius } = getCurvedBoxSphere(
			centerDistance,
			half * Math.SQRT2,
			halfHeight,
			curvature,
		)
		for (let sample = 0; sample < 500; sample++) {
			// Points of the box, the eye on its +X side at the center's height.
			const x = ((sample % 10) / 9 - 0.5) * 2 * half
			const z = ((Math.floor(sample / 10) % 10) / 9 - 0.5) * 2 * half
			const y = ((Math.floor(sample / 100) % 5) / 4 - 0.5) * 2 * halfHeight
			const pointDrop = getCurvatureDrop(Math.hypot(centerDistance + x, y, z), curvature)
			const offset = Math.hypot(x, y - pointDrop + drop, z)
			assert.ok(offset <= radius + 1e-6, `${centerDistance}: ${offset} > ${radius}`)
		}
		// Much tighter than growing the box's sphere in every direction.
		const reach = Math.hypot(half * Math.SQRT2, halfHeight)
		const range =
			getCurvatureDrop(centerDistance + reach, curvature) -
			getCurvatureDrop(Math.max(centerDistance - reach, 0), curvature)
		assert.ok(radius <= reach + range / 2 + 1e-9)
	}
})
