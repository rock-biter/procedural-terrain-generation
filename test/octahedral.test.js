import assert from 'node:assert/strict'
import test from 'node:test'
import {
	decodeHemiOct,
	encodeHemiOct,
	getFrameBasis,
	getFrameBlend,
	getFrameDirection,
} from '../src/impostors/octahedral.js'

const close = (a, b, epsilon = 1e-9) => Math.abs(a - b) < epsilon
// Test grid, mobile, and desktop frame counts.
const FRAME_COUNTS = [8, 12, 16]

function normalize([x, y, z]) {
	const length = Math.hypot(x, y, z)
	return [x / length, y / length, z / length]
}

test('round-trips upper-hemisphere directions', () => {
	for (let i = 0; i < 500; i++) {
		const azimuth = (i * 2.399) % (Math.PI * 2)
		const elevation = ((i * 0.618) % 1) * (Math.PI / 2)
		const direction = [
			Math.cos(elevation) * Math.cos(azimuth),
			Math.sin(elevation),
			Math.cos(elevation) * Math.sin(azimuth),
		]
		const [u, v] = encodeHemiOct(...direction)
		assert.ok(Math.abs(u) <= 1 + 1e-9 && Math.abs(v) <= 1 + 1e-9)
		const decoded = decodeHemiOct(u, v)
		decoded.forEach((value, axis) => assert.ok(close(value, direction[axis])))
	}
})

test('puts the horizon on the outer frame ring', () => {
	for (const frames of FRAME_COUNTS) {
		for (let i = 0; i < frames; i++) {
			assert.ok(close(getFrameDirection(i, 0, frames)[1], 0))
			assert.ok(close(getFrameDirection(frames - 1, i, frames)[1], 0))
		}
	}
})

test('builds an orthonormal right-handed basis for every frame', () => {
	const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

	for (const frames of FRAME_COUNTS) {
		for (let x = 0; x < frames; x++) {
			for (let y = 0; y < frames; y++) {
				const direction = getFrameDirection(x, y, frames)
				const { right, up, forward } = getFrameBasis(direction)
				assert.ok(close(dot(right, up), 0))
				assert.ok(close(dot(right, forward), 0))
				assert.ok(close(dot(up, forward), 0))
				assert.ok(close(dot(right, right), 1))
				assert.ok(close(dot(up, up), 1))
				assert.ok(up[1] >= -1e-9, 'baked frames keep world up on screen')
				// right x up = forward
				const cross = [
					right[1] * up[2] - right[2] * up[1],
					right[2] * up[0] - right[0] * up[2],
					right[0] * up[1] - right[1] * up[0],
				]
				cross.forEach((value, axis) => assert.ok(close(value, forward[axis])))
			}
		}
	}
})

test('blends three neighbouring frames with normalized weights', () => {
	for (const frames of FRAME_COUNTS) {
		for (let i = 0; i < 300; i++) {
			const direction = normalize([
				Math.sin(i * 1.3),
				Math.abs(Math.cos(i * 0.7)) + 0.01,
				Math.cos(i * 2.1),
			])
			const blend = getFrameBlend(...direction, frames)
			const { weights } = blend
			assert.ok(close(weights[0] + weights[1] + weights[2], 1))
			for (const weight of weights) assert.ok(weight >= -1e-9)
			for (const [x, y] of blend.frames) {
				assert.ok(x >= 0 && x < frames && y >= 0 && y < frames)
			}
		}
	}
})

test('selects a single frame when the view matches it', () => {
	for (const frames of FRAME_COUNTS) {
		const direction = getFrameDirection(3, 5, frames)
		const blend = getFrameBlend(...direction, frames)
		const dominant = blend.weights.indexOf(Math.max(...blend.weights))
		assert.deepEqual(blend.frames[dominant], [3, 5])
		assert.ok(close(blend.weights[dominant], 1, 1e-6))
	}
})

test('round-trips lower-hemisphere directions', () => {
	for (let i = 0; i < 500; i++) {
		const azimuth = (i * 2.399) % (Math.PI * 2)
		const elevation = -((i * 0.618) % 1) * (Math.PI / 2)
		const direction = [
			Math.cos(elevation) * Math.cos(azimuth),
			Math.sin(elevation),
			Math.cos(elevation) * Math.sin(azimuth),
		]
		const [u, v] = encodeHemiOct(...direction, -1)
		assert.ok(Math.abs(u) <= 1 + 1e-9 && Math.abs(v) <= 1 + 1e-9)
		const decoded = decodeHemiOct(u, v, -1)
		decoded.forEach((value, axis) => assert.ok(close(value, direction[axis])))
	}
})

test('mirrors the upper mapping for the lower hemisphere', () => {
	for (const frames of FRAME_COUNTS) {
		for (let x = 0; x < frames; x++) {
			for (let y = 0; y < frames; y++) {
				const upper = getFrameDirection(x, y, frames)
				const lower = getFrameDirection(x, y, frames, -1)
				assert.ok(lower[1] <= 1e-9, 'lower frames look from below')
				assert.ok(close(lower[0], upper[0]))
				assert.ok(close(lower[1], -upper[1]))
				assert.ok(close(lower[2], upper[2]))
				// The bake keeps world up on screen from below too.
				assert.ok(getFrameBasis(lower).up[1] >= -1e-9)
			}
		}
		const direction = getFrameDirection(2, 7, frames, -1)
		const blend = getFrameBlend(...direction, frames, -1)
		const dominant = blend.weights.indexOf(Math.max(...blend.weights))
		assert.deepEqual(blend.frames[dominant], [2, 7])
	}
})

test('clamps views from the other hemisphere to the horizon ring', () => {
	const [u, v] = encodeHemiOct(0.3, 0.8, 0.5, -1)
	assert.ok(close(Math.abs((u + v) / 2) + Math.abs((u - v) / 2), 1))
})
