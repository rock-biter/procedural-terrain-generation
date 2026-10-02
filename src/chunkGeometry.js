import alea from 'alea'
import {
	BufferAttribute,
	BufferGeometry,
	MathUtils,
	PlaneGeometry,
} from 'three'
import { createNoise2D } from 'simplex-noise'
import { getBiomeValue } from './biome.js'

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
		const amplitude =
			params.amplitude * params.persistance ** octave * amplitudeScale
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
	return MathUtils.lerp(
		landmass,
		(MathUtils.smoothstep(blend, 0.5, 1) - 0.5) * params.amplitude * 2,
		1 - MathUtils.smoothstep(landmassNoise, -1, -0.3),
	)
}

// Share of desert detail topography: 1 inside the desert, 0 in the temperate
// biome, mixed over +-blend around the border.
export function getDesertWeight(biomeValue, params) {
	const blend = Math.max(params.desert.blend, 1e-6)
	return 1 - MathUtils.smoothstep(biomeValue, -blend, blend)
}

// Share of land height removed by the desert: 0 at the border, growing
// smoothly to flatten once the biome value is depth below it.
export function getDesertFlattening(biomeValue, params) {
	const depth = Math.max(params.desert.depth, 1e-6)
	return params.desert.flatten * MathUtils.smoothstep(-biomeValue, 0, depth)
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

	// Only land is lowered, so coastlines and sea depth stay unchanged.
	if (height > 0) height *= 1 - getDesertFlattening(biomeValue, params)

	return height
}

// World-space step for normal sampling. It is independent of chunk LOD, so
// vertices shared by neighbouring chunks get identical normals at any detail.
export const NORMAL_EPSILON = 1

function getSurfaceHeight(x, z, noises, params, biomeOffset) {
	return Math.max(getHeight(x, z, noises, params, biomeOffset), -1)
}

export function getSurfaceNormal(
	x,
	z,
	noises,
	params,
	biomeOffset,
	target = [0, 0, 0],
) {
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
	const segments = getChunkSegments(size, LOD, density)
	const geometry = new PlaneGeometry(size, size, segments, segments)
	geometry.rotateX(-Math.PI * 0.5)

	const position = geometry.getAttribute('position')
	const height = new BufferAttribute(new Float32Array(position.count), 1)
	geometry.setAttribute('height', height)
	const normal = geometry.getAttribute('normal')
	const sampledNormal = [0, 0, 0]

	for (let index = 0; index < position.count; index++) {
		const x = position.getX(index) + worldX
		const z = position.getZ(index) + worldZ
		const sampledHeight = getHeight(x, z, noises, params, biomeOffset)

		height.setX(index, sampledHeight)
		position.setY(index, Math.max(sampledHeight, -1))

		getSurfaceNormal(x, z, noises, params, biomeOffset, sampledNormal)
		normal.setXYZ(index, sampledNormal[0], sampledNormal[1], sampledNormal[2])
	}

	position.needsUpdate = true
	normal.needsUpdate = true

	return {
		position: geometry.getAttribute('position').array,
		normal: geometry.getAttribute('normal').array,
		uv: geometry.getAttribute('uv').array,
		height: geometry.getAttribute('height').array,
		index: geometry.getIndex().array,
	}
}

export function createChunkGeometry(data) {
	const geometry = new BufferGeometry()
	geometry.setAttribute('position', new BufferAttribute(data.position, 3))
	geometry.setAttribute('normal', new BufferAttribute(data.normal, 3))
	geometry.setAttribute('uv', new BufferAttribute(data.uv, 2))
	geometry.setAttribute('height', new BufferAttribute(data.height, 1))
	geometry.setIndex(new BufferAttribute(data.index, 1))

	return geometry
}
