import assert from 'node:assert/strict'
import test from 'node:test'
import {
	getChunkKey,
	getDesiredChunks,
	hasSceneryAtLOD,
	needsSceneryPlacement,
} from '../src/chunkPolicy.js'

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

	assert.equal(needsSceneryPlacement('create', 1, false), true)
	assert.equal(needsSceneryPlacement('create', 3, false), false)
	assert.equal(needsSceneryPlacement('updateLOD', 1, true), false)
	assert.equal(needsSceneryPlacement('updateLOD', 2, false), true)
	assert.equal(needsSceneryPlacement('regenerate', 0, true), true)
})
