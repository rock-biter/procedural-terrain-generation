import alea from 'alea'

// CPU twin of getBiomeValue() in src/shaders/common.glsl. The shader
// decides terrain colors per pixel; this copy lets placement code ask which
// biome a world point belongs to. Keep the frequencies, weights, and the
// snoise port below identical to the GLSL, including uBiomeOffset.

export const BIOME = Object.freeze({
	DESERT: 0,
	TEMPERATE: 1,
})

// Half-width of the band around the biome border where placement rejects
// candidates, so float differences between JS and GLSL cannot put a desert
// object on temperate ground.
export const BIOME_BORDER_MARGIN = 0.04

const BIOME_OFFSET_RANGE = 10000

export function createBiomeOffset(seed) {
	const random = alea(`${seed}:biome`)
	return [
		(random() * 2 - 1) * BIOME_OFFSET_RANGE,
		(random() * 2 - 1) * BIOME_OFFSET_RANGE,
	]
}

export function getBiomeValue(x, z, offset) {
	const bx = x + offset[0]
	const bz = z + offset[1]

	return (
		snoise(bx * 0.00035, bz * 0.00035) +
		snoise(bx * 0.0035, bz * 0.0035) * 0.22 +
		snoise(bx * 0.012, bz * 0.012) * 0.06
	)
}

export function getBiome(biomeValue) {
	return biomeValue >= 0 ? BIOME.TEMPERATE : BIOME.DESERT
}

// Port of the Ashima Arts 2D simplex noise used by src/shaders/common.glsl.
// GLSL mod() is floor-based, so it differs from the JS % operator for
// negative operands.
function mod289(x) {
	return x - Math.floor(x / 289) * 289
}

function permute(x) {
	return mod289((x * 34 + 1) * x)
}

function fract(x) {
	return x - Math.floor(x)
}

const C_X = 0.211324865405187
const C_Y = 0.366025403784439
const C_Z = -0.577350269189626
const C_W = 0.024390243902439

export function snoise(vx, vy) {
	const s = (vx + vy) * C_Y
	let ix = Math.floor(vx + s)
	let iy = Math.floor(vy + s)
	const t = (ix + iy) * C_X
	const x0x = vx - ix + t
	const x0y = vy - iy + t

	const i1x = x0x > x0y ? 1 : 0
	const i1y = x0x > x0y ? 0 : 1

	const x12x = x0x + C_X - i1x
	const x12y = x0y + C_X - i1y
	const x12z = x0x + C_Z
	const x12w = x0y + C_Z

	ix = mod289(ix)
	iy = mod289(iy)

	const p0 = permute(permute(iy) + ix)
	const p1 = permute(permute(iy + i1y) + ix + i1x)
	const p2 = permute(permute(iy + 1) + ix + 1)

	let m0 = Math.max(0.5 - (x0x * x0x + x0y * x0y), 0)
	let m1 = Math.max(0.5 - (x12x * x12x + x12y * x12y), 0)
	let m2 = Math.max(0.5 - (x12z * x12z + x12w * x12w), 0)
	m0 *= m0
	m0 *= m0
	m1 *= m1
	m1 *= m1
	m2 *= m2
	m2 *= m2

	const gx0 = 2 * fract(p0 * C_W) - 1
	const gx1 = 2 * fract(p1 * C_W) - 1
	const gx2 = 2 * fract(p2 * C_W) - 1
	const h0 = Math.abs(gx0) - 0.5
	const h1 = Math.abs(gx1) - 0.5
	const h2 = Math.abs(gx2) - 0.5
	const a0 = gx0 - Math.floor(gx0 + 0.5)
	const a1 = gx1 - Math.floor(gx1 + 0.5)
	const a2 = gx2 - Math.floor(gx2 + 0.5)

	m0 *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h0 * h0)
	m1 *= 1.79284291400159 - 0.85373472095314 * (a1 * a1 + h1 * h1)
	m2 *= 1.79284291400159 - 0.85373472095314 * (a2 * a2 + h2 * h2)

	const g0 = a0 * x0x + h0 * x0y
	const g1 = a1 * x12x + h1 * x12y
	const g2 = a2 * x12z + h2 * x12w

	return 130 * (m0 * g0 + m1 * g1 + m2 * g2)
}
