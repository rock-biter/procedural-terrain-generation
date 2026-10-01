import assert from 'node:assert/strict'
import test from 'node:test'
import {
	IMPOSTOR_INSTANCE_STRIDE,
	IMPOSTOR_TYPE,
	IMPOSTOR_TYPE_COUNT,
} from '../src/impostors/impostorTypes.js'
import {
	SCENERY_MESH_DISABLED_RANGE,
	SCENERY_MESH_RANGES,
	SCENERY_MESH_SELECTION_MARGIN,
	appendNearSceneryInstances,
	chunkIntersectsSelection,
	createSceneryBuckets,
	createSceneryMeshSettings,
	ensureSceneryBucketCapacity,
	getSceneryMeshFade,
	getSceneryMeshRange,
	getSceneryMeshSelectionRadius,
	resetSceneryBuckets,
} from '../src/sceneryMeshPolicy.js'

// One instance in the placement layout: local base, scale, yaw, type, tint, stretch.
function instance(x, y, z, type, { scale = 1, yaw = 0.5, tint = 7, stretch = 1.1 } = {}) {
	return [x, y, z, scale, yaw, type, tint, stretch]
}

test('uses a nearer band on mobile', () => {
	assert.deepEqual(createSceneryMeshSettings(), {
		enabled: true,
		...SCENERY_MESH_RANGES.desktop,
	})
	assert.deepEqual(createSceneryMeshSettings({ isMobile: true }), {
		enabled: true,
		...SCENERY_MESH_RANGES.mobile,
	})
	assert.ok(SCENERY_MESH_RANGES.mobile.end < SCENERY_MESH_RANGES.desktop.end)
})

test('fade is the mesh inside the band start and the impostor beyond its end', () => {
	const { start, end } = SCENERY_MESH_RANGES.desktop
	assert.equal(getSceneryMeshFade(0, start, end), 1)
	assert.equal(getSceneryMeshFade(start, start, end), 1)
	assert.equal(getSceneryMeshFade((start + end) / 2, start, end), 0.5)
	assert.equal(getSceneryMeshFade(end, start, end), 0)
	assert.equal(getSceneryMeshFade(end + 500, start, end), 0)

	let previous = 1
	for (let distance = start; distance <= end; distance += 1) {
		const fade = getSceneryMeshFade(distance, start, end)
		assert.ok(fade <= previous, 'fade decreases with distance')
		// The impostor keeps exactly the pixels the mesh discards.
		assert.ok(fade >= 0 && fade <= 1)
		previous = fade
	}
})

test('a disabled range gives the impostor every distance', () => {
	const range = getSceneryMeshRange({ enabled: false, start: 110, end: 150 })
	assert.deepEqual(range, [...SCENERY_MESH_DISABLED_RANGE])
	for (const distance of [0, 1, 50, 5000]) {
		assert.equal(getSceneryMeshFade(distance, ...range), 0)
	}
	assert.equal(
		getSceneryMeshSelectionRadius({ enabled: false, start: 110, end: 150 }),
		0,
	)
})

test('keeps the band valid for smoothstep', () => {
	assert.deepEqual(getSceneryMeshRange({ enabled: true, start: 120, end: 80 }), [
		120, 121,
	])
	assert.deepEqual(getSceneryMeshRange({ enabled: true, start: -5, end: 40 }), [
		0, 40,
	])
})

test('selection covers the whole band', () => {
	const settings = createSceneryMeshSettings()
	const radius = getSceneryMeshSelectionRadius(settings)
	assert.equal(radius, settings.end + SCENERY_MESH_SELECTION_MARGIN)
	// Any instance with a nonzero fade is selected.
	assert.ok(getSceneryMeshFade(radius, settings.start, settings.end) === 0)
	assert.ok(getSceneryMeshFade(settings.end - 0.01, settings.start, settings.end) > 0)
})

test('chunk pre-filter uses the closest point of the chunk square', () => {
	// Eye inside the chunk.
	assert.ok(chunkIntersectsSelection(128, 128, 128, 10, 10, 1))
	// 100 units from the chunk edge.
	assert.ok(chunkIntersectsSelection(128, 128, 128, 356, 128, 100))
	assert.ok(!chunkIntersectsSelection(128, 128, 128, 357, 128, 100))
	// Diagonal: corner at (256, 256), eye 30-40-50 away.
	assert.ok(chunkIntersectsSelection(128, 128, 128, 286, 296, 50))
	assert.ok(!chunkIntersectsSelection(128, 128, 128, 286, 296, 49.9))
})

test('appends near instances per type with world bases', () => {
	const buckets = createSceneryBuckets(4)
	const instances = new Float32Array([
		...instance(0, 2, 0, IMPOSTOR_TYPE.ROUND_TREE, { scale: 1.2, tint: 99 }),
		...instance(10, 0, 0, IMPOSTOR_TYPE.BOULDER),
		...instance(500, 0, 0, IMPOSTOR_TYPE.CONIFER),
		...instance(-20, 0, 5, IMPOSTOR_TYPE.ROUND_TREE),
	])
	const appended = appendNearSceneryInstances(
		buckets,
		instances,
		1000,
		-3,
		2000,
		1000,
		0,
		2000,
		100,
	)
	assert.equal(appended, 3)
	assert.equal(buckets[IMPOSTOR_TYPE.ROUND_TREE].count, 2)
	assert.equal(buckets[IMPOSTOR_TYPE.BOULDER].count, 1)
	assert.equal(buckets[IMPOSTOR_TYPE.CONIFER].count, 0)

	const tree = buckets[IMPOSTOR_TYPE.ROUND_TREE].array
	assert.deepEqual(
		[...tree.subarray(0, IMPOSTOR_INSTANCE_STRIDE)],
		[1000, -1, 2000, Math.fround(1.2), 0.5, IMPOSTOR_TYPE.ROUND_TREE, 99, Math.fround(1.1)],
	)
	assert.deepEqual([...tree.subarray(8, 11)], [980, -3, 2005])

	resetSceneryBuckets(buckets)
	assert.ok(buckets.every((bucket) => bucket.count === 0))
})

test('uses the 3D eye distance and the visibility callback', () => {
	const buckets = createSceneryBuckets(4)
	const instances = new Float32Array([
		...instance(0, 0, 0, IMPOSTOR_TYPE.CACTUS_ONE_ARM),
		...instance(30, 0, 0, IMPOSTOR_TYPE.CACTUS_TWO_ARMS),
	])
	// The eye is 90 units above the first base: outside a radius of 80.
	assert.equal(
		appendNearSceneryInstances(buckets, instances, 0, 0, 0, 0, 90, 0, 80),
		0,
	)

	const seen = []
	const appended = appendNearSceneryInstances(
		buckets,
		instances,
		0,
		0,
		0,
		0,
		10,
		0,
		80,
		(type, x, y, z, scale, stretch) => {
			seen.push([type, x, y, z, scale, Math.fround(stretch)])
			return type === IMPOSTOR_TYPE.CACTUS_ONE_ARM
		},
	)
	assert.equal(appended, 1)
	assert.equal(buckets[IMPOSTOR_TYPE.CACTUS_ONE_ARM].count, 1)
	assert.equal(buckets[IMPOSTOR_TYPE.CACTUS_TWO_ARMS].count, 0)
	assert.deepEqual(seen, [
		[IMPOSTOR_TYPE.CACTUS_ONE_ARM, 0, 0, 0, 1, Math.fround(1.1)],
		[IMPOSTOR_TYPE.CACTUS_TWO_ARMS, 30, 0, 0, 1, Math.fround(1.1)],
	])
})

test('buckets grow by doubling and are reused across frames', () => {
	const buckets = createSceneryBuckets(2)
	assert.equal(buckets.length, IMPOSTOR_TYPE_COUNT)
	const values = []
	for (let i = 0; i < 9; i++) values.push(...instance(i, 0, 0, IMPOSTOR_TYPE.LAYERED_ROCK))
	const instances = new Float32Array(values)

	appendNearSceneryInstances(buckets, instances, 0, 0, 0, 0, 0, 0, 100)
	const rocks = buckets[IMPOSTOR_TYPE.LAYERED_ROCK]
	assert.equal(rocks.count, 9)
	assert.equal(rocks.array.length, 16 * IMPOSTOR_INSTANCE_STRIDE)
	assert.equal(rocks.reallocations, 3)
	for (let i = 0; i < 9; i++) {
		assert.equal(rocks.array[i * IMPOSTOR_INSTANCE_STRIDE], i, 'contents survive growth')
	}

	// Later frames with the same load keep the array.
	const array = rocks.array
	for (let frame = 0; frame < 5; frame++) {
		resetSceneryBuckets(buckets)
		appendNearSceneryInstances(buckets, instances, 0, 0, 0, 0, 0, 0, 100)
	}
	assert.equal(rocks.array, array)
	assert.equal(rocks.reallocations, 3)
	assert.equal(ensureSceneryBucketCapacity(rocks, 16), false)
})
