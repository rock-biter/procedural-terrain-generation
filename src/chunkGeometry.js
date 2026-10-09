import alea from 'alea'
import { createNoise2D } from 'simplex-noise'
import { createBiomeSettings, getBiomeFields } from './biome.js'
import { COAST_MASK_DEFAULTS, getCoastRelief } from './coast.js'
import { getDeepOceanFloor } from './deepOcean.js'
import { getIcePeaks } from './icePeaks.js'
import { lerp, smoothstep } from './math.js'

// getLandmass() always reads noises 0 and 1, so at least two are created even
// for a single octave; the extra one does not change any other octave.
export function createTerrainNoises(seed, octaves) {
	return Array.from({ length: Math.max(octaves, 2) }, (_, octave) =>
		createNoise2D(alea(`${seed}:${octave}`)),
	)
}

// Default desert topography. frequency and amplitude scale the detail octaves
// (1 and above) in the desert; blend is the half-width, in biome-value units,
// of the band around the biome border where the two topographies mix.
// flatten is the share of land height removed deep in the desert, reached
// progressively once the biome value is depth below the border (0).
export const DESERT_TERRAIN_DEFAULTS = Object.freeze({
	frequency: 0.5,
	amplitude: 0.45,
	blend: 0.08,
	flatten: 0.5,
	depth: 0.4,
})

// Default ice topography: a plain with sparse, tall mountains. frequency and
// amplitude scale the detail octaves in the ice; blend is the half-width, in
// ice field units, of the band around the ice border where the topographies
// mix. The forest ring (params.biomes.iceRing) must stay wider than blend plus
// the desert's, so the ice and desert topographies never overlap. flatten is
// the share of land height removed deep in the ice, reached progressively
// once the ice field is depth inside the border, where the mountains
// (src/icePeaks.js) reach their full height too. The mountains stand on a grid
// of peakSpacing world units, one in a share peakChance of its cells, with a
// radius up to peakRadius and a summit up to peakHeight, an absolute height
// that keeps them under the flight ceiling (FLIGHT_LIMITS in
// src/flightPolicy.js: 95 with a clearance of 10); peakSharpness steepens
// their profile toward a sharper summit.
export const ICE_TERRAIN_DEFAULTS = Object.freeze({
	frequency: 1.4,
	amplitude: 0.9,
	blend: 0.02,
	flatten: 0.8,
	depth: 0.06,
	peakHeight: 80,
	peakSpacing: 1400,
	peakChance: 0.35,
	peakRadius: 300,
	peakSharpness: 1.6,
})

// Default deep ocean topography (src/deepOcean.js). The terrain sinks to the
// floor, `depth` units deep, over a slope `blend` wide in deep ocean field
// units just outside the biome, so no land reaches its border. Inside, a grid
// cell of `isletSpacing` holds an archipelago with probability `isletChance`
// where the field at its center is at least `isletMargin`: a bank
// `bankDepth` deep of radius up to `bankRadius`, carrying `isletCount` islets
// of radius up to `isletRadius` and summit up to `isletHeight` (never above
// ISLET_HEIGHT_CAP, below the rocks band).
export const DEEP_OCEAN_TERRAIN_DEFAULTS = Object.freeze({
	depth: 110,
	blend: 0.075,
	isletSpacing: 900,
	isletChance: 0.25,
	isletMargin: 0.06,
	bankRadius: 395,
	bankDepth: 9.5,
	isletCount: Object.freeze({ min: 2, max: 4 }),
	isletRadius: 136,
	isletHeight: 10,
})

// Default rocky coast (src/coast.js): the relief's mound height in world
// units and noise frequency per world unit, and the mask that picks the rocky
// stretches. An amplitude of 0 leaves the coast unchanged.
export const COAST_TERRAIN_DEFAULTS = Object.freeze({
	amplitude: 1.6,
	frequency: 0.07,
	mask: COAST_MASK_DEFAULTS,
})

// Height of the visible sea surface: the mesh clamps lower terrain to it, and
// the raw height stays in the `height` attribute.
export const SEA_SURFACE_Y = -1

// Production terrain parameters (createAppParams() in src/appParams.js, edited by the ?gui=1
// Terrain and Biomes folders) and the tests' terrain, so both describe the
// same world: height amplitude, base noise frequency per axis, octave count,
// lacunarity (frequency gain per octave), persistance (amplitude gain per
// octave), the biome distribution (BIOME_DEFAULTS in src/biome.js), and the
// desert, ice, deep ocean, and coast topographies above.
export const TERRAIN_DEFAULTS = Object.freeze({
	amplitude: 32,
	frequency: Object.freeze({ x: 0.5, z: 0.5 }),
	octaves: 3,
	lacunarity: 2,
	persistance: 0.5,
	biomes: Object.freeze(createBiomeSettings()),
	desert: DESERT_TERRAIN_DEFAULTS,
	ice: ICE_TERRAIN_DEFAULTS,
	deepOcean: DEEP_OCEAN_TERRAIN_DEFAULTS,
	coast: COAST_TERRAIN_DEFAULTS,
})

// A mutable copy of TERRAIN_DEFAULTS.
export function createTerrainSettings() {
	return createTerrainSnapshot(TERRAIN_DEFAULTS)
}

// A detached copy of every terrain parameter of `params` (the keys of
// TERRAIN_DEFAULTS): what ChunkManager sends to the workers, so later edits
// never reach a job in flight.
export function createTerrainSnapshot(params) {
	return {
		amplitude: params.amplitude,
		frequency: { ...params.frequency },
		octaves: params.octaves,
		lacunarity: params.lacunarity,
		persistance: params.persistance,
		biomes: { ...params.biomes },
		desert: { ...params.desert },
		ice: { ...params.ice },
		deepOcean: { ...params.deepOcean, isletCount: { ...params.deepOcean.isletCount } },
		coast: { ...params.coast, mask: { ...params.coast.mask } },
	}
}

// Sum of octaves [firstOctave, lastOctave) with their frequency and amplitude
// scaled; the scales stay 1 for the unmodified terrain.
function getOctaves(
	x,
	z,
	noises,
	params,
	firstOctave,
	lastOctave,
	frequencyScale = 1,
	amplitudeScale = 1,
) {
	let height = 0
	const frequencyX = params.frequency.x * frequencyScale
	const frequencyZ = params.frequency.z * frequencyScale

	for (let octave = firstOctave; octave < lastOctave; octave++) {
		const amplitude = params.amplitude * params.persistance ** octave * amplitudeScale
		const lacunarity = params.lacunarity ** octave
		let increment = noises[octave](
			x * 0.01 * frequencyX * lacunarity,
			z * 0.01 * frequencyZ * lacunarity,
		)

		increment *= increment
		height += increment * amplitude
	}

	return height
}

function getLandmass(x, z, noises, params) {
	let landmass = noises[0](x * 0.001, z * 0.001) - 0.5
	const landmassNoise = landmass
	landmass *= params.amplitude * 3.5
	const blend = noises[1](x * 0.0005, z * 0.0005) - 0.5
	return lerp(
		landmass,
		(smoothstep(0.5, 1, blend) - 0.5) * params.amplitude * 2,
		1 - smoothstep(-1, -0.3, landmassNoise),
	)
}

// Share of desert detail topography outside the ice: 1 inside the desert, 0
// in the temperate biome, mixed over +-blend around the border. `climate` is
// the effective climate of getBiomeFields() (src/biome.js).
export function getDesertWeight(climate, params) {
	const blend = Math.max(params.desert.blend, 1e-6)
	return 1 - smoothstep(-blend, blend, climate)
}

// Share of ice detail topography: 1 inside the ice, 0 outside, mixed over
// +-blend around the border of the ice field.
export function getIceWeight(ice, params) {
	const blend = Math.max(params.ice.blend, 1e-6)
	return smoothstep(-blend, blend, ice)
}

// Share of land height removed by the desert: 0 at the border, growing
// smoothly to flatten once the climate is depth below it.
export function getDesertFlattening(climate, params) {
	const depth = Math.max(params.desert.depth, 1e-6)
	return params.desert.flatten * smoothstep(0, depth, -climate)
}

// Share of land height removed by the ice: 0 at its border, growing smoothly
// to flatten once the ice field is depth inside it.
export function getIceFlattening(ice, params) {
	const depth = Math.max(params.ice.depth, 1e-6)
	return params.ice.flatten * smoothstep(0, depth, ice)
}

// Share of the deep ocean floor: 0 at `blend` (in deep ocean field units)
// outside the biome, 1 at its border and inside. The slope lies entirely
// outside, so no land reaches the border.
export function getDeepOceanWeight(ocean, params) {
	const blend = Math.max(params.deepOcean.blend, 1e-6)
	return smoothstep(-blend, 0, ocean)
}

// Reused by getHeight(), which never runs reentrantly.
const heightFields = { climate: 0, ice: 0, ringDriven: false, ocean: 0 }

// biomeOffset comes from createBiomeOffset(seed); the desert, the ice, and
// the deep ocean reshape the terrain, so heights depend on the biome fields
// (params.biomes). With `fields`, the biome fields at (x, z) are written to it.
export function getHeight(x, z, noises, params, biomeOffset, fields = heightFields) {
	// Inside the deep ocean the floor replaces everything else: lerp() with a
	// weight of 1 returns it exactly, so the land terms are skipped.
	getBiomeFields(x, z, biomeOffset, params.biomes, fields)
	const deepOcean = getDeepOceanWeight(fields.ocean, params)
	if (deepOcean >= 1) return getDeepOceanFloor(x, z, fields.ocean, biomeOffset, params)

	// Octave 0 and the landmass shape the world at large scale and are shared
	// by every biome. Detail octaves are computed for each biome only where it
	// has weight, then mixed, so the borders have no frequency warping.
	const ice = getIceWeight(fields.ice, params)
	const desert = (1 - ice) * getDesertWeight(fields.climate, params)
	const temperate = 1 - ice - desert
	let height = getOctaves(x, z, noises, params, 0, Math.min(params.octaves, 1))
	if (temperate > 0) {
		height += temperate * getOctaves(x, z, noises, params, 1, params.octaves)
	}
	if (desert > 0) {
		height +=
			desert *
			getOctaves(
				x,
				z,
				noises,
				params,
				1,
				params.octaves,
				params.desert.frequency,
				params.desert.amplitude,
			)
	}
	if (ice > 0) {
		height +=
			ice *
			getOctaves(
				x,
				z,
				noises,
				params,
				1,
				params.octaves,
				params.ice.frequency,
				params.ice.amplitude,
			)
	}
	height += getLandmass(x, z, noises, params)

	// Rocky coasts rise in mounds around the waterline. The relief is added
	// before the desert and ice flattening, which scale it with the rest of
	// the land.
	height += getCoastRelief(x, z, height, biomeOffset, params.coast)

	// Only land is lowered, so coastlines and sea depth stay unchanged. The
	// forest ring keeps the two flattenings apart. The ice's mountains rise
	// from its flattened plain, and only on land.
	if (height > 0) {
		const landHeight = height
		height *= 1 - getDesertFlattening(fields.climate, params) - getIceFlattening(fields.ice, params)
		if (fields.ice > 0) {
			height = getIcePeaks(x, z, height, landHeight, fields.ice, biomeOffset, params.ice)
		}
	}

	// The slope toward the deep ocean sinks land and sea alike to its floor.
	if (deepOcean > 0) height = lerp(height, -params.deepOcean.depth, deepOcean)

	return height
}

// World-space step for normal sampling. It is independent of chunk LOD, so
// vertices shared by neighbouring chunks get identical normals at any detail.
export const NORMAL_EPSILON = 1

function getSurfaceHeight(x, z, noises, params, biomeOffset) {
	return Math.max(getHeight(x, z, noises, params, biomeOffset), SEA_SURFACE_Y)
}

export function getSurfaceNormal(x, z, noises, params, biomeOffset, target = [0, 0, 0]) {
	const left = getSurfaceHeight(x - NORMAL_EPSILON, z, noises, params, biomeOffset)
	const right = getSurfaceHeight(x + NORMAL_EPSILON, z, noises, params, biomeOffset)
	const back = getSurfaceHeight(x, z - NORMAL_EPSILON, noises, params, biomeOffset)
	const front = getSurfaceHeight(x, z + NORMAL_EPSILON, noises, params, biomeOffset)

	const nx = left - right
	const ny = 2 * NORMAL_EPSILON
	const nz = back - front
	const length = Math.hypot(nx, ny, nz)

	target[0] = nx / length
	target[1] = ny / length
	target[2] = nz / length

	return target
}

export function getChunkSegments(size, LOD, density) {
	return Math.max(Math.floor(size * 0.5 ** LOD), density) / density
}

// Normal from the four height samples around a vertex, NORMAL_EPSILON away
// along X (left, right) and Z (back, front), written at `offset`.
function writeNormal(target, offset, left, right, back, front) {
	const nx = left - right
	const ny = 2 * NORMAL_EPSILON
	const nz = back - front
	const length = Math.hypot(nx, ny, nz)
	target[offset] = nx / length
	target[offset + 1] = ny / length
	target[offset + 2] = nz / length
}

// Terrain buffers for one chunk, a flat grid of `segments + 1` vertices per
// side centered on (worldX, worldZ). The layout matches a PlaneGeometry
// rotated flat: row-major, rows along +Z, local coordinates rounded to
// float32. Index and uv depend only on `segments`, so the main thread shares
// them per LOD (src/chunkTopology.js); the worker sends position, normal, and
// height, plus the bounding sphere so the main thread never reads positions,
// and `maxSlope`, the steepest surface gradient (rise over run) at any vertex,
// which tells the shadow casters whether the chunk can face away from a light.
export function generateChunkGeometryData({
	size,
	LOD,
	density,
	worldX,
	worldZ,
	params,
	seed,
	biomeOffset,
	noises = createTerrainNoises(seed, params.octaves),
}) {
	// PlaneGeometry floored the segment count; kept for identical grids.
	const segments = Math.floor(getChunkSegments(size, LOD, density))
	const columns = segments + 1
	const count = columns * columns
	const half = size / 2
	const step = size / segments
	const position = new Float32Array(count * 3)
	const normal = new Float32Array(count * 3)
	const height = new Float32Array(count)

	const local = new Float32Array(columns)
	const xs = new Float64Array(columns)
	const zs = new Float64Array(columns)
	for (let i = 0; i < columns; i++) {
		local[i] = i * step - half
		xs[i] = local[i] + worldX
		zs[i] = local[i] + worldZ
	}
	const sample = (x, z) => getSurfaceHeight(x, z, noises, params, biomeOffset)

	// Where the grid step is 2 * NORMAL_EPSILON (desktop LOD 0), the +epsilon
	// sample of one vertex is the -epsilon sample of the next, along X and Z.
	// A sample is reused only where both coordinates are exactly equal, so the
	// result is the same as sampling every vertex on its own.
	const sharesX = new Uint8Array(columns)
	const sharesZ = new Uint8Array(columns)
	for (let i = 1; i < columns; i++) {
		sharesX[i] = xs[i - 1] + NORMAL_EPSILON === xs[i] - NORMAL_EPSILON ? 1 : 0
		sharesZ[i] = zs[i - 1] + NORMAL_EPSILON === zs[i] - NORMAL_EPSILON ? 1 : 0
	}
	// Front samples (z + epsilon) of the previous row, by column.
	const previousFront = new Float64Array(columns)

	let minY = Infinity
	let maxY = -Infinity
	let maxSlope = 0
	for (let row = 0; row < columns; row++) {
		const z = zs[row]
		// Right sample (x + epsilon) of the previous vertex in this row.
		let previousRight = 0
		for (let column = 0; column < columns; column++) {
			const x = xs[column]
			const index = row * columns + column
			const sampledHeight = getHeight(x, z, noises, params, biomeOffset)
			const y = Math.max(sampledHeight, SEA_SURFACE_Y)
			height[index] = sampledHeight
			position[index * 3] = local[column]
			position[index * 3 + 1] = y
			position[index * 3 + 2] = local[row]
			if (y < minY) minY = y
			if (y > maxY) maxY = y

			const left = sharesX[column] ? previousRight : sample(x - NORMAL_EPSILON, z)
			const right = sample(x + NORMAL_EPSILON, z)
			const back = sharesZ[row] ? previousFront[column] : sample(x, z - NORMAL_EPSILON)
			const front = sample(x, z + NORMAL_EPSILON)
			writeNormal(normal, index * 3, left, right, back, front)
			const slope = Math.hypot(left - right, back - front) / (2 * NORMAL_EPSILON)
			if (slope > maxSlope) maxSlope = slope
			previousRight = right
			previousFront[column] = front
		}
	}

	// Encloses the grid: x and z span [-half, half] around the center.
	minY = Math.fround(minY)
	maxY = Math.fround(maxY)
	const halfHeight = (maxY - minY) / 2
	return {
		segments,
		position,
		normal,
		height,
		boundingSphere: {
			centerY: minY + halfHeight,
			radius: Math.hypot(half, half, halfHeight),
		},
		maxSlope,
	}
}

// Triangle indices of a chunk grid, in PlaneGeometry order. Uint16 while
// every vertex index fits.
export function createChunkIndex(segments) {
	const columns = segments + 1
	const ArrayType = columns * columns > 65536 ? Uint32Array : Uint16Array
	const index = new ArrayType(segments * segments * 6)
	let offset = 0
	for (let row = 0; row < segments; row++) {
		for (let column = 0; column < segments; column++) {
			const a = column + columns * row
			const b = column + columns * (row + 1)
			const c = column + 1 + columns * (row + 1)
			const d = column + 1 + columns * row
			index[offset++] = a
			index[offset++] = b
			index[offset++] = d
			index[offset++] = b
			index[offset++] = c
			index[offset++] = d
		}
	}
	return index
}

// Order of the `edgeFactors` of createChunkShadowIndex(): the edges at the
// first row (-Z), last row (+Z), first column (-X), and last column (+X).
export const CHUNK_EDGES = Object.freeze(['back', 'front', 'left', 'right'])
const NO_STITCHING = Object.freeze([1, 1, 1, 1])

function isPowerOfTwo(value) {
	return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0
}

// Triangle indices of a coarser grid over the vertices of a chunk grid of
// `segments`: every (segments / shadowSegments)-th row and column, in the
// winding of createChunkIndex(), for the terrain shadow casters. Chunks sample
// the same world points at every LOD, so two neighbors with the same
// `shadowSegments` share their edge vertices. An edge whose neighbor is
// coarser by `edgeFactors[edge]` (in CHUNK_EDGES order) snaps its vertices
// down to that neighbor's, which removes the T-junctions without new
// vertices: triangles that collapse are dropped, and the rest still tile the
// chunk. Uint16 while every vertex index fits.
export function createChunkShadowIndex(segments, shadowSegments, edgeFactors = NO_STITCHING) {
	const stride = segments / shadowSegments
	if (!isPowerOfTwo(stride)) {
		throw new RangeError(
			`Shadow segments must divide ${segments} by a power of two: ${shadowSegments}`,
		)
	}
	for (const factor of edgeFactors) {
		if (!isPowerOfTwo(factor) || factor > shadowSegments) {
			throw new RangeError(`Edge factors must be powers of two up to ${shadowSegments}: ${factor}`)
		}
	}
	const [back, front, left, right] = edgeFactors
	const last = shadowSegments
	const columns = segments + 1
	const snap = (value, factor) => Math.floor(value / factor) * factor
	// Shadow-grid point (row, column) snapped on its edge, as [row, column].
	// Corners are multiples of every factor, so they never move.
	const point = (row, column) => {
		if (row === 0) column = snap(column, back)
		else if (row === last) column = snap(column, front)
		else if (column === 0) row = snap(row, left)
		else if (column === last) row = snap(row, right)
		return [row, column]
	}
	const ArrayType = columns * columns > 65536 ? Uint32Array : Uint16Array
	const index = new ArrayType(last * last * 6)
	let offset = 0
	const isPoint = (p, q) => p[0] === q[0] && p[1] === q[1]
	const isCollapsed = (p, q, r) => isPoint(p, q) || isPoint(q, r) || isPoint(p, r)
	// Twice the area seen from above, positive for the grid's winding.
	const getArea = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
	const isFolded = (p, q, r) => !isCollapsed(p, q, r) && getArea(p, q, r) <= 0
	const push = (p, q, r) => {
		if (isCollapsed(p, q, r)) return
		for (const [row, column] of [p, q, r]) index[offset++] = (row * columns + column) * stride
	}
	for (let row = 0; row < last; row++) {
		for (let column = 0; column < last; column++) {
			const a = point(row, column)
			const b = point(row + 1, column)
			const c = point(row + 1, column + 1)
			const d = point(row, column + 1)
			// Where two snapped edges meet, the usual diagonal can fold a
			// triangle over the cell's free corner or lay it on a line through
			// it; the other diagonal shares that corner instead.
			if (isFolded(a, b, d) || isFolded(b, c, d)) {
				push(a, b, c)
				push(a, c, d)
			} else {
				push(a, b, d)
				push(b, c, d)
			}
		}
	}
	return offset === index.length ? index : index.slice(0, offset)
}

// Chunk uv in PlaneGeometry order: u along +X, v from 1 at the first row
// (-Z) to 0 at the last. Only the normal map's tangent frame reads it.
export function createChunkUv(segments) {
	const columns = segments + 1
	const uv = new Float32Array(columns * columns * 2)
	for (let row = 0; row < columns; row++) {
		for (let column = 0; column < columns; column++) {
			const offset = (row * columns + column) * 2
			uv[offset] = column / segments
			uv[offset + 1] = 1 - row / segments
		}
	}
	return uv
}
