import assert from 'node:assert/strict'
import test from 'node:test'
import { createBiomeOffset, getBiomeValue } from '../src/biome.js'
import {
	DESERT_TERRAIN_DEFAULTS,
	createChunkGeometry,
	createTerrainNoises,
	generateChunkGeometryData,
	getDesertFlattening,
	getDesertWeight,
	getHeight,
} from '../src/chunkGeometry.js'

const params = {
	amplitude: 23,
	frequency: { x: 0.5, z: 0.5 },
	octaves: 3,
	lacunarity: 2,
	persistance: 0.5,
	desert: DESERT_TERRAIN_DEFAULTS,
}
const biomeOffset = createBiomeOffset('geometry-test')

function generate(overrides = {}) {
	return generateChunkGeometryData({
		size: 16,
		LOD: 0,
		density: 2,
		worldX: 8,
		worldZ: 8,
		params,
		seed: 'geometry-test',
		biomeOffset,
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

const noises = createTerrainNoises('geometry-test', params.octaves)
const plainDesert = { ...DESERT_TERRAIN_DEFAULTS, frequency: 1, amplitude: 1, flatten: 0 }

// Height before per-biome topography: every octave unscaled, no flattening.
function getTemperateHeight(x, z) {
	return getHeight(x, z, noises, { ...params, desert: plainDesert }, biomeOffset)
}

function getValue(x, z) {
	return getBiomeValue(x, z, biomeOffset)
}

function findPoints(predicate, count) {
	const points = []
	for (let index = 0; points.length < count && index < 200000; index++) {
		const x = ((index * 7919) % 80000) - 40000
		const z = ((index * 104729) % 80000) - 40000
		if (predicate(x, z)) points.push([x, z])
	}
	assert.equal(points.length, count)
	return points
}

test('keeps temperate heights unchanged away from the biome border', () => {
	const temperate = (x, z) => getValue(x, z) > DESERT_TERRAIN_DEFAULTS.blend
	for (const [x, z] of findPoints(temperate, 50)) {
		assert.equal(getDesertWeight(getValue(x, z), params), 0)
		assert.equal(getDesertFlattening(getValue(x, z), params), 0)
		const height = getHeight(x, z, noises, params, biomeOffset)
		assert.ok(Math.abs(height - getTemperateHeight(x, z)) < 1e-9)
	}
})

test('flattens desert land progressively with depth into the biome', () => {
	const { flatten, depth } = DESERT_TERRAIN_DEFAULTS
	assert.equal(getDesertFlattening(0, params), 0)
	assert.equal(getDesertFlattening(-depth, params), flatten)
	assert.equal(getDesertFlattening(-depth * 2, params), flatten)
	let previous = 0
	for (let value = 0; value >= -depth; value -= depth / 40) {
		const flattening = getDesertFlattening(value, params)
		assert.ok(flattening >= previous)
		previous = flattening
	}

	// Deep inside the desert, land is exactly (1 - flatten) of the unflattened
	// desert height; sea keeps its depth, so coastlines do not move.
	const unflattened = { ...params, desert: { ...DESERT_TERRAIN_DEFAULTS, flatten: 0 } }
	const deep = (x, z) => getValue(x, z) < -depth
	let land = 0
	for (const [x, z] of findPoints(deep, 50)) {
		const raw = getHeight(x, z, noises, unflattened, biomeOffset)
		const height = getHeight(x, z, noises, params, biomeOffset)
		if (raw > 0) {
			land++
			assert.ok(Math.abs(height - raw * (1 - flatten)) < 1e-9)
		} else {
			assert.equal(height, raw)
		}
	}
	assert.ok(land > 0)
})

test('reshapes the detail octaves inside the desert', () => {
	const unflattened = { ...params, desert: { ...DESERT_TERRAIN_DEFAULTS, flatten: 0 } }
	const desert = (x, z) => getValue(x, z) < -DESERT_TERRAIN_DEFAULTS.blend
	let changed = false
	for (const [x, z] of findPoints(desert, 50)) {
		assert.equal(getDesertWeight(getValue(x, z), params), 1)
		const height = getHeight(x, z, noises, unflattened, biomeOffset)
		if (Math.abs(height - getTemperateHeight(x, z)) > 1e-3) changed = true
	}
	assert.ok(changed)
})

test('blends desert and temperate heights continuously across the border', () => {
	const [[x0, z0]] = findPoints((x, z) => Math.abs(getValue(x, z)) < 0.01, 1)
	let previous = getHeight(x0 - 200, z0, noises, params, biomeOffset)
	for (let step = 1; step <= 4000; step++) {
		const x = x0 - 200 + step * 0.1
		const height = getHeight(x, z0, noises, params, biomeOffset)
		// Terrain slopes stay well below 5 units per unit; a jump would exceed it.
		assert.ok(Math.abs(height - previous) < 0.5, `jump at x=${x}`)
		previous = height
	}
})

test('samples a single octave with the same landmass noises', () => {
	const single = createTerrainNoises('geometry-test', 1)
	const triple = createTerrainNoises('geometry-test', 3)
	assert.equal(single.length, 2)
	for (const [x, z] of [[0, 0], [513.5, -270.25], [-4096, 1024]]) {
		assert.equal(single[0](x, z), triple[0](x, z))
		assert.equal(single[1](x, z), triple[1](x, z))
	}
	const oneOctave = { ...params, octaves: 1 }
	assert.ok(Number.isFinite(getHeight(120, -80, single, oneOctave, biomeOffset)))
	assert.doesNotThrow(() => generate({ params: oneOctave }))
})
