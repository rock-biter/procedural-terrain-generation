import { snoise } from './noise.js'
import { lerp, smoothstep } from './math.js'
import { cellRandom } from './random.js'

// Sparse mountains of the ice biome (three-free, so the chunk workers import
// it). getHeight() (src/chunkGeometry.js) flattens the ice's land into a plain
// and raises these mountains on it. They exist only on the CPU; the shaders
// read them through the terrain's height attribute.
//
// The mountains stand on a world grid of `peakSpacing` cells, in the seeded
// biome coordinates (createBiomeOffset()) plus PEAK_OFFSET: a cell holds one
// with probability `peakChance`, at a random point inside it. Each has a
// radius of RADIUS_RANGE times `peakRadius` and a summit at SUMMIT_RANGE times
// `peakHeight`, an absolute height: the terrain rises toward the summit along
// a profile (1 - d / r) ** `peakSharpness`, so it never exceeds
// max(plain, peakHeight). A warp of the distance frays the outline and a
// ridged noise carves crests into the flanks, leaving the summit whole. The settings are params.ice
// (ICE_TERRAIN_DEFAULTS).

// Height of the land before the ice flattening, in world units, over which
// the mountains fade in from the shore: they never rise from the sea, so the
// coastline and the frozen sea stay unchanged.
export const ICE_PEAK_SHORE = 6

// Each mountain's share of peakRadius and of peakHeight.
const RADIUS_RANGE = [0.7, 1]
const SUMMIT_RANGE = [0.75, 1]

// Outline warp, as a share of the radius, and its noise frequency per radius.
// Their product times the simplex slope (about 2.5) stays below 1, so the
// warp never folds the distance into cliffs.
const WARP = 0.22
const WARP_FREQUENCY = 1.4

// Ridged crests on the flanks: the share of the rise they remove between
// crests at the foot (none at the summit), and their noise frequency per
// world unit.
const CRAGS = 0.45
const CRAG_FREQUENCY = 0.012

// Offset that decorrelates the mountains from the other noise layers.
const PEAK_OFFSET = [-4127.3, 2291.7]

// Integer seed of the mountain grid, from the seeded biome offset (getHeight()
// receives the offset, not the seed).
export function getIcePeakSeed(biomeOffset) {
	let hash = 0x811c9dc5
	for (let index = 0; index < 4; index++) {
		hash = Math.imul(hash ^ Math.floor(biomeOffset[index] * 4096), 0x01000193)
	}
	return hash >>> 0
}

// Share of the mountains at ice field value `ice` and at land height
// `landHeight` (before the flattening): 0 at the ice border, 1 once the field
// is `depth` inside it, and 0 at the shore.
export function getIcePeakFade(ice, landHeight, settings) {
	return (
		smoothstep(0, Math.max(settings.depth, 1e-6), ice) * smoothstep(0, ICE_PEAK_SHORE, landHeight)
	)
}

// The terrain height at (x, z) with the mountains raised on `height` (the
// flattened land). `ice` is the ice field value, `landHeight` the height
// before the flattening, and `settings` params.ice. Returns `height` where no
// mountain reaches, and never lowers it.
export function getIcePeaks(x, z, height, landHeight, ice, biomeOffset, settings) {
	const { peakHeight, peakSpacing, peakChance, peakRadius, peakSharpness } = settings
	if (!(peakHeight > 0 && peakSpacing > 0 && peakChance > 0 && peakRadius > 0)) return height
	const fade = getIcePeakFade(ice, landHeight, settings)
	if (fade <= 0) return height

	// The radius stays within one cell, so the 3 x 3 cells around the warped
	// point hold every mountain that reaches it.
	const radius = Math.min(peakRadius, peakSpacing)
	const px = x + biomeOffset[0] + PEAK_OFFSET[0]
	const pz = z + biomeOffset[1] + PEAK_OFFSET[1]
	const warpFrequency = WARP_FREQUENCY / radius
	const qx = px + snoise(px * warpFrequency, pz * warpFrequency) * WARP * radius
	const qz = pz + snoise(px * warpFrequency + 31.7, pz * warpFrequency - 17.3) * WARP * radius
	const cellX = Math.floor(qx / peakSpacing)
	const cellZ = Math.floor(qz / peakSpacing)
	const seed = getIcePeakSeed(biomeOffset)
	const sharpness = Math.max(peakSharpness, 0.1)

	let peak = height
	let ridge = -1
	for (let dx = -1; dx <= 1; dx++) {
		for (let dz = -1; dz <= 1; dz++) {
			const cx = cellX + dx
			const cz = cellZ + dz
			if (cellRandom(seed, cx, cz, 0) >= peakChance) continue
			const centerX = (cx + cellRandom(seed, cx, cz, 1)) * peakSpacing
			const centerZ = (cz + cellRandom(seed, cx, cz, 2)) * peakSpacing
			const r = radius * lerp(RADIUS_RANGE[0], RADIUS_RANGE[1], cellRandom(seed, cx, cz, 3))
			const distance = Math.hypot(qx - centerX, qz - centerZ)
			if (distance >= r) continue

			if (ridge < 0) ridge = 1 - Math.abs(snoise(px * CRAG_FREQUENCY, pz * CRAG_FREQUENCY))
			const summit =
				peakHeight * lerp(SUMMIT_RANGE[0], SUMMIT_RANGE[1], cellRandom(seed, cx, cz, 4))
			const profile = (1 - distance / r) ** sharpness
			const rise = profile * (1 - CRAGS * (1 - ridge) * (1 - profile)) * fade
			peak = Math.max(peak, lerp(height, summit, rise))
		}
	}
	return peak
}
