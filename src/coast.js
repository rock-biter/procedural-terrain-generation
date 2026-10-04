import { snoise } from './noise.js'
import { smoothstep } from './math.js'
import { COAST_ROCK_NOISE } from './terrainBands.js'

// Rocky coast (three-free, so the chunk workers import it). The mask is the
// CPU twin of getCoastRockMask() in src/shaders/terrain-bands-pars.glsl: both
// sum COAST_ROCK_NOISE's layers in the same order at the seeded biome
// coordinates (createBiomeOffset(), uBiomeOffset). The relief exists only on
// the CPU; the shader reads it through the terrain's height attribute.

// Height range, in world units of the height before the relief, where the
// relief applies: it fades in over `ramp` above `min` and out over `ramp`
// below `max`, so it only shapes the shallow sea, the beach, and the first
// rise of land.
export const COAST_RELIEF_WINDOW = Object.freeze({ min: -8, max: 4, ramp: 3 })

// Offset that decorrelates the relief noise from the mask.
const RELIEF_OFFSET = [913.7, -2741.1]

export function getCoastRockMask(x, z, biomeOffset) {
	const cx = x + biomeOffset[0] + COAST_ROCK_NOISE.offset[0]
	const cz = z + biomeOffset[1] + COAST_ROCK_NOISE.offset[1]

	// Summed in the shader's order.
	let value = 0
	for (const [frequency, weight] of COAST_ROCK_NOISE.layers) {
		value += snoise(cx * frequency, cz * frequency) * weight
	}
	const { threshold, softness } = COAST_ROCK_NOISE
	return smoothstep(threshold - softness, threshold + softness, value)
}

// Share of the relief at height `height`: 1 inside the window, 0 outside.
export function getCoastReliefWindow(height) {
	const { min, max, ramp } = COAST_RELIEF_WINDOW
	return smoothstep(min, min + ramp, height) * (1 - smoothstep(max - ramp, max, height))
}

// Height added to the terrain at (x, z) on rocky coast: flat-topped mounds
// from two simplex octaves, scaled by `settings.amplitude` (world units) at
// `settings.frequency` (per world unit), the mask, and the window. It is never
// negative and is 0 outside the window, where no noise is evaluated.
export function getCoastRelief(x, z, height, biomeOffset, settings) {
	if (!(settings?.amplitude > 0) || height <= COAST_RELIEF_WINDOW.min) return 0
	if (height >= COAST_RELIEF_WINDOW.max) return 0
	const mask = getCoastRockMask(x, z, biomeOffset)
	if (mask <= 0) return 0

	const frequency = settings.frequency
	const rx = x + biomeOffset[0] + RELIEF_OFFSET[0]
	const rz = z + biomeOffset[1] + RELIEF_OFFSET[1]
	const noise =
		snoise(rx * frequency, rz * frequency) * 0.75 +
		snoise(rx * frequency * 2.3, rz * frequency * 2.3) * 0.25
	return settings.amplitude * mask * getCoastReliefWindow(height) * smoothstep(0, 0.8, noise)
}
