import alea from 'alea'
import { snoise } from './noise.js'
import { BIOME, BIOME_CLIMATE_LAYERS, BIOME_ICE_LAYERS } from './terrainBands.js'

export { BIOME, BIOME_COUNT } from './terrainBands.js'

// CPU twin of the biome fields in src/shaders/biome-value.glsl. The shader
// decides terrain colors per pixel; this copy lets height, placement, and the
// debug map ask which biome a world point belongs to. Both read the noise
// layers from src/terrainBands.js, the offset from createBiomeOffset()
// (uBiomeOffset), and the settings from params.biomes (uBiomeClimate,
// uBiomeIce; updateBiomeUniforms() in src/sharedUniforms.js); the snoise port
// in src/noise.js must stay identical to the GLSL, and both sides sum the
// layers in the same order.
//
// - The climate field is the climate layers at the biome coordinates, with
//   their frequencies divided by `size`, minus `desertBias`: a larger bias
//   leaves more desert.
// - The ice field is the ice layers, with frequencies divided by `iceSize`,
//   sampled in their own seeded noise space, minus `iceThreshold`: a higher
//   threshold leaves rarer ice.
// - The effective climate is max(climate, ice + iceRing): within iceRing of
//   the ice the climate is temperate, so the desert never touches the ice.
// - Ice where the ice field is >= 0, then temperate where the effective
//   climate is >= 0, else desert.

// Default distribution, edited live by the ?gui=1 Biomes > Distribution
// folder. Measured over 240 km squares of several seeds: `size` 1.8 and
// `desertBias` 0.15 make forest regions about 23% wider than with the layers
// alone (and desert regions twice as wide), and leave the desert about 54% of
// the land outside the ice. The ice covers about 7% of the land, in regions
// about as wide as the forest's.
export const BIOME_DEFAULTS = Object.freeze({
	size: 1.5,
	desertBias: 0.15,
	iceSize: 1,
	iceThreshold: 0.7,
	iceRing: 0.1,
})

// A mutable copy of BIOME_DEFAULTS.
export function createBiomeSettings() {
	return { ...BIOME_DEFAULTS }
}

// Half-widths of the bands around the biome borders where placement rejects
// candidates, so float differences between JS and GLSL cannot put an object
// of one biome on another's ground: on the climate field, and on the ice
// field (whose gradient is about ten times smaller), which also covers the
// climate border where the forest ring draws it.
export const BIOME_BORDER_MARGIN = 0.04
export const ICE_BORDER_MARGIN = 0.004

// Upper bound of |gradient(snoise)| per noise unit, with margin: the shader's
// biome separators look for the border only where a field is within this
// slope of it (getBiomeGradientBounds()).
export const BIOME_GRADIENT_SAFETY = 8.41

const BIOME_OFFSET_RANGE = 10000
// The ice offset lies in noise space, so the seed moves the ice as much as
// the climate even though the ice layers are much broader. 16 noise units
// hold hundreds of ice regions, and keep the shader's float32 noise
// coordinates small enough (precision about 2e-6) for its border gradients.
const ICE_OFFSET_RANGE = 16

// [x, z] world offset of the climate (and the rocky coast), then [u, v] noise
// space offset of the ice field. The first two values are unchanged from the
// two-biome world.
export function createBiomeOffset(seed) {
	const random = alea(`${seed}:biome`)
	return [
		(random() * 2 - 1) * BIOME_OFFSET_RANGE,
		(random() * 2 - 1) * BIOME_OFFSET_RANGE,
		random() * ICE_OFFSET_RANGE,
		random() * ICE_OFFSET_RANGE,
	]
}

const [[CLIMATE_F0, CLIMATE_W0], [CLIMATE_F1, CLIMATE_W1], [CLIMATE_F2, CLIMATE_W2]] =
	BIOME_CLIMATE_LAYERS
const [[ICE_F0, ICE_W0], [ICE_F1, ICE_W1]] = BIOME_ICE_LAYERS

// Climate field before the forest ring; getClimateNoise() in GLSL. The layers
// are unrolled (the loop cost more than the noise) and summed in the
// shader's order.
export function getClimateNoise(x, z, offset, settings) {
	const bx = x + offset[0]
	const bz = z + offset[1]
	const scale = 1 / settings.size
	const f0 = CLIMATE_F0 * scale
	const f1 = CLIMATE_F1 * scale
	const f2 = CLIMATE_F2 * scale
	return (
		snoise(bx * f0, bz * f0) * CLIMATE_W0 +
		snoise(bx * f1, bz * f1) * CLIMATE_W1 +
		snoise(bx * f2, bz * f2) * CLIMATE_W2 -
		settings.desertBias
	)
}

// Ice field, >= 0 inside the ice; getIceValue() in GLSL.
export function getIceValue(x, z, offset, settings) {
	const bx = x + offset[0]
	const bz = z + offset[1]
	const scale = 1 / settings.iceSize
	const f0 = ICE_F0 * scale
	const f1 = ICE_F1 * scale
	// The base layer minus the threshold first, as getIceBase() in GLSL.
	const base = snoise(bx * f0 + offset[2], bz * f0 + offset[3]) * ICE_W0 - settings.iceThreshold
	return base + snoise(bx * f1 + offset[2], bz * f1 + offset[3]) * ICE_W1
}

// Both fields at (x, z), written to `out`: `climate` is the effective climate
// (forest ring included), `ice` the ice field, and `ringDriven` whether the
// ring sets the climate. `settings` is params.biomes.
export function getBiomeFields(x, z, offset, settings, out = {}) {
	const ice = getIceValue(x, z, offset, settings)
	const climate = getClimateNoise(x, z, offset, settings)
	const ring = ice + settings.iceRing
	out.ice = ice
	out.climate = Math.max(climate, ring)
	out.ringDriven = ring > climate
	return out
}

// The biome of getBiomeFields() values, as the shader's getBiome() picks it.
export function getBiome({ climate, ice }) {
	if (ice >= 0) return BIOME.ICE
	return climate >= 0 ? BIOME.TEMPERATE : BIOME.DESERT
}

// Whether a point is too close to a biome border for placement.
export function isNearBiomeBorder({ climate, ice, ringDriven }) {
	if (Math.abs(ice) < ICE_BORDER_MARGIN) return true
	if (ice >= 0) return false
	return Math.abs(climate) < (ringDriven ? ICE_BORDER_MARGIN : BIOME_BORDER_MARGIN)
}

function getLayerSlope(layers) {
	return layers.reduce((sum, [frequency, weight]) => sum + frequency * weight, 0)
}

// Upper bounds of the fields' gradients per world unit: `climate` for the
// effective climate (which follows the ice field along the ring) and `ice`.
// At size 1 the climate bound is the former constant, 0.014.
export function getBiomeGradientBounds(settings) {
	const ice = (BIOME_GRADIENT_SAFETY * getLayerSlope(BIOME_ICE_LAYERS)) / settings.iceSize
	const climate = (BIOME_GRADIENT_SAFETY * getLayerSlope(BIOME_CLIMATE_LAYERS)) / settings.size
	return { climate: Math.max(climate, ice), ice }
}
