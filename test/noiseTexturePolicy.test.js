import assert from 'node:assert/strict'
import test from 'node:test'
import { snoise } from '../src/noise.js'
import {
	createNoiseGradients,
	generateNoiseTile,
	NOISE_GAIN,
	NOISE_SHADER_DEFINES,
	NOISE_TILE_CELLS,
	NOISE_TILE_CHANNELS,
	NOISE_UNIT_CELLS,
	sampleGradientNoise,
} from '../src/noiseTexturePolicy.js'

// Mean and standard deviation of `sample` over a grid of `count`² points.
function getSpread(sample, count = 200, step = 0.173) {
	let sum = 0
	let squares = 0
	for (let i = 0; i < count; i++) {
		for (let j = 0; j < count; j++) {
			const value = sample(i * step + 0.05, j * step * 1.1 + 0.07)
			sum += value
			squares += value * value
		}
	}
	const mean = sum / count ** 2
	return { mean, deviation: Math.sqrt(squares / count ** 2 - mean ** 2) }
}

test('the gradient noise tiles exactly across the lattice', () => {
	const gradients = createNoiseGradients(0)
	for (const [x, y] of [
		[0.3, 0.7],
		[5.25, 17.5],
		[31.9, 0.1],
	]) {
		const value = sampleGradientNoise(gradients, x, y)
		assert.ok(Math.abs(sampleGradientNoise(gradients, x + NOISE_TILE_CELLS, y) - value) < 1e-6)
		assert.ok(Math.abs(sampleGradientNoise(gradients, x, y - NOISE_TILE_CELLS) - value) < 1e-6)
	}
	// Zero at the lattice points, as gradient noise is.
	assert.ok(Math.abs(sampleGradientNoise(gradients, 4, 9)) < 1e-9)
})

test('the scaled noise spreads like snoise() and its fields are independent', () => {
	const snoiseSpread = getSpread((x, y) => snoise(x, y))
	const fields = Array.from({ length: NOISE_TILE_CHANNELS }, (_, channel) =>
		createNoiseGradients(channel),
	)
	for (const gradients of fields) {
		const spread = getSpread((x, y) => sampleGradientNoise(gradients, x, y) * NOISE_GAIN)
		assert.ok(Math.abs(spread.mean) < 0.05)
		assert.ok(Math.abs(spread.deviation / snoiseSpread.deviation - 1) < 0.1)
	}
	// Correlation between two fields at the same points.
	let product = 0
	let squaresA = 0
	let squaresB = 0
	for (let i = 0; i < 200; i++) {
		for (let j = 0; j < 200; j++) {
			const a = sampleGradientNoise(fields[0], i * 0.161, j * 0.149)
			const b = sampleGradientNoise(fields[1], i * 0.161, j * 0.149)
			product += a * b
			squaresA += a * a
			squaresB += b * b
		}
	}
	assert.ok(Math.abs(product / Math.sqrt(squaresA * squaresB)) < 0.1)
})

test('the tile is deterministic RGBA bytes centered on 128', () => {
	const size = 64
	const tile = generateNoiseTile(size)
	assert.equal(tile.length, size * size * NOISE_TILE_CHANNELS)
	assert.deepEqual(generateNoiseTile(size), tile)
	let sum = 0
	for (const value of tile) sum += value
	assert.ok(Math.abs(sum / tile.length - 127.5) < 6)
	// The texel centers sample the same function the tests above check.
	const gradients = createNoiseGradients(2)
	const step = NOISE_TILE_CELLS / size
	const value = sampleGradientNoise(gradients, 10.5 * step, 3.5 * step) * NOISE_GAIN
	const expected = Math.round((Math.min(Math.max(value, -1), 1) * 0.5 + 0.5) * 255)
	assert.equal(tile[(3 * size + 10) * NOISE_TILE_CHANNELS + 2], expected)
})

test('the shader maps noise units to the tile with float defines', () => {
	assert.equal(NOISE_SHADER_DEFINES.NOISE_TILE_SIZE, '512.0')
	assert.equal(
		Number(NOISE_SHADER_DEFINES.NOISE_TILE_UV_SCALE),
		NOISE_UNIT_CELLS / NOISE_TILE_CELLS,
	)
	assert.match(NOISE_SHADER_DEFINES.NOISE_TILE_UV_SCALE, /^\d+\.\d+$/)
})

test('one noise unit of the tile varies as fast as one of snoise()', () => {
	// Mean slope over the spread, per unit of the shaders' coordinates.
	const roughness = (sample) => {
		let squares = 0
		let slopes = 0
		const h = 1e-3
		for (let i = 0; i < 150; i++) {
			for (let j = 0; j < 150; j++) {
				const x = i * 0.173 + 0.05
				const y = j * 0.191 + 0.07
				const value = sample(x, y)
				squares += value * value
				slopes += Math.hypot(sample(x + h, y) - value, sample(x, y + h) - value) / h
			}
		}
		return slopes / Math.sqrt(squares * 150 * 150)
	}
	const gradients = createNoiseGradients(3)
	const tile = roughness((x, y) =>
		sampleGradientNoise(gradients, x * NOISE_UNIT_CELLS, y * NOISE_UNIT_CELLS),
	)
	assert.ok(Math.abs(tile / roughness((x, y) => snoise(x, y)) - 1) < 0.05)
})
