import {
	IMPOSTOR_INSTANCE_STRIDE,
	IMPOSTOR_TYPE_COUNT,
} from './impostors/impostorTypes.js'

// Pure rules for the near scenery meshes (src/impostors/sceneryMeshes.js).
// Inside a distance band around the eye each instance cross-fades from its
// impostor to its real mesh through a complementary screen-space dither; both
// shaders compute the same fade, so this file mirrors that formula and decides
// which instances need a mesh.

// Distance band from the eye to an instance's flat world base: fully the mesh
// below `start`, fully the impostor beyond `end`.
export const SCENERY_MESH_RANGES = Object.freeze({
	desktop: Object.freeze({ start: 110, end: 150 }),
	mobile: Object.freeze({ start: 60, end: 90 }),
})

// Extra selection distance beyond `end`, against float differences between the
// CPU and GPU distance.
export const SCENERY_MESH_SELECTION_MARGIN = 2

// Shader range while disabled: the fade is 0 at every distance.
export const SCENERY_MESH_DISABLED_RANGE = Object.freeze([-2, -1])

// Smallest band width; smoothstep() is undefined when start >= end.
export const SCENERY_MESH_MIN_BAND = 1

// Initial instances per type before the first buffer growth.
export const SCENERY_MESH_INITIAL_CAPACITY = 128

export function createSceneryMeshSettings({ isMobile = false } = {}) {
	const range = isMobile ? SCENERY_MESH_RANGES.mobile : SCENERY_MESH_RANGES.desktop
	return { enabled: true, start: range.start, end: range.end }
}

// [start, end] for the shader uniform, kept valid for smoothstep().
export function getSceneryMeshRange({ enabled, start, end }) {
	if (!enabled) return [...SCENERY_MESH_DISABLED_RANGE]
	const safeStart = Math.max(start, 0)
	return [safeStart, Math.max(end, safeStart + SCENERY_MESH_MIN_BAND)]
}

// 1 = only the mesh, 0 = only the impostor. Mirrors getSceneryMeshFade() in
// src/shaders/scenery-instance-pars-vertex.glsl.
export function getSceneryMeshFade(distance, start, end) {
	const t = Math.min(Math.max((distance - start) / (end - start), 0), 1)
	return 1 - t * t * (3 - 2 * t)
}

export function getSceneryMeshSelectionRadius(settings) {
	if (!settings.enabled) return 0
	return getSceneryMeshRange(settings)[1] + SCENERY_MESH_SELECTION_MARGIN
}

// True when a square chunk centered on (centerX, centerZ) can hold a base
// within `radius` of the eye. Horizontal distance never exceeds the 3D one, so
// the test is conservative.
export function chunkIntersectsSelection(
	centerX,
	centerZ,
	halfSize,
	eyeX,
	eyeZ,
	radius,
) {
	const dx = Math.max(Math.abs(eyeX - centerX) - halfSize, 0)
	const dz = Math.max(Math.abs(eyeZ - centerZ) - halfSize, 0)
	return dx * dx + dz * dz <= radius * radius
}

// One growable instance array per type, in the IMPOSTOR_INSTANCE_STRIDE layout
// with a world-space base.
export function createSceneryBuckets(
	capacity = SCENERY_MESH_INITIAL_CAPACITY,
	typeCount = IMPOSTOR_TYPE_COUNT,
) {
	return Array.from({ length: typeCount }, () => ({
		array: new Float32Array(capacity * IMPOSTOR_INSTANCE_STRIDE),
		count: 0,
		reallocations: 0,
	}))
}

export function resetSceneryBuckets(buckets) {
	for (const bucket of buckets) bucket.count = 0
}

// Doubles the array until it holds `count` instances, keeping its contents.
export function ensureSceneryBucketCapacity(bucket, count) {
	const needed = count * IMPOSTOR_INSTANCE_STRIDE
	if (bucket.array.length >= needed) return false
	let length = Math.max(bucket.array.length, IMPOSTOR_INSTANCE_STRIDE)
	while (length < needed) length *= 2
	const array = new Float32Array(length)
	array.set(bucket.array.subarray(0, bucket.count * IMPOSTOR_INSTANCE_STRIDE))
	bucket.array = array
	bucket.reallocations++
	return true
}

// Appends every instance of one chunk whose world base lies within `radius` of
// the eye and that `isVisible(type, x, y, z, scale, stretch)` accepts (pass
// null to skip culling). `instances` holds chunk-local bases; (originX,
// originY, originZ) is the chunk position. Returns the number appended.
export function appendNearSceneryInstances(
	buckets,
	instances,
	originX,
	originY,
	originZ,
	eyeX,
	eyeY,
	eyeZ,
	radius,
	isVisible = null,
) {
	const radiusSquared = radius * radius
	let appended = 0
	for (let i = 0; i < instances.length; i += IMPOSTOR_INSTANCE_STRIDE) {
		const x = instances[i] + originX
		const y = instances[i + 1] + originY
		const z = instances[i + 2] + originZ
		const dx = x - eyeX
		const dy = y - eyeY
		const dz = z - eyeZ
		if (dx * dx + dy * dy + dz * dz > radiusSquared) continue

		const type = Math.round(instances[i + 5])
		const bucket = buckets[type]
		if (!bucket) continue
		if (
			isVisible &&
			!isVisible(type, x, y, z, instances[i + 3], instances[i + 7])
		) {
			continue
		}

		ensureSceneryBucketCapacity(bucket, bucket.count + 1)
		const offset = bucket.count * IMPOSTOR_INSTANCE_STRIDE
		const target = bucket.array
		target[offset] = x
		target[offset + 1] = y
		target[offset + 2] = z
		for (let field = 3; field < IMPOSTOR_INSTANCE_STRIDE; field++) {
			target[offset + field] = instances[i + field]
		}
		bucket.count++
		appended++
	}
	return appended
}
