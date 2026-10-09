import { BufferAttribute, BufferGeometry, Sphere, Vector3 } from 'three'
import { createChunkIndex, createChunkShadowIndex, createChunkUv } from './chunkGeometry.js'

// Index and uv depend only on the segment count, so every chunk at one LOD
// shares the same two attributes, uploaded once. They are never disposed:
// disposeChunkGeometry() detaches them before disposing a chunk geometry.
const topologies = new Map()

export function getChunkTopology(segments) {
	let topology = topologies.get(segments)
	if (!topology) {
		topology = {
			index: new BufferAttribute(createChunkIndex(segments), 1),
			uv: new BufferAttribute(createChunkUv(segments), 2),
		}
		topologies.set(segments, topology)
	}
	return topology
}

// Shadow-caster indices (createChunkShadowIndex()), shared like the topology
// and never disposed. Keyed by segment counts and edge factors.
const shadowIndices = new Map()

export function getChunkShadowIndex(segments, shadowSegments, edgeFactors = [1, 1, 1, 1]) {
	const [back, front, left, right] = edgeFactors
	if (segments === shadowSegments && back === 1 && front === 1 && left === 1 && right === 1) {
		return getChunkTopology(segments).index
	}
	const key = `${segments}:${shadowSegments}:${back},${front},${left},${right}`
	let index = shadowIndices.get(key)
	if (!index) {
		index = new BufferAttribute(createChunkShadowIndex(segments, shadowSegments, edgeFactors), 1)
		shadowIndices.set(key, index)
	}
	return index
}

// Nothing reads chunk vertices on the CPU once they are on the GPU (frustum
// culling uses the precomputed bounding sphere, heights come from the noise),
// so each per-chunk array is freed after its upload.
function releaseArray() {
	this.array = null
}

// Wraps the worker buffers of generateChunkGeometryData() without copying.
export function createChunkGeometry(data) {
	const geometry = new BufferGeometry()
	const { index, uv } = getChunkTopology(data.segments)
	geometry.setIndex(index)
	geometry.setAttribute('uv', uv)
	geometry.setAttribute('position', new BufferAttribute(data.position, 3).onUpload(releaseArray))
	geometry.setAttribute('normal', new BufferAttribute(data.normal, 3).onUpload(releaseArray))
	geometry.setAttribute('height', new BufferAttribute(data.height, 1).onUpload(releaseArray))
	const { centerY, radius } = data.boundingSphere
	geometry.boundingSphere = new Sphere(new Vector3(0, centerY, 0), radius)
	geometry.userData.segments = data.segments
	geometry.userData.maxSlope = data.maxSlope
	return geometry
}

// Shadow views of each chunk geometry, by cascade (src/sceneryShadows.js).
// A view shares the geometry's position attribute, so one GL buffer serves
// both, and draws it with a shadow index; the caller sets that index. One view
// per cascade keeps each view's index, and so its vertex array state, stable
// across the cascades' renders.
const shadowViews = new WeakMap()

export function getChunkShadowView(geometry, cascade) {
	let views = shadowViews.get(geometry)
	if (!views) {
		views = []
		shadowViews.set(geometry, views)
	}
	let view = views[cascade]
	if (!view) {
		view = new BufferGeometry()
		view.setAttribute('position', geometry.getAttribute('position'))
		// Required: the position array is freed after its upload, so the
		// renderer could not compute a sphere.
		view.boundingSphere = geometry.boundingSphere.clone()
		views[cascade] = view
	}
	return view
}

// Disposing a geometry deletes the GL buffers of every attached attribute, so
// the shared index and uv are detached first. The shadow views go first, with
// their borrowed position and shared index detached, so they free only their
// own vertex array state and are never drawn after their geometry.
export function disposeChunkGeometry(geometry) {
	const views = shadowViews.get(geometry)
	if (views) {
		for (const view of views) {
			if (!view) continue
			view.setIndex(null)
			view.deleteAttribute('position')
			view.dispose()
		}
		shadowViews.delete(geometry)
	}
	geometry.setIndex(null)
	geometry.deleteAttribute('uv')
	geometry.dispose()
}
