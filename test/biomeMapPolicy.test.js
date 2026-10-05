import assert from 'node:assert/strict'
import test from 'node:test'
import { BIOME_DEFAULTS } from '../src/biome.js'
import { createTerrainSnapshot, TERRAIN_DEFAULTS } from '../src/chunkGeometry.js'
import {
	BIOME_MAP_CATEGORY,
	BIOME_MAP_COLORS,
	BIOME_MAP_LABELS,
	BIOME_MAP_SPAN,
	BIOME_MAP_SUPERSAMPLE,
	classifyBiomeSample,
	getLandShares,
	getScaleLength,
	hasFollowMoved,
	mapToWorld,
	panView,
	rasterizeBiomeMap,
	worldToMap,
	zoomView,
} from '../src/debug/biomeMapPolicy.js'
import { createSeaIceSettings } from '../src/seaIcePolicy.js'

const view = { centerX: 1200, centerZ: -800, span: 10000 }
const close = (a, b) => Math.abs(a - b) < 1e-9

test('map and world coordinates round-trip, +X right and +Z down', () => {
	for (const [u, v] of [
		[0, 0],
		[0.5, 0.5],
		[0.25, 0.9],
	]) {
		const [x, z] = mapToWorld(view, u, v)
		const [backU, backV] = worldToMap(view, x, z)
		assert.ok(close(backU, u) && close(backV, v))
	}
	assert.deepEqual(mapToWorld(view, 0.5, 0.5), [1200, -800])
	assert.deepEqual(mapToWorld(view, 1, 1), [6200, 4200])
})

test('zooming keeps the world point under the pointer and clamps the span', () => {
	const zoomed = zoomView(view, 0.2, 0.7, 0.5)
	assert.equal(zoomed.span, 5000)
	const before = mapToWorld(view, 0.2, 0.7)
	const after = mapToWorld(zoomed, 0.2, 0.7)
	assert.ok(close(before[0], after[0]) && close(before[1], after[1]))
	assert.equal(zoomView(view, 0.5, 0.5, 1e-6).span, BIOME_MAP_SPAN.min)
	assert.equal(zoomView(view, 0.5, 0.5, 1e6).span, BIOME_MAP_SPAN.max)
})

test('panning drags the world with the pointer', () => {
	const panned = panView(view, 0.1, -0.2)
	// The point that was under the pointer is now 0.1 and -0.2 map units away.
	const [u, v] = worldToMap(panned, ...mapToWorld(view, 0.5, 0.5))
	assert.ok(close(u, 0.6) && close(v, 0.3))
	assert.equal(panned.span, view.span)
})

test('a followed view renders again after a few percent of its span', () => {
	assert.equal(hasFollowMoved(view, 1200 + 400, -800), false)
	assert.equal(hasFollowMoved(view, 1200 + 600, -800), true)
	assert.equal(hasFollowMoved(view, 1200, -800 - 600), true)
})

test('classifies the sea, the frozen sea, and every biome', () => {
	const seaIce = createSeaIceSettings()
	const inside = seaIce.fade * 2
	assert.equal(classifyBiomeSample(-20, { climate: 1, ice: -1 }, seaIce), BIOME_MAP_CATEGORY.SEA)
	assert.equal(
		classifyBiomeSample(-20, { climate: 1, ice: inside }, seaIce),
		BIOME_MAP_CATEGORY.SEA,
	)
	assert.equal(
		classifyBiomeSample(-1, { climate: 1, ice: inside }, seaIce),
		BIOME_MAP_CATEGORY.FROZEN_SEA,
	)
	assert.equal(classifyBiomeSample(5, { climate: 1, ice: -1 }, seaIce), BIOME_MAP_CATEGORY.FOREST)
	assert.equal(classifyBiomeSample(5, { climate: -1, ice: -1 }, seaIce), BIOME_MAP_CATEGORY.DESERT)
	assert.equal(classifyBiomeSample(5, { climate: 1, ice: 0.1 }, seaIce), BIOME_MAP_CATEGORY.ICE)
	assert.equal(BIOME_MAP_COLORS.length, BIOME_MAP_LABELS.length)
})

test('rasterizes a deterministic map with its category counts', () => {
	const request = {
		view: { centerX: 0, centerZ: 0, span: 30000 },
		size: 8,
		seed: 'ice194',
		params: createTerrainSnapshot(TERRAIN_DEFAULTS),
		seaIce: createSeaIceSettings(),
	}
	const first = rasterizeBiomeMap(request)
	assert.deepEqual(first, rasterizeBiomeMap(request))
	assert.equal(first.pixels.length, 8 * 8 * 4)
	// Every pixel averages its samples, opaque.
	assert.equal(
		first.counts.reduce((sum, count) => sum + count, 0),
		64 * BIOME_MAP_SUPERSAMPLE ** 2,
	)
	for (let offset = 0; offset < first.pixels.length; offset += 4) {
		assert.equal(first.pixels[offset + 3], 255)
	}
	// One sample per pixel side gives the flat colors.
	const flat = rasterizeBiomeMap({ ...request, size: 16 })
	assert.ok(flat.pixels.some((value, index) => index % 4 === 0 && value === BIOME_MAP_COLORS[0][0]))
	// This seed spawns in the ice.
	assert.ok(first.counts[BIOME_MAP_CATEGORY.ICE] > 0)
	// The distribution settings change the map.
	const lessIce = { ...request.params, biomes: { ...BIOME_DEFAULTS, iceThreshold: 2 } }
	assert.equal(rasterizeBiomeMap({ ...request, params: lessIce }).counts[BIOME_MAP_CATEGORY.ICE], 0)
})

test('land shares and scale lengths', () => {
	const counts = [10, 2, 6, 3, 1]
	assert.deepEqual(getLandShares(counts), { desert: 0.6, forest: 0.3, ice: 0.1 })
	assert.equal(getLandShares([5, 5, 0, 0, 0]), null)
	assert.equal(getScaleLength(13000), 10000)
	assert.equal(getScaleLength(4300), 2000)
	assert.equal(getScaleLength(600), 500)
})
