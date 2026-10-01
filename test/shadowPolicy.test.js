import assert from 'node:assert/strict'
import test from 'node:test'
import {
	SCENERY_SHADOW_CASCADE_COUNT,
	SCENERY_SHADOW_PRESETS,
	createSceneryShadowSettings,
	getCascadeDepthRange,
	getCascadeSphere,
	getLightAngle,
	getShadowStrength,
	hasLightDirectionChanged,
	selectShadowLight,
	shouldRenderCascade,
	snapToTexel,
} from '../src/shadowPolicy.js'

function direction(elevation, azimuth = 0) {
	return [
		Math.cos(elevation) * Math.cos(azimuth),
		Math.sin(elevation),
		Math.cos(elevation) * Math.sin(azimuth),
	]
}

test('settings are fresh copies of the device preset', () => {
	const desktop = createSceneryShadowSettings()
	const mobile = createSceneryShadowSettings({ isMobile: true })
	assert.equal(desktop.cascades.length, SCENERY_SHADOW_CASCADE_COUNT)
	assert.equal(mobile.cascades.length, SCENERY_SHADOW_CASCADE_COUNT)
	assert.deepEqual(desktop.cascades, SCENERY_SHADOW_PRESETS.desktop.cascades)
	assert.deepEqual(mobile.taps.terrain, SCENERY_SHADOW_PRESETS.mobile.taps.terrain)

	desktop.cascades[0].radius = 1
	desktop.taps.terrain[0] = 1
	desktop.fade.end = 1
	const again = createSceneryShadowSettings()
	assert.equal(again.cascades[0].radius, SCENERY_SHADOW_PRESETS.desktop.cascades[0].radius)
	assert.equal(again.taps.terrain[0], SCENERY_SHADOW_PRESETS.desktop.taps.terrain[0])
	assert.equal(again.fade.end, SCENERY_SHADOW_PRESETS.desktop.fade.end)
})

test('every preset fades shadows out inside the far cascade', () => {
	for (const preset of Object.values(SCENERY_SHADOW_PRESETS)) {
		const [near, far] = preset.cascades
		assert.ok(near.radius < far.radius)
		assert.ok(preset.fade.start < preset.fade.end)
		// Ahead of the plane, the far cascade reaches past the fade end.
		assert.ok(preset.fade.end < far.radius * (1 + far.forwardShift) * 0.85)
		assert.ok(preset.fade.end > near.radius)
	}
})

test('the higher light casts shadows and fades in with elevation', () => {
	const settings = createSceneryShadowSettings()
	const sunHigh = selectShadowLight(direction(0.8), direction(-0.8, Math.PI), settings)
	assert.equal(sunHigh.light, 'sun')
	assert.equal(sunHigh.strength, 1)

	const moonHigh = selectShadowLight(direction(-0.6), direction(0.6, Math.PI), settings)
	assert.equal(moonHigh.light, 'moon')
	assert.equal(moonHigh.strength, 1)

	const halfway = (settings.elevationFade.start + settings.elevationFade.end) / 2
	const fading = selectShadowLight(direction(halfway), direction(-halfway, Math.PI), settings)
	assert.ok(fading.strength > 0 && fading.strength < 1)
})

test('the sun/moon hand-over happens at zero strength', () => {
	const settings = createSceneryShadowSettings()
	for (const elevation of [-0.04, -0.01, 0, 0.01, 0.04]) {
		const { strength } = selectShadowLight(
			direction(elevation),
			direction(-elevation, Math.PI),
			settings,
		)
		assert.equal(strength, 0)
	}
})

test('strength is 0 when disabled and clamps the setting', () => {
	assert.equal(getShadowStrength({ enabled: false, strength: 1 }, 1), 0)
	assert.equal(getShadowStrength({ enabled: true, strength: 0.5 }, 0.5), 0.25)
	assert.equal(getShadowStrength({ enabled: true, strength: 2 }, 1), 1)
})

test('cascade spheres move ahead of the plane and contain the height range', () => {
	const settings = createSceneryShadowSettings()
	const cascade = settings.cascades[0]
	const sphere = getCascadeSphere(10, 20, 0, 2, cascade, settings)
	assert.equal(sphere.x, 10)
	assert.equal(sphere.z, 20 + cascade.radius * cascade.forwardShift)
	assert.equal(sphere.diskRadius, cascade.radius)
	const { min, max } = settings.heightRange
	assert.equal(sphere.y, (min + max) / 2)
	// Every disk point at any covered height lies inside the sphere.
	assert.ok(Math.hypot(cascade.radius, (max - min) / 2) <= sphere.sphereRadius + 1e-9)

	const still = getCascadeSphere(10, 20, 0, 0, cascade, settings)
	assert.equal(still.x, 10)
	assert.equal(still.z, 20)
})

test('the depth range holds the sphere plus the caster margin', () => {
	assert.deepEqual(getCascadeDepthRange(100, 60), { near: 0, far: 260 })
})

test('texel snapping rounds to the grid', () => {
	assert.equal(snapToTexel(1.26, 0.5), 1.5)
	assert.equal(snapToTexel(-1.24, 0.5), -1)
	assert.equal(snapToTexel(3, 1), 3)
})

test('the light basis changes only beyond the threshold', () => {
	const a = direction(0.5)
	const b = direction(0.5 + 0.001)
	const c = direction(0.5 + 0.01)
	assert.ok(Math.abs(getLightAngle(a, c) - 0.01) < 1e-9)
	assert.equal(hasLightDirectionChanged(null, a, 0.0035), true)
	assert.equal(hasLightDirectionChanged(a, b, 0.0035), false)
	assert.equal(hasLightDirectionChanged(a, c, 0.0035), true)
})

test('cascades render on staggered frames unless forced', () => {
	assert.equal(shouldRenderCascade(7, 0, 1), true)
	const frames = [0, 1, 2, 3, 4, 5].filter((frame) => shouldRenderCascade(frame, 1, 2))
	assert.deepEqual(frames, [1, 3, 5])
	const third = [0, 1, 2, 3, 4, 5].filter((frame) => shouldRenderCascade(frame, 1, 3))
	assert.deepEqual(third, [2, 5])
	assert.equal(shouldRenderCascade(0, 1, 3, true), true)
})
