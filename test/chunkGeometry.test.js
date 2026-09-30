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

// Land region for this seed; sea chunks are flat and hide normal seams.
const land = { worldX: 264, worldZ: 264 }

test('produces identical normals along adjacent chunk edges', () => {
	const left = generate({ ...land })
	const right = generate({ ...land, worldX: land.worldX + 16 })
	const verticesPerEdge = 9

	for (let row = 0; row < verticesPerEdge; row++) {
		const leftIndex = (row * verticesPerEdge + verticesPerEdge - 1) * 3
		const rightIndex = row * verticesPerEdge * 3
		for (let axis = 0; axis < 3; axis++) {
			assert.equal(left.normal[leftIndex + axis], right.normal[rightIndex + axis])
		}
	}
})

test('produces identical normals for shared vertices across LODs', () => {
	const fine = generate({ ...land, LOD: 0 })
	const coarse = generate({ ...land, LOD: 1, worldX: land.worldX + 16 })
	const fineVertices = 9
	const coarseVertices = 5

	// Fine right edge and coarse left edge share every other fine vertex.
	for (let row = 0; row < coarseVertices; row++) {
		const fineIndex = (row * 2 * fineVertices + fineVertices - 1) * 3
		const coarseIndex = row * coarseVertices * 3
		for (let axis = 0; axis < 3; axis++) {
			assert.equal(fine.normal[fineIndex + axis], coarse.normal[coarseIndex + axis])
		}
	}
})

test('produces unit upward-facing normals', () => {
	const { normal } = generate({ ...land })

	for (let index = 0; index < normal.length; index += 3) {
		const length = Math.hypot(normal[index], normal[index + 1], normal[index + 2])
		assert.ok(Math.abs(length - 1) < 1e-6)
		assert.ok(normal[index + 1] > 0)
	}
})
