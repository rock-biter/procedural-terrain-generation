// Rules for the baked tileable noise (src/noiseTexture.js), which the purely
// visual shader noise samples (noise-texture-pars.glsl) instead of evaluating
// simplex noise per pixel. Pure: no three.js, so the tests import it. Fields
// tied to the CPU twins (the climate, ice, and deep ocean fields, the rocky
// coast) never use it: they must match src/biome.js and src/coast.js.
import { cellRandom, hashSeed } from './random.js'

// Texels per side of the square tile.
export const NOISE_TILE_SIZE = 512
// Lattice cells per side: the noise repeats every NOISE_TILE_CELLS noise units
// (a consumer's frequency turns them into world units), with 16 texels per
// cell, smooth under bilinear filtering.
export const NOISE_TILE_CELLS = 32
// Independent fields, one per RGBA channel.
export const NOISE_TILE_CHANNELS = 4
// Lattice cells per unit of the shaders' noise coordinates: simplex noise
// (snoise()) varies faster than gradient noise per unit, so this matches
// their mean slope over their spread. The tile then repeats every
// NOISE_TILE_CELLS / NOISE_UNIT_CELLS (about 19) noise units.
export const NOISE_UNIT_CELLS = 1.65
// Scales the gradient noise to the spread (standard deviation, about 0.47) of
// snoise() in src/noise.js, so thresholds tuned for it keep their look. The
// gradient noise has longer tails: about 4% of the tile clamps at ±1.
export const NOISE_GAIN = 2.2

// Defines of noise-texture-pars.glsl.
export const NOISE_SHADER_DEFINES = Object.freeze({
	NOISE_TILE_SIZE: NOISE_TILE_SIZE.toFixed(1),
	NOISE_TILE_UV_SCALE: String(NOISE_UNIT_CELLS / NOISE_TILE_CELLS),
})

const NOISE_SEED = hashSeed('noise-tile')

// Unit gradients of channel `channel` at every lattice point of a tile of
// `cells` per side, as [x, y] pairs row by row: the lattice wraps around, so
// the noise tiles.
export function createNoiseGradients(channel, cells = NOISE_TILE_CELLS) {
	const gradients = new Float32Array(cells * cells * 2)
	for (let y = 0; y < cells; y++) {
		for (let x = 0; x < cells; x++) {
			const angle = cellRandom(NOISE_SEED, x, y, channel) * Math.PI * 2
			const index = (y * cells + x) * 2
			gradients[index] = Math.cos(angle)
			gradients[index + 1] = Math.sin(angle)
		}
	}
	return gradients
}

function fade(t) {
	return t * t * t * (t * (t * 6 - 15) + 10)
}

function wrap(value, cells) {
	return ((value % cells) + cells) % cells
}

// Periodic 2D gradient (Perlin) noise of `gradients` at (x, y), in lattice
// cells, without NOISE_GAIN: about [-0.7, 0.7].
export function sampleGradientNoise(gradients, x, y, cells = NOISE_TILE_CELLS) {
	const cellX = Math.floor(x)
	const cellY = Math.floor(y)
	const fx = x - cellX
	const fy = y - cellY
	const x0 = wrap(cellX, cells)
	const y0 = wrap(cellY, cells)
	const x1 = (x0 + 1) % cells
	const y1 = (y0 + 1) % cells
	const corner = (cx, cy, dx, dy) => {
		const index = (cy * cells + cx) * 2
		return gradients[index] * dx + gradients[index + 1] * dy
	}
	const u = fade(fx)
	const n0 = corner(x0, y0, fx, fy) + (corner(x1, y0, fx - 1, fy) - corner(x0, y0, fx, fy)) * u
	const n1 =
		corner(x0, y1, fx, fy - 1) + (corner(x1, y1, fx - 1, fy - 1) - corner(x0, y1, fx, fy - 1)) * u
	return n0 + (n1 - n0) * fade(fy)
}

// The tile as RGBA bytes, row by row from v = 0: channel c of texel (tx, ty)
// holds the noise of channel c at the texel's center, times NOISE_GAIN,
// clamped to [-1, 1] and mapped to [0, 255].
export function generateNoiseTile(size = NOISE_TILE_SIZE, cells = NOISE_TILE_CELLS) {
	const data = new Uint8Array(size * size * NOISE_TILE_CHANNELS)
	const gradients = Array.from({ length: NOISE_TILE_CHANNELS }, (_, channel) =>
		createNoiseGradients(channel, cells),
	)
	const step = cells / size
	for (let ty = 0; ty < size; ty++) {
		const y = (ty + 0.5) * step
		for (let tx = 0; tx < size; tx++) {
			const x = (tx + 0.5) * step
			const index = (ty * size + tx) * NOISE_TILE_CHANNELS
			for (let channel = 0; channel < NOISE_TILE_CHANNELS; channel++) {
				const value = sampleGradientNoise(gradients[channel], x, y, cells) * NOISE_GAIN
				data[index + channel] = Math.round((Math.min(Math.max(value, -1), 1) * 0.5 + 0.5) * 255)
			}
		}
	}
	return data
}
