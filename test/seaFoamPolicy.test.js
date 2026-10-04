import assert from 'node:assert/strict'
import test from 'node:test'
import {
	IMPOSTOR_INSTANCE_STRIDE,
	IMPOSTOR_TYPE,
	IMPOSTOR_TYPE_COUNT,
} from '../src/impostors/impostorTypes.js'
import {
	SEA_FOAM_FOOTPRINT_HEIGHT,
	SEA_FOAM_TYPES,
	chunkIntersectsSeaFoamWindow,
	countSeaFoamInstances,
	createSeaFoamSettings,
	getFootprintRadius,
	getSeaFoamRadii,
	getSeaFoamWindow,
	shouldRenderSeaFoam,
} from '../src/seaFoamPolicy.js'

test('desktop and mobile settings keep about one world unit per texel', () => {
	for (const isMobile of [false, true]) {
		const settings = createSeaFoamSettings({ isMobile })
		const texel = (settings.radius * 2) / settings.mapSize
		assert.ok(texel > 0.5 && texel < 2, `texel ${texel}`)
		assert.ok(settings.reach > 0 && settings.slope > 0 && settings.edgeDepth < 0)
	}
	assert.notEqual(createSeaFoamSettings(), createSeaFoamSettings())
})

test('snaps the window center to whole texels', () => {
	const settings = createSeaFoamSettings()
	const window = getSeaFoamWindow(123.456, -987.654, settings)
	assert.equal(window.halfSize, settings.radius)
	for (const [value, center] of [
		[123.456, window.x],
		[-987.654, window.z],
	]) {
		assert.ok(Math.abs(center / window.texel - Math.round(center / window.texel)) < 1e-9)
		assert.ok(Math.abs(center - value) <= window.texel / 2 + 1e-9)
	}
	const target = {}
	assert.equal(getSeaFoamWindow(0, 0, settings, target), target)
})

test('selects the chunks that can reach into the window', () => {
	const window = { x: 0, z: 0, halfSize: 100 }
	assert.ok(chunkIntersectsSeaFoamWindow(0, 0, 128, window, 0))
	assert.ok(chunkIntersectsSeaFoamWindow(228, 0, 128, window, 0))
	assert.ok(!chunkIntersectsSeaFoamWindow(229, 0, 128, window, 0))
	assert.ok(chunkIntersectsSeaFoamWindow(229, -229, 128, window, 1))
	assert.ok(!chunkIntersectsSeaFoamWindow(0, -300, 128, window, 40))
})

test('renders again when forced, when the casters change, or after moving far enough', () => {
	const base = { center: [0, 0], x: 5, z: 0, recenterDistance: 12 }
	assert.equal(shouldRenderSeaFoam(base), false)
	assert.equal(shouldRenderSeaFoam({ ...base, center: null }), true)
	assert.equal(shouldRenderSeaFoam({ ...base, forced: true }), true)
	assert.equal(shouldRenderSeaFoam({ ...base, castersChanged: true }), true)
	assert.equal(shouldRenderSeaFoam({ ...base, x: 9, z: 9 }), true)
})

test('measures the footprint around the waterline, not the overhanging top', () => {
	// A mushroom: a narrow stem from y = 0 to 2, a wide cap at y = 3.
	const positions = [1, 0, 0, 0, 0, -1, 1, 2, 0, 4, 3, 0, 0, 3, 4]
	assert.ok(SEA_FOAM_FOOTPRINT_HEIGHT < 2 / 3)
	assert.equal(getFootprintRadius(positions), 1)
})

test('gives footprints to the foam types only', () => {
	const radii = getSeaFoamRadii(() => [2, 0, 0, 0, 1, 0])
	assert.equal(radii.length, IMPOSTOR_TYPE_COUNT)
	assert.ok(SEA_FOAM_TYPES.includes(IMPOSTOR_TYPE.SEA_ROCK))
	radii.forEach((radius, type) => assert.equal(radius, SEA_FOAM_TYPES.includes(type) ? 2 : 0))

	const instances = new Float32Array(IMPOSTOR_INSTANCE_STRIDE * 3)
	instances[5] = IMPOSTOR_TYPE.SEA_ROCK
	instances[IMPOSTOR_INSTANCE_STRIDE + 5] = IMPOSTOR_TYPE.BOULDER
	instances[IMPOSTOR_INSTANCE_STRIDE * 2 + 5] = IMPOSTOR_TYPE.SEA_ROCK
	assert.equal(countSeaFoamInstances(instances, IMPOSTOR_INSTANCE_STRIDE, radii), 2)
})

test('the rocks fade out where their cone is wider than the ripple lines', () => {
	const { edgeDepth, reach, slope, blend } = createSeaFoamSettings()
	// getSeaFoamHeight() fades the rocks over the outer quarter of the reach;
	// the ripple lines span the heights from -3.5 to -7.5.
	assert.ok(edgeDepth - 0.75 * reach * slope < -7.5 - blend / 4)
	assert.ok(edgeDepth + 0.75 * reach * slope - blend / 4 > -3.5)
	assert.ok(edgeDepth > -7.5 && edgeDepth < -3.5, 'the lines start at the rock')
})
