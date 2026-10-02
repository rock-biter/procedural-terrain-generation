import assert from 'node:assert/strict'
import test from 'node:test'
import { getPropellerMask } from '../src/propellerMask.js'

test('marks whole components that reach beyond the threshold', () => {
	// Component A: triangles 0-1-2 and 2-1-3, one vertex beyond z = 1.
	// Component B: triangle 4-5-6, all behind. Vertex 7 is unused.
	const z = [0, 0.2, 0.5, 1.5, 0.9, 0.95, 0.99, 3]
	const index = [0, 1, 2, 2, 1, 3, 4, 5, 6]
	assert.deepEqual([...getPropellerMask(z, index, 1)], [1, 1, 1, 1, 0, 0, 0, 1])
})

test('components touching only at equal positions stay separate', () => {
	// Duplicated seam vertices (2 and 3 share a position) keep charts apart.
	const z = [2, 2, 0.5, 0.5, 0, 0]
	const index = [0, 1, 2, 3, 4, 5]
	assert.deepEqual([...getPropellerMask(z, index, 1)], [1, 1, 1, 0, 0, 0])
})

test('nothing is marked when no vertex passes the threshold', () => {
	assert.deepEqual([...getPropellerMask([0, 0, 0], [0, 1, 2], 1)], [0, 0, 0])
})
