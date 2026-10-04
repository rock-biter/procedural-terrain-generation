import alea from 'alea'
import { snoise } from './noise.js'
import { BIOME_NOISE_LAYERS } from './terrainBands.js'

// CPU twin of getBiomeValue() in src/shaders/terrain-bands-pars.glsl. The
// shader decides terrain colors per pixel; this copy lets placement code ask
// which biome a world point belongs to. Both read the noise layers from
// src/terrainBands.js and the offset from createBiomeOffset() (uBiomeOffset);
// the snoise port in src/noise.js must stay identical to the GLSL.

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
	return [(random() * 2 - 1) * BIOME_OFFSET_RANGE, (random() * 2 - 1) * BIOME_OFFSET_RANGE]
}

export function getBiomeValue(x, z, offset) {
	const bx = x + offset[0]
	const bz = z + offset[1]

	// Summed in the shader's order, so rounding matches.
	let value = 0
	for (const [frequency, weight] of BIOME_NOISE_LAYERS) {
		value += snoise(bx * frequency, bz * frequency) * weight
	}
	return value
}

export function getBiome(biomeValue) {
	return biomeValue >= 0 ? BIOME.TEMPERATE : BIOME.DESERT
}
