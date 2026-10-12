import assert from 'node:assert/strict'
import test from 'node:test'
import { SEA_SURFACE_Y } from '../src/chunkGeometry.js'
import {
	SUN_OCCLUSION_DEFAULTS,
	SUN_OCCLUSION_HEIGHT_DEFINES,
	SUN_OCCLUSION_MAX_STEPS,
	SUN_OCCLUSION_PRESETS,
	chunkIntersectsSunOcclusionWindow,
	chunkRisesAboveSea,
	createSunOcclusionSettings,
	getSunOcclusionDefines,
	getSunOcclusionSegments,
	getSunOcclusionStepDistance,
	getSunOcclusionStrength,
	getSunOcclusionVisibility,
	getSunOcclusionWindow,
	shouldRenderSunOcclusion,
} from '../src/sunOcclusionPolicy.js'
import { CURVATURE } from '../src/worldConstants.js'

const isPowerOfTwo = (value) => Number.isInteger(Math.log2(value))

// Unit direction toward a sun `elevation` radians above the flat horizon,
// along +X.
const sunAt = (elevation) => [Math.cos(elevation), Math.sin(elevation), 0]

test('sun occlusion settings are fresh copies of the device preset', () => {
	for (const [device, preset] of Object.entries(SUN_OCCLUSION_PRESETS)) {
		const settings = createSunOcclusionSettings({ isMobile: device === 'mobile' })
		assert.equal(settings.steps, preset.steps)
		assert.equal(settings.mapSize, preset.mapSize)
		assert.ok(preset.steps >= 1 && preset.steps <= SUN_OCCLUSION_MAX_STEPS)
		assert.ok(isPowerOfTwo(preset.mapSize) && isPowerOfTwo(preset.segments))
		// The march stays inside the window it starts from the middle of.
		assert.ok(preset.reach <= preset.radius)
	}
	const settings = createSunOcclusionSettings()
	settings.elevation.full = 1
	assert.equal(createSunOcclusionSettings().elevation.full, SUN_OCCLUSION_DEFAULTS.elevation.full)
})

test('the step count is a define, with the height base the caster shares', () => {
	assert.deepEqual(getSunOcclusionDefines(12), {
		SUN_OCCLUSION_STEPS: 12,
		SUN_OCCLUSION_HEIGHT_BASE: `(${SEA_SURFACE_Y.toFixed(1)})`,
	})
	assert.equal(
		getSunOcclusionDefines(1).SUN_OCCLUSION_HEIGHT_BASE,
		SUN_OCCLUSION_HEIGHT_DEFINES.SUN_OCCLUSION_HEIGHT_BASE,
	)
	for (const steps of [0, SUN_OCCLUSION_MAX_STEPS + 1, 2.5]) {
		assert.throws(() => getSunOcclusionDefines(steps), RangeError)
	}
})

test('the occlusion runs only while the sun is low and gives light', () => {
	const settings = createSunOcclusionSettings()
	const { full, end } = settings.elevation
	assert.deepEqual(getSunOcclusionStrength(settings, sunAt(0.05), 1), { specular: 1, diffuse: 0 })
	// Below the flat horizon the curvature can still show the sun.
	assert.equal(getSunOcclusionStrength(settings, sunAt(-0.1), 0.5).specular, 1)
	assert.equal(getSunOcclusionStrength(settings, sunAt(end + 0.01), 1).specular, 0)
	const between = getSunOcclusionStrength(settings, sunAt((full + end) / 2), 1).specular
	assert.ok(between > 0 && between < 1)
	assert.equal(getSunOcclusionStrength(settings, sunAt(0.05), 0).specular, 0)
	assert.equal(getSunOcclusionStrength({ ...settings, enabled: false }, sunAt(0.05), 1).specular, 0)
	assert.equal(getSunOcclusionStrength({ ...settings, diffuse: 0.5 }, sunAt(0.05), 1).diffuse, 0.5)
})

test('the window snaps to texels and leans toward the sun', () => {
	const settings = createSunOcclusionSettings()
	const texel = (settings.radius * 2) / settings.mapSize
	const window = getSunOcclusionWindow(10.3, -7.9, [1, 0, 0], settings)
	assert.equal(window.texel, texel)
	assert.equal(window.halfSize, settings.radius)
	assert.equal(window.x, Math.round((10.3 + settings.radius * settings.sunShift) / texel) * texel)
	assert.equal(window.z, Math.round(-7.9 / texel) * texel)
	const overhead = getSunOcclusionWindow(10.3, -7.9, [0, 1, 0], settings)
	assert.equal(overhead.x, Math.round(10.3 / texel) * texel)
})

test('only chunks in the window that rise above the sea are drawn', () => {
	const window = { x: 0, z: 0, halfSize: 1000 }
	assert.ok(chunkIntersectsSunOcclusionWindow(1100, 0, 128, window))
	assert.ok(!chunkIntersectsSunOcclusionWindow(1200, 0, 128, window))
	assert.ok(!chunkRisesAboveSea(SEA_SURFACE_Y))
	assert.ok(chunkRisesAboveSea(SEA_SURFACE_Y + 1))
	assert.equal(getSunOcclusionSegments(32, 16), 16)
	assert.equal(getSunOcclusionSegments(32, 128), 32)
})

test('the map renders on recentering at once and on new chunks at a pace', () => {
	const base = { center: [0, 0], x: 0, z: 0, recenterDistance: 100 }
	assert.ok(shouldRenderSunOcclusion({ ...base, center: null }))
	assert.ok(shouldRenderSunOcclusion({ ...base, forced: true }))
	assert.ok(!shouldRenderSunOcclusion(base))
	assert.ok(shouldRenderSunOcclusion({ ...base, x: 101 }))
	const changed = { ...base, castersChanged: true, minFrames: 15 }
	assert.ok(!shouldRenderSunOcclusion({ ...changed, framesSinceRender: 3 }))
	assert.ok(shouldRenderSunOcclusion({ ...changed, framesSinceRender: 15 }))
})

test('the march samples densely near the pixel and reaches out to its reach', () => {
	const distances = Array.from({ length: 12 }, (_, index) =>
		getSunOcclusionStepDistance(index, 12, 0.5, 4, 1600),
	)
	for (let index = 1; index < distances.length; index++) {
		assert.ok(distances[index] > distances[index - 1])
		assert.ok(distances[index] - distances[index - 1] >= distances[1] - distances[0])
	}
	assert.equal(getSunOcclusionStepDistance(0, 12, 0, 4, 1600), 4)
	assert.equal(getSunOcclusionStepDistance(11, 12, 1, 4, 1600), 1600)
})

test('the relief between a pixel and a low sun hides it, on the curved world', () => {
	const settings = createSunOcclusionSettings()
	const march = (x, sampleHeight, sunDirection) =>
		getSunOcclusionVisibility({
			x,
			y: SEA_SURFACE_Y,
			z: 0,
			eye: [0, 60, 0],
			sunDirection,
			sampleHeight,
			curvature: CURVATURE,
			steps: settings.steps,
			firstStep: settings.firstStep,
			reach: settings.reach,
			penumbra: settings.penumbra,
		})
	const sea = () => SEA_SURFACE_Y
	const ridge = (height) => (x) => (x > 200 && x < 260 ? height : SEA_SURFACE_Y)
	const low = sunAt(0.03)
	assert.equal(march(100, sea, low), 1)
	// The ridge stands between the sea and the sun, then behind it.
	assert.equal(march(100, ridge(40), low), 0)
	assert.equal(march(300, ridge(40), low), 1)
	// A taller ridge never lets more sun through.
	let previous = 1
	for (const height of [0, 2, 4, 8, 16, 40]) {
		const visibility = march(100, ridge(height), low)
		assert.ok(visibility <= previous)
		previous = visibility
	}
	// Below the flat horizon the sun has set on the sea near the eye, but the
	// curvature still turns the distant sea toward it.
	const set = sunAt(-0.05)
	assert.equal(march(50, sea, set), 0)
	assert.equal(march(600, sea, set), 1)
})
