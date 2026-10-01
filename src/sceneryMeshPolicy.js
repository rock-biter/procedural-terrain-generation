import {
	IMPOSTOR_INSTANCE_STRIDE,
	IMPOSTOR_TYPE_COUNT,
} from './impostors/impostorTypes.js'

// Pure rules for the near scenery meshes (src/impostors/sceneryMeshes.js).
// Near the eye each instance is a real mesh in two levels of detail: LOD 0
// (the baked source geometry) closest, LOD 1 (reduced geometry) farther out,
// then the impostor. Every hand-over is a complementary screen-space dither
// driven by the same per-pixel noise, so the shaders mirror the fades below
// and this file decides which instances each level must draw.

// Distances from the eye to an instance's flat world base:
// - `start → end`: LOD 1 mesh to impostor (mesh only below `start`, impostor
//   only beyond `end`);
// - `lodStart → lodEnd`: LOD 0 to LOD 1.
export const SCENERY_MESH_RANGES = Object.freeze({
	desktop: Object.freeze({ start: 220, end: 300, lodStart: 110, lodEnd: 150 }),
	mobile: Object.freeze({ start: 120, end: 180, lodStart: 60, lodEnd: 90 }),
})

export const SCENERY_MESH_LOD_COUNT = 2

// Extra selection distance around each band, against float differences
// between the CPU and GPU distance.
export const SCENERY_MESH_SELECTION_MARGIN = 2

// Shader range while disabled: the fade is 0 at every distance.
export const SCENERY_MESH_DISABLED_RANGE = Object.freeze([-2, -1])

// Smallest band width; smoothstep() is undefined when start >= end.
export const SCENERY_MESH_MIN_BAND = 1

// Initial instances per type before the first buffer growth.
export const SCENERY_MESH_INITIAL_CAPACITY = 128

export function createSceneryMeshSettings({ isMobile = false } = {}) {
	const range = isMobile ? SCENERY_MESH_RANGES.mobile : SCENERY_MESH_RANGES.desktop
	return { enabled: true, ...range }
}

// [start, end] of the impostor band for the shader uniform, kept valid for
// smoothstep().
export function getSceneryMeshRange({ enabled, start, end }) {
	if (!enabled) return [...SCENERY_MESH_DISABLED_RANGE]
	const safeStart = Math.max(start, 0)
	return [safeStart, Math.max(end, safeStart + SCENERY_MESH_MIN_BAND)]
}

// [lodStart, lodEnd] of the LOD band, kept inside the impostor band's end so
// LOD 0 is never selected beyond the meshes' reach.
export function getSceneryMeshLodRange(settings) {
	if (!settings.enabled) return [...SCENERY_MESH_DISABLED_RANGE]
	const meshEnd = getSceneryMeshRange(settings)[1]
	const lodEnd = Math.min(
		Math.max(settings.lodEnd, SCENERY_MESH_MIN_BAND),
		meshEnd,
	)
	const lodStart = Math.min(
		Math.max(settings.lodStart, 0),
		lodEnd - SCENERY_MESH_MIN_BAND,
	)
	return [lodStart, lodEnd]
}

// 1 - smoothstep(start, end, distance). For the impostor band: 1 = mesh only,
// 0 = impostor only. Mirrors getSceneryMeshFade() in
// src/shaders/scenery-instance-pars-vertex.glsl.
export function getSceneryMeshFade(distance, start, end) {
	const t = Math.min(Math.max((distance - start) / (end - start), 0), 1)
	return 1 - t * t * (3 - 2 * t)
}

// Share of pixels drawn by LOD 0; never above the mesh share, so the pixel
// noise splits into [0, lod) LOD 0, [lod, mesh) LOD 1, [mesh, 1) impostor.
// Mirrors scenery-mesh-normal-vertex.glsl.
export function getSceneryLodFade(distance, meshRange, lodRange) {
	return Math.min(
		getSceneryMeshFade(distance, ...lodRange),
		getSceneryMeshFade(distance, ...meshRange),
	)
}

// Distance window per level: [minRadius, maxRadius]. LOD 0 covers its band's
// end; LOD 1 spans from its band's start to the impostor band's end.
export function getSceneryMeshSelection(settings) {
	if (!settings.enabled) {
		return [
			{ minRadius: 0, maxRadius: 0 },
			{ minRadius: 0, maxRadius: 0 },
		]
	}
	const [, meshEnd] = getSceneryMeshRange(settings)
	const [lodStart, lodEnd] = getSceneryMeshLodRange(settings)
	return [
		{ minRadius: 0, maxRadius: lodEnd + SCENERY_MESH_SELECTION_MARGIN },
		{
			minRadius: Math.max(lodStart - SCENERY_MESH_SELECTION_MARGIN, 0),
			maxRadius: meshEnd + SCENERY_MESH_SELECTION_MARGIN,
		},
	]
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

function appendInstance(bucket, instances, i, x, y, z) {
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
}

// Appends every instance of one chunk to each level ({ buckets, minRadius,
// maxRadius }) whose distance window holds its world base, when
// `isVisible(type, x, y, z, scale, stretch)` accepts it (pass null to skip
// culling; it runs at most once per instance). `instances` holds chunk-local
// bases; (originX, originY, originZ) is the chunk position. Returns the number
// of appends over all levels.
export function appendNearSceneryInstances(
	levels,
	instances,
	originX,
	originY,
	originZ,
	eyeX,
	eyeY,
	eyeZ,
	isVisible = null,
) {
	let outerRadius = 0
	for (const level of levels) outerRadius = Math.max(outerRadius, level.maxRadius)
	const outerSquared = outerRadius * outerRadius
	let appended = 0

	for (let i = 0; i < instances.length; i += IMPOSTOR_INSTANCE_STRIDE) {
		const x = instances[i] + originX
		const y = instances[i + 1] + originY
		const z = instances[i + 2] + originZ
		const dx = x - eyeX
		const dy = y - eyeY
		const dz = z - eyeZ
		const distanceSquared = dx * dx + dy * dy + dz * dz
		if (distanceSquared > outerSquared) continue

		const type = Math.round(instances[i + 5])
		let visible = null
		for (const level of levels) {
			const bucket = level.buckets[type]
			if (!bucket) continue
			if (distanceSquared > level.maxRadius * level.maxRadius) continue
			if (distanceSquared < level.minRadius * level.minRadius) continue
			if (visible === null) {
				visible =
					!isVisible ||
					isVisible(type, x, y, z, instances[i + 3], instances[i + 7])
			}
			if (!visible) break
			appendInstance(bucket, instances, i, x, y, z)
			appended++
		}
	}
	return appended
}
