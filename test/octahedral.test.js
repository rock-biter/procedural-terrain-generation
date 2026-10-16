import assert from 'node:assert/strict'
import test from 'node:test'
import {
	createHemiOctViews,
	decodeHemiOct,
	decodeView,
	encodeHemiOct,
	encodeView,
	getAtlasLayout,
	getFrameBasis,
	getFrameBlend,
	getFrameDirection,
	getMaxImpostorFrameSize,
	getViewDefines,
	getViewFrameBlend,
	getViewFrameDirection,
	isSameViews,
} from '../src/impostors/octahedral.js'
import {
	IMPOSTOR_ATLAS_COLUMNS,
	IMPOSTOR_ATLAS_ROWS,
	IMPOSTOR_TYPE_COUNT,
} from '../src/impostors/impostorTypes.js'

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

test('clamps views from below to the horizon ring', () => {
	const [u, v] = encodeHemiOct(0.3, -0.8, 0.5)
	assert.ok(close(Math.abs((u + v) / 2) + Math.abs((u - v) / 2), 1))
})

test('validates and compares view layouts', () => {
	assert.throws(() => createHemiOctViews(7))
	assert.ok(isSameViews(createHemiOctViews(12), createHemiOctViews(12)))
	assert.ok(!isSameViews(createHemiOctViews(12), createHemiOctViews(8)))
})

test('the layout functions match the hemi-octahedral grid', () => {
	const views = createHemiOctViews(12)
	for (let i = 0; i < 100; i++) {
		const direction = normalize([
			Math.sin(i * 1.3),
			Math.abs(Math.cos(i * 0.7)) + 0.01,
			Math.cos(i),
		])
		const [gx, gy] = encodeView(...direction)
		assert.ok(gx >= 0 && gx <= 1 && gy >= 0 && gy <= 1)
		decodeView(gx, gy).forEach((value, axis) => assert.ok(close(value, direction[axis])))
		assert.deepEqual(getViewFrameBlend(...direction, views), getFrameBlend(...direction, 12))
	}
	getViewFrameDirection(3, 5, views).forEach((value, axis) =>
		assert.ok(close(value, getFrameDirection(3, 5, 12)[axis])),
	)
})

test('sizes atlases and fits the texture limit', () => {
	// The scenery atlas: eleven types in 4 x 3 blocks.
	const SCENERY_ATLAS = { columns: IMPOSTOR_ATLAS_COLUMNS, rows: IMPOSTOR_ATLAS_ROWS }
	assert.ok(IMPOSTOR_ATLAS_COLUMNS * IMPOSTOR_ATLAS_ROWS >= IMPOSTOR_TYPE_COUNT)
	assert.deepEqual(getAtlasLayout(createHemiOctViews(12), SCENERY_ATLAS, 64), {
		blockWidth: 768,
		blockHeight: 768,
		width: 3072,
		height: 2304,
	})
	// 64 px frames fit a 4096 texture limit; a 2048 one shrinks them.
	assert.equal(getMaxImpostorFrameSize(4096, createHemiOctViews(12), SCENERY_ATLAS, 2), 85)
	assert.equal(getMaxImpostorFrameSize(2048, createHemiOctViews(12), SCENERY_ATLAS, 2), 42)
})

test('turns layouts into shader defines', () => {
	assert.deepEqual(getViewDefines(createHemiOctViews(12)), {
		IMPOSTOR_FRAMES_X: 12,
		IMPOSTOR_FRAMES_Y: 12,
	})
})
