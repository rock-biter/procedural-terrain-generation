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
	SCENERY_MESH_LOD_COUNT,
	SCENERY_MESH_SELECTION_MARGIN,
	SCENERY_WIREFRAME_COLORS,
	appendNearSceneryInstances,
	chunkIntersectsSelection,
	createSceneryBuckets,
	createSceneryMeshSettings,
	createSceneryWireframeSettings,
	ensureSceneryBucketCapacity,
	getSceneryLodFade,
	getSceneryMeshFade,
	getSceneryMeshLodRange,
	getSceneryMeshRange,
	getSceneryMeshSelection,
	resetSceneryBuckets,
} from '../src/sceneryMeshPolicy.js'

// One instance in the placement layout: local base, scale, yaw, type, tint, stretch.
function instance(x, y, z, type, { scale = 1, yaw = 0.5, tint = 7, stretch = 1.1 } = {}) {
	return [x, y, z, scale, yaw, type, tint, stretch]
}

// Both levels with their selection windows and fresh buckets.
function createLevels(settings, capacity = 4) {
	return getSceneryMeshSelection(settings).map((window) => ({
		...window,
		buckets: createSceneryBuckets(capacity),
	}))
}

test('uses nearer bands on mobile and puts the LOD band inside the mesh range', () => {
	assert.deepEqual(createSceneryMeshSettings(), {
		enabled: true,
		...SCENERY_MESH_RANGES.desktop,
	})
	assert.deepEqual(createSceneryMeshSettings({ isMobile: true }), {
		enabled: true,
		...SCENERY_MESH_RANGES.mobile,
	})
	for (const range of Object.values(SCENERY_MESH_RANGES)) {
		assert.ok(range.lodStart < range.lodEnd)
		assert.ok(range.lodEnd <= range.start)
		assert.ok(range.start < range.end)
	}
	assert.ok(SCENERY_MESH_RANGES.mobile.end < SCENERY_MESH_RANGES.desktop.end)
})

test('wireframe starts off with a distinct color per mesh LOD and the impostor', () => {
	const settings = createSceneryWireframeSettings()
	assert.equal(settings.enabled, false)
	assert.equal(settings.meshColors.length, SCENERY_MESH_LOD_COUNT)
	const colors = [...settings.meshColors, settings.impostorColor]
	assert.equal(new Set(colors).size, colors.length)
	// Each call returns its own editable copy of the defaults.
	settings.meshColors[0] = 0
	assert.equal(createSceneryWireframeSettings().meshColors[0], SCENERY_WIREFRAME_COLORS.meshes[0])
})

test('fade is 1 inside the band start and 0 beyond its end', () => {
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
		previous = fade
	}
})

test('LOD 0, LOD 1, and the impostor split every pixel without overlap', () => {
	for (const settings of [
		createSceneryMeshSettings(),
		createSceneryMeshSettings({ isMobile: true }),
		// Overlapping bands are still a valid split.
		{ enabled: true, start: 100, end: 150, lodStart: 110, lodEnd: 140 },
	]) {
		const meshRange = getSceneryMeshRange(settings)
		const lodRange = getSceneryMeshLodRange(settings)
		for (let distance = 0; distance <= meshRange[1] + 10; distance += 0.5) {
			const mesh = getSceneryMeshFade(distance, ...meshRange)
			const lod = getSceneryLodFade(distance, meshRange, lodRange)
			assert.ok(lod >= 0 && lod <= mesh && mesh <= 1)
			// Shares of LOD 0, LOD 1, and the impostor sum to one.
			const shares = [lod, mesh - lod, 1 - mesh]
			assert.ok(shares.every((share) => share >= 0))
		}
	}

	const settings = createSceneryMeshSettings()
	const meshRange = getSceneryMeshRange(settings)
	const lodRange = getSceneryMeshLodRange(settings)
	assert.equal(getSceneryLodFade(settings.lodStart, meshRange, lodRange), 1)
	assert.equal(getSceneryLodFade(settings.lodEnd, meshRange, lodRange), 0)
})

test('a disabled range gives the impostor every distance', () => {
	const settings = { ...createSceneryMeshSettings(), enabled: false }
	const range = getSceneryMeshRange(settings)
	assert.deepEqual(range, [...SCENERY_MESH_DISABLED_RANGE])
	for (const distance of [0, 1, 50, 5000]) {
		assert.equal(getSceneryMeshFade(distance, ...range), 0)
	}
	for (const window of getSceneryMeshSelection(settings)) {
		assert.equal(window.maxRadius, 0)
	}
})

test('keeps the bands valid for smoothstep and the LOD band within the meshes', () => {
	assert.deepEqual(
		getSceneryMeshRange({ enabled: true, start: 120, end: 80 }),
		[120, 121],
	)
	assert.deepEqual(
		getSceneryMeshRange({ enabled: true, start: -5, end: 40 }),
		[0, 40],
	)
	assert.deepEqual(
		getSceneryMeshLodRange({ enabled: true, start: 100, end: 150, lodStart: 120, lodEnd: 400 }),
		[120, 150],
	)
	assert.deepEqual(
		getSceneryMeshLodRange({ enabled: true, start: 100, end: 150, lodStart: 200, lodEnd: 90 }),
		[89, 90],
	)
})

test('selection windows cover every distance a level can draw', () => {
	const settings = createSceneryMeshSettings()
	const meshRange = getSceneryMeshRange(settings)
	const lodRange = getSceneryMeshLodRange(settings)
	const [lod0, lod1] = getSceneryMeshSelection(settings)
	assert.equal(lod0.minRadius, 0)
	assert.equal(lod0.maxRadius, settings.lodEnd + SCENERY_MESH_SELECTION_MARGIN)
	assert.equal(lod1.minRadius, settings.lodStart - SCENERY_MESH_SELECTION_MARGIN)
	assert.equal(lod1.maxRadius, settings.end + SCENERY_MESH_SELECTION_MARGIN)

	for (let distance = 0; distance <= settings.end + 20; distance += 0.25) {
		const mesh = getSceneryMeshFade(distance, ...meshRange)
		const lod = getSceneryLodFade(distance, meshRange, lodRange)
		if (lod > 0) assert.ok(distance <= lod0.maxRadius, `LOD 0 at ${distance}`)
		if (mesh - lod > 0) {
			assert.ok(
				distance >= lod1.minRadius && distance <= lod1.maxRadius,
				`LOD 1 at ${distance}`,
			)
		}
	}
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

test('routes instances to each level by distance with world bases', () => {
	const levels = createLevels(createSceneryMeshSettings())
	const [lod0, lod1] = levels
	const instances = new Float32Array([
		// 50 units: LOD 0 only.
		...instance(50, 2, 0, IMPOSTOR_TYPE.ROUND_TREE, { scale: 1.2, tint: 99 }),
		// 130 units: inside the LOD band, both levels.
		...instance(0, 0, 130, IMPOSTOR_TYPE.BOULDER),
		// 250 units: LOD 1 only.
		...instance(-250, 0, 0, IMPOSTOR_TYPE.CONIFER),
		// 400 units: impostor only.
		...instance(400, 0, 0, IMPOSTOR_TYPE.ROUND_TREE),
	])
	const appended = appendNearSceneryInstances(
		levels,
		instances,
		1000,
		-2,
		2000,
		1000,
		0,
		2000,
	)
	assert.equal(appended, 4)
	assert.equal(lod0.buckets[IMPOSTOR_TYPE.ROUND_TREE].count, 1)
	assert.equal(lod0.buckets[IMPOSTOR_TYPE.BOULDER].count, 1)
	assert.equal(lod0.buckets[IMPOSTOR_TYPE.CONIFER].count, 0)
	assert.equal(lod1.buckets[IMPOSTOR_TYPE.ROUND_TREE].count, 0)
	assert.equal(lod1.buckets[IMPOSTOR_TYPE.BOULDER].count, 1)
	assert.equal(lod1.buckets[IMPOSTOR_TYPE.CONIFER].count, 1)

	assert.deepEqual(
		[...lod0.buckets[IMPOSTOR_TYPE.ROUND_TREE].array.subarray(0, IMPOSTOR_INSTANCE_STRIDE)],
		[1050, 0, 2000, Math.fround(1.2), 0.5, IMPOSTOR_TYPE.ROUND_TREE, 99, Math.fround(1.1)],
	)
	assert.deepEqual(
		[...lod1.buckets[IMPOSTOR_TYPE.CONIFER].array.subarray(0, 3)],
		[750, -2, 2000],
	)

	for (const level of levels) resetSceneryBuckets(level.buckets)
	assert.ok(levels.every((level) => level.buckets.every((bucket) => bucket.count === 0)))
})

test('uses the 3D eye distance and tests visibility once per instance', () => {
	const levels = createLevels(createSceneryMeshSettings())
	const instances = new Float32Array([
		...instance(0, 0, 0, IMPOSTOR_TYPE.CACTUS_ONE_ARM),
		...instance(130, 0, 0, IMPOSTOR_TYPE.CACTUS_TWO_ARMS),
	])
	// The eye is 400 units above the first base: outside every window.
	assert.equal(
		appendNearSceneryInstances(levels, instances, 0, 0, 0, 0, 400, 0),
		0,
	)

	const seen = []
	const appended = appendNearSceneryInstances(
		levels,
		instances,
		0,
		0,
		0,
		0,
		10,
		0,
		(type, x, y, z, scale, stretch) => {
			seen.push([type, x, y, z, scale, Math.fround(stretch)])
			return type === IMPOSTOR_TYPE.CACTUS_ONE_ARM
		},
	)
	assert.equal(appended, 1)
	assert.equal(levels[0].buckets[IMPOSTOR_TYPE.CACTUS_ONE_ARM].count, 1)
	assert.equal(levels[0].buckets[IMPOSTOR_TYPE.CACTUS_TWO_ARMS].count, 0)
	assert.equal(levels[1].buckets[IMPOSTOR_TYPE.CACTUS_TWO_ARMS].count, 0)
	// The second instance sits in both windows but is tested once.
	assert.deepEqual(seen, [
		[IMPOSTOR_TYPE.CACTUS_ONE_ARM, 0, 0, 0, 1, Math.fround(1.1)],
		[IMPOSTOR_TYPE.CACTUS_TWO_ARMS, 130, 0, 0, 1, Math.fround(1.1)],
	])
})

test('buckets grow by doubling and are reused across frames', () => {
	const levels = [{ minRadius: 0, maxRadius: 100, buckets: createSceneryBuckets(2) }]
	assert.equal(levels[0].buckets.length, IMPOSTOR_TYPE_COUNT)
	const values = []
	for (let i = 0; i < 9; i++) values.push(...instance(i, 0, 0, IMPOSTOR_TYPE.LAYERED_ROCK))
	const instances = new Float32Array(values)

	appendNearSceneryInstances(levels, instances, 0, 0, 0, 0, 0, 0)
	const rocks = levels[0].buckets[IMPOSTOR_TYPE.LAYERED_ROCK]
	assert.equal(rocks.count, 9)
	assert.equal(rocks.array.length, 16 * IMPOSTOR_INSTANCE_STRIDE)
	assert.equal(rocks.reallocations, 3)
	for (let i = 0; i < 9; i++) {
		assert.equal(rocks.array[i * IMPOSTOR_INSTANCE_STRIDE], i, 'contents survive growth')
	}

	// Later frames with the same load keep the array.
	const array = rocks.array
	for (let frame = 0; frame < 5; frame++) {
		resetSceneryBuckets(levels[0].buckets)
		appendNearSceneryInstances(levels, instances, 0, 0, 0, 0, 0, 0)
	}
	assert.equal(rocks.array, array)
	assert.equal(rocks.reallocations, 3)
	assert.equal(ensureSceneryBucketCapacity(rocks, 16), false)
})
