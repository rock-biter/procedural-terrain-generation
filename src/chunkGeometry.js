import alea from 'alea'
import {
	BufferAttribute,
	BufferGeometry,
	MathUtils,
	PlaneGeometry,
} from 'three'
import { createNoise2D } from 'simplex-noise'

export function createTerrainNoises(seed, octaves) {
	return Array.from({ length: octaves }, (_, octave) =>
		createNoise2D(alea(`${seed}:${octave}`)),
	)
}

export function getHeight(x, z, noises, params) {
	let height = 0
	const frequencyX = params.frequency.x
	const frequencyZ = params.frequency.z

	for (let octave = 0; octave < params.octaves; octave++) {
		const amplitude = params.amplitude * params.persistance ** octave
		const lacunarity = params.lacunarity ** octave
		let increment = noises[octave](
			x * 0.01 * frequencyX * lacunarity,
			z * 0.01 * frequencyZ * lacunarity,
		)

		increment *= increment
		height += increment * amplitude
	}

	let landmass = noises[0](x * 0.001, z * 0.001) - 0.5
	const landmassNoise = landmass
	landmass *= params.amplitude * 3.5
	const blend = noises[1](x * 0.0005, z * 0.0005) - 0.5
	landmass = MathUtils.lerp(
		landmass,
		(MathUtils.smoothstep(blend, 0.5, 1) - 0.5) * params.amplitude * 2,
		1 - MathUtils.smoothstep(landmassNoise, -1, -0.3),
	)

	return height + landmass
}

// World-space step for normal sampling. It is independent of chunk LOD, so
// vertices shared by neighbouring chunks get identical normals at any detail.
export const NORMAL_EPSILON = 1

function getSurfaceHeight(x, z, noises, params) {
	return Math.max(getHeight(x, z, noises, params), -1)
}

export function getSurfaceNormal(x, z, noises, params, target = [0, 0, 0]) {
	const left = getSurfaceHeight(x - NORMAL_EPSILON, z, noises, params)
	const right = getSurfaceHeight(x + NORMAL_EPSILON, z, noises, params)
	const back = getSurfaceHeight(x, z - NORMAL_EPSILON, noises, params)
	const front = getSurfaceHeight(x, z + NORMAL_EPSILON, noises, params)

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
		const sampledHeight = getHeight(x, z, noises, params)

		height.setX(index, sampledHeight)
		position.setY(index, Math.max(sampledHeight, -1))

		getSurfaceNormal(x, z, noises, params, sampledNormal)
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
