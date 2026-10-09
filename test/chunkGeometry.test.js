import assert from 'node:assert/strict'
import test from 'node:test'
import { createBiomeOffset, getBiomeFields } from '../src/biome.js'
import { COAST_RELIEF_WINDOW } from '../src/coast.js'
import { PlaneGeometry } from 'three'
import {
	DESERT_TERRAIN_DEFAULTS,
	ICE_TERRAIN_DEFAULTS,
	TERRAIN_DEFAULTS,
	createChunkIndex,
	createChunkUv,
	createTerrainNoises,
	createTerrainSettings,
	createTerrainSnapshot,
	generateChunkGeometryData,
	getDesertFlattening,
	getDesertWeight,
	getHeight,
	getIceFlattening,
	getIceWeight,
	getSurfaceNormal,
} from '../src/chunkGeometry.js'
import {
	createChunkGeometry,
	disposeChunkGeometry,
	getChunkTopology,
} from '../src/chunkTopology.js'

// The production terrain.
const params = TERRAIN_DEFAULTS
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

const plainIce = { ...ICE_TERRAIN_DEFAULTS, frequency: 1, amplitude: 1, flatten: 0, peakChance: 0 }

// Height before per-biome topography: every octave unscaled, no flattening,
// no ice mountains.
function getTemperateHeight(x, z) {
	return getHeight(x, z, noises, { ...params, desert: plainDesert, ice: plainIce }, biomeOffset)
}

function getFields(x, z) {
	return getBiomeFields(x, z, biomeOffset, params.biomes)
}

// The effective climate (forest ring included), which the desert follows.
function getValue(x, z) {
	return getFields(x, z).climate
}

function getIce(x, z) {
	return getFields(x, z).ice
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

test('keeps temperate heights unchanged away from the biome borders', () => {
	const temperate = (x, z) =>
		getValue(x, z) > DESERT_TERRAIN_DEFAULTS.blend && getIce(x, z) < -ICE_TERRAIN_DEFAULTS.blend
	for (const [x, z] of findPoints(temperate, 50)) {
		assert.equal(getDesertWeight(getValue(x, z), params), 0)
		assert.equal(getIceWeight(getIce(x, z), params), 0)
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

test('reshapes the detail octaves inside the ice', () => {
	const unflattened = { ...params, ice: { ...ICE_TERRAIN_DEFAULTS, flatten: 0, peakChance: 0 } }
	const ice = (x, z) => getIce(x, z) > ICE_TERRAIN_DEFAULTS.blend
	let changed = false
	for (const [x, z] of findPoints(ice, 50)) {
		assert.equal(getIceWeight(getIce(x, z), params), 1)
		// The forest ring keeps the desert and its flattening away.
		assert.equal(getDesertWeight(getValue(x, z), params), 0)
		assert.equal(getDesertFlattening(getValue(x, z), params), 0)
		const height = getHeight(x, z, noises, unflattened, biomeOffset)
		if (Math.abs(height - getTemperateHeight(x, z)) > 1e-3) changed = true
	}
	assert.ok(changed)
})

test('flattens ice land progressively with depth into the biome', () => {
	const { flatten, depth } = ICE_TERRAIN_DEFAULTS
	assert.equal(getIceFlattening(-0.1, params), 0)
	assert.equal(getIceFlattening(0, params), 0)
	assert.equal(getIceFlattening(depth, params), flatten)
	assert.equal(getIceFlattening(depth * 2, params), flatten)
	let previous = 0
	for (let value = 0; value <= depth; value += depth / 40) {
		const flattening = getIceFlattening(value, params)
		assert.ok(flattening >= previous)
		previous = flattening
	}

	// Deep inside the ice, without its mountains, land is exactly
	// (1 - flatten) of the unflattened ice height; sea keeps its depth, so
	// coastlines and the frozen sea do not move.
	const plain = { ...params, ice: { ...ICE_TERRAIN_DEFAULTS, peakChance: 0 } }
	const unflattened = { ...params, ice: { ...ICE_TERRAIN_DEFAULTS, flatten: 0, peakChance: 0 } }
	const deep = (x, z) => getIce(x, z) > depth
	let land = 0
	for (const [x, z] of findPoints(deep, 50)) {
		const raw = getHeight(x, z, noises, unflattened, biomeOffset)
		const height = getHeight(x, z, noises, plain, biomeOffset)
		if (raw > 0) {
			land++
			assert.ok(Math.abs(height - raw * (1 - flatten)) < 1e-9)
		} else {
			assert.equal(height, raw)
		}
	}
	assert.ok(land > 0)
})

test('raises sparse ice mountains from the land, no higher than peakHeight', () => {
	const { peakHeight } = ICE_TERRAIN_DEFAULTS
	const plain = { ...params, ice: { ...ICE_TERRAIN_DEFAULTS, peakChance: 0 } }
	const points = findPoints((x, z) => getIce(x, z) > 0, 2000)
	let raised = 0
	for (const [x, z] of points) {
		const flat = getHeight(x, z, noises, plain, biomeOffset)
		const height = getHeight(x, z, noises, params, biomeOffset)
		assert.ok(height >= flat)
		assert.ok(height <= Math.max(flat, peakHeight))
		// No mountain rises from the sea.
		if (flat <= 0) assert.equal(height, flat)
		if (height > flat) raised++
	}
	assert.ok(raised > 0)
	assert.ok(raised < points.length * 0.15, `${raised} of ${points.length} raised`)
})

test('blends ice and temperate heights continuously across the ice border', () => {
	const [[x0, z0]] = findPoints((x, z) => Math.abs(getIce(x, z)) < 0.001, 1)
	let previous = getHeight(x0 - 200, z0, noises, params, biomeOffset)
	for (let step = 1; step <= 4000; step++) {
		const x = x0 - 200 + step * 0.1
		const height = getHeight(x, z0, noises, params, biomeOffset)
		assert.ok(Math.abs(height - previous) < 0.5, `jump at x=${x}`)
		previous = height
	}
})

test('snapshots every terrain parameter, detached from the source', () => {
	const settings = createTerrainSettings()
	const snapshot = createTerrainSnapshot(settings)
	assert.deepEqual(Object.keys(snapshot).sort(), Object.keys(TERRAIN_DEFAULTS).sort())
	assert.deepEqual(snapshot, settings)
	settings.frequency.x = 9
	settings.biomes.size = 9
	settings.desert.flatten = 9
	settings.ice.amplitude = 9
	settings.coast.mask.threshold = 9
	assert.deepEqual(snapshot, createTerrainSnapshot(TERRAIN_DEFAULTS))
})

test('raises rocky coasts only around the waterline', () => {
	const flat = { ...params, coast: { ...params.coast, amplitude: 0 } }
	let raised = 0
	for (let index = 0; index < 4000; index++) {
		const x = ((index * 7919) % 20000) - 10000
		const z = ((index * 104729) % 20000) - 10000
		const height = getHeight(x, z, noises, params, biomeOffset)
		const withoutRelief = getHeight(x, z, noises, flat, biomeOffset)
		assert.ok(height >= withoutRelief)
		if (withoutRelief <= COAST_RELIEF_WINDOW.min || withoutRelief >= COAST_RELIEF_WINDOW.max) {
			assert.equal(height, withoutRelief)
		}
		if (height > withoutRelief) raised++
	}
	assert.ok(raised > 0)
})

test('samples a single octave with the same landmass noises', () => {
	const single = createTerrainNoises('geometry-test', 1)
	const triple = createTerrainNoises('geometry-test', 3)
	assert.equal(single.length, 2)
	for (const [x, z] of [
		[0, 0],
		[513.5, -270.25],
		[-4096, 1024],
	]) {
		assert.equal(single[0](x, z), triple[0](x, z))
		assert.equal(single[1](x, z), triple[1](x, z))
	}
	const oneOctave = { ...params, octaves: 1 }
	assert.ok(Number.isFinite(getHeight(120, -80, single, oneOctave, biomeOffset)))
	assert.doesNotThrow(() => generate({ params: oneOctave }))
})

test('builds the same grid as a PlaneGeometry rotated flat', () => {
	const data = generate()
	const plane = new PlaneGeometry(16, 16, data.segments, data.segments)
	plane.rotateX(-Math.PI * 0.5)
	const planePosition = plane.getAttribute('position')

	assert.deepEqual(createChunkIndex(data.segments), plane.getIndex().array)
	assert.deepEqual(createChunkUv(data.segments), plane.getAttribute('uv').array)
	for (let index = 0; index < planePosition.count; index++) {
		assert.equal(data.position[index * 3], planePosition.getX(index))
		assert.equal(data.position[index * 3 + 2], planePosition.getZ(index))
	}
})

test('reuses shared normal samples without changing any normal', () => {
	// Desktop LOD 0: the grid step is twice NORMAL_EPSILON, so samples are shared.
	const request = { size: 32, LOD: 0, density: 2, worldX: 272, worldZ: 280 }
	const data = generate(request)
	const normal = [0, 0, 0]
	const columns = data.segments + 1
	for (let row = 0; row < columns; row++) {
		for (let column = 0; column < columns; column++) {
			const index = row * columns + column
			getSurfaceNormal(
				data.position[index * 3] + request.worldX,
				data.position[index * 3 + 2] + request.worldZ,
				noises,
				params,
				biomeOffset,
				normal,
			)
			for (let axis = 0; axis < 3; axis++) {
				assert.equal(data.normal[index * 3 + axis], Math.fround(normal[axis]))
			}
		}
	}
})

test('encloses every vertex in the bounding sphere', () => {
	const data = generate({ ...land })
	const { centerY, radius } = data.boundingSphere
	for (let index = 0; index < data.position.length; index += 3) {
		const distance = Math.hypot(
			data.position[index],
			data.position[index + 1] - centerY,
			data.position[index + 2],
		)
		assert.ok(distance <= radius + 1e-4)
	}
})

test('shares index and uv per LOD and keeps them when a chunk is disposed', () => {
	const first = createChunkGeometry(generate())
	const second = createChunkGeometry(generate({ worldX: 24 }))
	const { index, uv } = getChunkTopology(generate().segments)

	assert.equal(first.getIndex(), second.getIndex())
	assert.equal(first.getAttribute('uv'), second.getAttribute('uv'))
	assert.equal(first.getIndex(), index)
	assert.equal(first.getAttribute('uv'), uv)
	assert.ok(first.boundingSphere)

	disposeChunkGeometry(first)
	assert.equal(first.getIndex(), null)
	assert.equal(first.getAttribute('uv'), undefined)
	assert.equal(second.getIndex(), index)
	assert.ok(index.array.length > 0)
})
