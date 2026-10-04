import alea from 'alea'
import { createNoise2D } from 'simplex-noise'
import { getBiomeValue } from './biome.js'
import { COAST_MASK_DEFAULTS, getCoastRelief } from './coast.js'
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
// Terrain folder) and the tests' terrain, so both describe the same world:
// height amplitude, base noise frequency per axis, octave count, lacunarity
// (frequency gain per octave), persistance (amplitude gain per octave), and
// the desert topography above.
export const TERRAIN_DEFAULTS = Object.freeze({
	amplitude: 32,
	frequency: Object.freeze({ x: 0.5, z: 0.5 }),
	octaves: 3,
	lacunarity: 2,
	persistance: 0.5,
	desert: DESERT_TERRAIN_DEFAULTS,
	coast: COAST_TERRAIN_DEFAULTS,
})

// A mutable copy of TERRAIN_DEFAULTS.
export function createTerrainSettings() {
	return {
		...TERRAIN_DEFAULTS,
		frequency: { ...TERRAIN_DEFAULTS.frequency },
		desert: { ...TERRAIN_DEFAULTS.desert },
		coast: { ...TERRAIN_DEFAULTS.coast, mask: { ...TERRAIN_DEFAULTS.coast.mask } },
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

// Share of desert detail topography: 1 inside the desert, 0 in the temperate
// biome, mixed over +-blend around the border.
export function getDesertWeight(biomeValue, params) {
	const blend = Math.max(params.desert.blend, 1e-6)
	return 1 - smoothstep(-blend, blend, biomeValue)
}

// Share of land height removed by the desert: 0 at the border, growing
// smoothly to flatten once the biome value is depth below it.
export function getDesertFlattening(biomeValue, params) {
	const depth = Math.max(params.desert.depth, 1e-6)
	return params.desert.flatten * smoothstep(0, depth, -biomeValue)
}

// biomeOffset comes from createBiomeOffset(seed); the desert reshapes the
// terrain, so heights depend on the biome field.
export function getHeight(x, z, noises, params, biomeOffset) {
	// Octave 0 and the landmass shape the world at large scale and are shared
	// by every biome. Detail octaves are computed for each biome only where it
	// has weight, then mixed, so the border has no frequency warping.
	const biomeValue = getBiomeValue(x, z, biomeOffset)
	const desert = getDesertWeight(biomeValue, params)
	let height = getOctaves(x, z, noises, params, 0, Math.min(params.octaves, 1))
	if (desert < 1) {
		height += (1 - desert) * getOctaves(x, z, noises, params, 1, params.octaves)
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
	height += getLandmass(x, z, noises, params)

	// Rocky coasts rise in mounds around the waterline. The relief is added
	// before the desert flattening, which scales it with the rest of the land.
	height += getCoastRelief(x, z, height, biomeOffset, params.coast)

	// Only land is lowered, so coastlines and sea depth stay unchanged.
	if (height > 0) height *= 1 - getDesertFlattening(biomeValue, params)

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
// height, plus the bounding sphere so the main thread never reads positions.
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
