import assert from 'node:assert/strict'
import test from 'node:test'
import {
	VIEW_LAYOUT,
	createFrontalViews,
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
	CLOUD_ATLAS_COLUMNS,
	CLOUD_ATLAS_ROWS,
	CLOUD_IMPOSTOR_VIEWS,
	IMPOSTOR_ATLAS_COLUMNS,
	IMPOSTOR_ATLAS_ROWS,
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

const CLOUD_VIEWS = createFrontalViews(CLOUD_IMPOSTOR_VIEWS)
const CLOUD_ATLAS = { columns: CLOUD_ATLAS_COLUMNS, rows: CLOUD_ATLAS_ROWS }

function frontalDirection(azimuth, elevation) {
	return [
		Math.cos(elevation) * Math.sin(azimuth),
		-Math.sin(elevation),
		-Math.cos(elevation) * Math.cos(azimuth),
	]
}

test('validates view layouts', () => {
	assert.throws(() => createHemiOctViews(7))
	assert.throws(() => createFrontalViews({ ...CLOUD_IMPOSTOR_VIEWS, framesX: 1 }))
	assert.throws(() => createFrontalViews({ ...CLOUD_IMPOSTOR_VIEWS, elevation: Math.PI / 2 }))
	assert.equal(CLOUD_VIEWS.layout, VIEW_LAYOUT.FRONTAL)
	assert.ok(isSameViews(CLOUD_VIEWS, createFrontalViews(CLOUD_IMPOSTOR_VIEWS)))
	assert.ok(!isSameViews(CLOUD_VIEWS, createHemiOctViews(12, -1)))
	assert.ok(!isSameViews(createHemiOctViews(12, 1), createHemiOctViews(12, -1)))
})

test('round-trips directions inside the frontal band', () => {
	const { azimuth, elevation } = CLOUD_IMPOSTOR_VIEWS
	for (let i = 0; i < 300; i++) {
		const direction = frontalDirection(
			(((i * 0.618) % 1) * 2 - 1) * azimuth,
			((i * 0.377) % 1) * elevation,
		)
		const [gx, gy] = encodeView(...direction, CLOUD_VIEWS)
		assert.ok(gx >= 0 && gx <= 1 && gy >= 0 && gy <= 1)
		decodeView(gx, gy, CLOUD_VIEWS).forEach((value, axis) =>
			assert.ok(close(value, direction[axis])),
		)
	}
})

test('bakes the front, the band edges, and only views from below', () => {
	const { framesX, framesY, azimuth, elevation } = CLOUD_IMPOSTOR_VIEWS
	const middle = (framesX - 1) / 2
	frontalDirection(0, 0).forEach((value, axis) =>
		assert.ok(close(getViewFrameDirection(middle, 0, CLOUD_VIEWS)[axis], value)),
	)
	frontalDirection(azimuth, elevation).forEach((value, axis) =>
		assert.ok(close(getViewFrameDirection(framesX - 1, framesY - 1, CLOUD_VIEWS)[axis], value)),
	)
	const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
	for (let x = 0; x < framesX; x++) {
		for (let y = 0; y < framesY; y++) {
			const direction = getViewFrameDirection(x, y, CLOUD_VIEWS)
			assert.ok(direction[1] <= 1e-9, 'clouds are seen from below')
			assert.ok(direction[2] < 0, 'and from the front')
			const { right, up } = getFrameBasis(direction)
			assert.ok(close(dot(right, up), 0) && close(dot(right, direction), 0))
			assert.ok(up[1] > 0, 'the bake keeps world up on screen')
		}
	}
})

test('blends neighbouring frontal frames and clamps views outside the band', () => {
	const { framesX, framesY, azimuth, elevation } = CLOUD_IMPOSTOR_VIEWS
	for (let i = 0; i < 300; i++) {
		const direction = frontalDirection(
			(((i * 0.618) % 1) * 2.4 - 1.2) * azimuth,
			(((i * 0.377) % 1) * 1.2 - 0.1) * elevation,
		)
		const { frames, weights } = getViewFrameBlend(...direction, CLOUD_VIEWS)
		assert.ok(close(weights[0] + weights[1] + weights[2], 1))
		for (const weight of weights) assert.ok(weight >= -1e-9)
		for (const [x, y] of frames) assert.ok(x >= 0 && x < framesX && y >= 0 && y < framesY)
	}
	const exact = getViewFrameBlend(...getViewFrameDirection(2, 6, CLOUD_VIEWS), CLOUD_VIEWS)
	assert.deepEqual(exact.frames[exact.weights.indexOf(Math.max(...exact.weights))], [2, 6])
	// From above, from the side, and from behind: clamped to the band edges.
	assert.deepEqual(
		encodeView(0, 1, -0.2, CLOUD_VIEWS).map((value) => value + 0),
		[0.5, 0],
	)
	assert.equal(encodeView(...frontalDirection(Math.PI / 2, 0.3), CLOUD_VIEWS)[0], 1)
	assert.equal(encodeView(...frontalDirection(-Math.PI / 2, 0.3), CLOUD_VIEWS)[0], 0)
	assert.equal(encodeView(0, -1, 0, CLOUD_VIEWS)[1], 1)
})

test('sizes atlases per layout and fits the texture limit', () => {
	assert.deepEqual(getAtlasLayout(CLOUD_VIEWS, CLOUD_ATLAS, 96), {
		blockWidth: 288,
		blockHeight: 960,
		width: 864,
		height: 960,
	})
	// The scenery atlas: seven types in 4 x 2 blocks.
	const SCENERY_ATLAS = { columns: IMPOSTOR_ATLAS_COLUMNS, rows: IMPOSTOR_ATLAS_ROWS }
	assert.deepEqual(getAtlasLayout(createHemiOctViews(12), SCENERY_ATLAS, 64), {
		blockWidth: 768,
		blockHeight: 768,
		width: 3072,
		height: 1536,
	})
	// The supersampled bake block of the tall frontal grid is the limit here.
	assert.equal(getMaxImpostorFrameSize(2048, CLOUD_VIEWS, CLOUD_ATLAS, 2), 102)
	// 64 px frames fit a 4096 texture limit; a 2048 one shrinks them.
	assert.equal(getMaxImpostorFrameSize(4096, createHemiOctViews(12), SCENERY_ATLAS, 2), 85)
	assert.equal(getMaxImpostorFrameSize(2048, createHemiOctViews(12), SCENERY_ATLAS, 2), 42)
})

test('turns layouts into shader defines', () => {
	const frontal = getViewDefines(CLOUD_VIEWS)
	assert.equal(frontal.IMPOSTOR_FRAMES_X, CLOUD_IMPOSTOR_VIEWS.framesX)
	assert.equal(frontal.IMPOSTOR_FRAMES_Y, CLOUD_IMPOSTOR_VIEWS.framesY)
	assert.ok('IMPOSTOR_FRONTAL_VIEWS' in frontal)
	assert.match(frontal.IMPOSTOR_FRONTAL_AZIMUTH, /^\d+\.\d+$/)
	assert.match(frontal.IMPOSTOR_FRONTAL_ELEVATION, /^\d+\.\d+$/)
	assert.ok(!('IMPOSTOR_LOWER_HEMISPHERE' in frontal))
	assert.ok('IMPOSTOR_LOWER_HEMISPHERE' in getViewDefines(createHemiOctViews(8, -1)))
	assert.deepEqual(getViewDefines(createHemiOctViews(12)), {
		IMPOSTOR_FRAMES_X: 12,
		IMPOSTOR_FRAMES_Y: 12,
	})
})
