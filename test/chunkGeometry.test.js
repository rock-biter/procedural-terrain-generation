import assert from 'node:assert/strict'
import test from 'node:test'
import {
	createChunkGeometry,
	generateChunkGeometryData,
} from '../src/chunkGeometry.js'

const params = {
	amplitude: 23,
	frequency: { x: 0.5, z: 0.5 },
	octaves: 3,
	lacunarity: 2,
	persistance: 0.5,
}

function generate(overrides = {}) {
	return generateChunkGeometryData({
		size: 16,
		LOD: 0,
		density: 2,
		worldX: 8,
		worldZ: 8,
		params,
		seed: 'geometry-test',
		...overrides,
	})
}

test('generates deterministic transferable terrain buffers', () => {
	const first = generate()
	const second = generate()

	assert.deepEqual(first.position, second.position)
	assert.deepEqual(first.normal, second.normal)
	assert.deepEqual(first.height, second.height)
	assert.deepEqual(first.index, second.index)
	assert.notDeepEqual(first.height, generate({ seed: 'other-seed' }).height)
})

test('preserves plane topology, raw height, and visible sea clamp', () => {
	const data = generate()
	const geometry = createChunkGeometry(data)

	assert.equal(geometry.getAttribute('position').count, 81)
	assert.equal(geometry.getIndex().count, 384)

	const positions = geometry.getAttribute('position')
	const heights = geometry.getAttribute('height')
	for (let index = 0; index < positions.count; index++) {
		assert.equal(positions.getY(index), Math.max(heights.getX(index), -1))
	}
})

test('produces identical heights along adjacent chunk edges', () => {
	const left = generate({ worldX: 8 })
	const right = generate({ worldX: 24 })
	const verticesPerEdge = 9

	for (let row = 0; row < verticesPerEdge; row++) {
		const leftIndex = row * verticesPerEdge + verticesPerEdge - 1
		const rightIndex = row * verticesPerEdge
		assert.equal(left.height[leftIndex], right.height[rightIndex])
	}
})
