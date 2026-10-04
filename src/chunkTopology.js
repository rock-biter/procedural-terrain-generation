import { BufferAttribute, BufferGeometry, Sphere, Vector3 } from 'three'
import { createChunkIndex, createChunkUv } from './chunkGeometry.js'

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
	return geometry
}

// Disposing a geometry deletes the GL buffers of every attached attribute, so
// the shared index and uv are detached first.
export function disposeChunkGeometry(geometry) {
	geometry.setIndex(null)
	geometry.deleteAttribute('uv')
	geometry.dispose()
}
