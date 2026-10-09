import { createBiomeOffset, getBiome, BIOME } from '../biome.js'
import { createTerrainNoises, getHeight } from '../chunkGeometry.js'
import { isUnderSeaIce } from '../seaIcePolicy.js'
import { SAND_LEVEL } from '../terrainBands.js'

// The ?gui=1 biome map (three-free, so its worker and the tests import it): a
// top-down square of the world around a center, one flat color per biome,
// the sea, the frozen sea, and the deep ocean with its islets, sampled with the same getHeight() and biome
// fields as the chunks (src/biome.js, src/seaIcePolicy.js). src/debug/biomeMap.js
// draws it and src/debug/biomeMap.worker.js rasterizes it.
//
// A view is { centerX, centerZ, span }: the world point at the middle of the
// map and the world width the square covers. The map is turned like the chase
// camera's first view, so the airplane's start heading points up: +Z up and +X
// to the left (seen from above, not mirrored).

export const BIOME_MAP_CATEGORY = Object.freeze({
	SEA: 0,
	FROZEN_SEA: 1,
	DESERT: 2,
	FOREST: 3,
	ICE: 4,
	DEEP_OCEAN: 5,
	ISLETS: 6,
})

// Flat sRGB colors and legend labels, indexed by category.
export const BIOME_MAP_COLORS = Object.freeze([
	Object.freeze([38, 84, 156]),
	Object.freeze([64, 190, 214]),
	Object.freeze([226, 178, 96]),
	Object.freeze([70, 132, 58]),
	Object.freeze([244, 248, 252]),
	Object.freeze([10, 34, 78]),
	Object.freeze([150, 214, 96]),
])
export const BIOME_MAP_LABELS = Object.freeze([
	'Sea',
	'Frozen sea',
	'Desert',
	'Forest',
	'Ice',
	'Deep ocean',
	'Islets',
])

// World width of the map, in units: from one archipelago to the scale of the
// ice. It starts close enough to show the deep ocean's islets (a few pixels
// each).
export const BIOME_MAP_SPAN = Object.freeze({ min: 200, max: 400000, initial: 5000 })

// A followed view renders again once its center moved this share of the span.
export const BIOME_MAP_FOLLOW_STEP = 0.05

export function clampSpan(span) {
	return Math.min(Math.max(span, BIOME_MAP_SPAN.min), BIOME_MAP_SPAN.max)
}

// World point at map coordinates (u, v), each 0 to 1 from the top left.
export function mapToWorld(view, u, v) {
	return [view.centerX - (u - 0.5) * view.span, view.centerZ - (v - 0.5) * view.span]
}

// Map coordinates of world point (x, z); outside [0, 1] beyond the map.
export function worldToMap(view, x, z) {
	return [0.5 - (x - view.centerX) / view.span, 0.5 - (z - view.centerZ) / view.span]
}

// Map direction (right, down) of world direction (dx, dz).
export function getMapDirection(dx, dz) {
	return [-dx, -dz]
}

// The view scaled by `factor` (above 1 zooms out) about map point (u, v),
// which keeps the same world point under it.
export function zoomView(view, u, v, factor) {
	const span = clampSpan(view.span * factor)
	const [x, z] = mapToWorld(view, u, v)
	return { centerX: x + (u - 0.5) * span, centerZ: z + (v - 0.5) * span, span }
}

// The view dragged by (du, dv) in map units: the world follows the pointer.
export function panView(view, du, dv) {
	return {
		centerX: view.centerX + du * view.span,
		centerZ: view.centerZ + dv * view.span,
		span: view.span,
	}
}

// Whether a view followed to (x, z) has moved far enough from `view` to
// render again.
export function hasFollowMoved(view, x, z) {
	const limit = view.span * BIOME_MAP_FOLLOW_STEP
	return Math.abs(x - view.centerX) > limit || Math.abs(z - view.centerZ) > limit
}

// Category of a point of raw height `height` and biome fields `fields`
// (getBiomeFields()); `seaIce` is params.seaIce. The sea is everything the
// terrain shader colors as sea, the frozen sea where the sheet covers it
// (without its floes), and the deep ocean the sea of that biome; its land is
// the islets.
export function classifyBiomeSample(height, fields, seaIce) {
	const biome = getBiome(fields)
	if (height <= SAND_LEVEL) {
		if (biome === BIOME.DEEP_OCEAN) return BIOME_MAP_CATEGORY.DEEP_OCEAN
		return isUnderSeaIce(height, fields.ice, seaIce)
			? BIOME_MAP_CATEGORY.FROZEN_SEA
			: BIOME_MAP_CATEGORY.SEA
	}
	if (biome === BIOME.DEEP_OCEAN) return BIOME_MAP_CATEGORY.ISLETS
	if (biome === BIOME.ICE) return BIOME_MAP_CATEGORY.ICE
	return biome === BIOME.DESERT ? BIOME_MAP_CATEGORY.DESERT : BIOME_MAP_CATEGORY.FOREST
}

// Samples per pixel side: the pixel color averages a 2 × 2 grid, so islands
// smaller than a pixel blend instead of speckling the map.
export const BIOME_MAP_SUPERSAMPLE = 2

// RGBA pixels (row-major from the top left) of a `size` × `size` map of
// `view`, each the mean color of BIOME_MAP_SUPERSAMPLE² samples, and the
// sample count of each category. `params` holds the terrain settings
// (createTerrainSnapshot()) and `seaIce` the frozen sea's; `noises` default to
// the seed's.
export function rasterizeBiomeMap({
	view,
	size,
	seed,
	params,
	seaIce,
	biomeOffset = createBiomeOffset(seed),
	noises = createTerrainNoises(seed, params.octaves),
}) {
	const pixels = new Uint8ClampedArray(size * size * 4)
	const counts = new Array(BIOME_MAP_COLORS.length).fill(0)
	const fields = {}
	const samples = BIOME_MAP_SUPERSAMPLE
	const step = view.span / (size * samples)
	// The first sample, at the top left, lies at the view's largest X and Z
	// (mapToWorld()); both fall from there.
	const left = view.centerX + view.span / 2 - step / 2
	const top = view.centerZ + view.span / 2 - step / 2
	const sum = [0, 0, 0]
	for (let row = 0; row < size; row++) {
		for (let column = 0; column < size; column++) {
			sum.fill(0)
			for (let j = 0; j < samples; j++) {
				const z = top - (row * samples + j) * step
				for (let i = 0; i < samples; i++) {
					const x = left - (column * samples + i) * step
					const height = getHeight(x, z, noises, params, biomeOffset, fields)
					const category = classifyBiomeSample(height, fields, seaIce)
					counts[category]++
					const color = BIOME_MAP_COLORS[category]
					sum[0] += color[0]
					sum[1] += color[1]
					sum[2] += color[2]
				}
			}
			const offset = (row * size + column) * 4
			pixels[offset] = sum[0] / (samples * samples)
			pixels[offset + 1] = sum[1] / (samples * samples)
			pixels[offset + 2] = sum[2] / (samples * samples)
			pixels[offset + 3] = 255
		}
	}
	return { pixels, counts }
}

// Shares of the land (desert, forest, ice, islets) in `counts`, or null
// without land.
export function getLandShares(counts) {
	const desert = counts[BIOME_MAP_CATEGORY.DESERT]
	const forest = counts[BIOME_MAP_CATEGORY.FOREST]
	const ice = counts[BIOME_MAP_CATEGORY.ICE]
	const islets = counts[BIOME_MAP_CATEGORY.ISLETS]
	const land = desert + forest + ice + islets
	if (land === 0) return null
	return { desert: desert / land, forest: forest / land, ice: ice / land, islets: islets / land }
}

// A round length (1, 2, or 5 times a power of ten) of at most `maxLength`,
// for the scale bar.
export function getScaleLength(maxLength) {
	const power = 10 ** Math.floor(Math.log10(maxLength))
	for (const step of [5, 2, 1]) {
		if (step * power <= maxLength) return step * power
	}
	return power
}
