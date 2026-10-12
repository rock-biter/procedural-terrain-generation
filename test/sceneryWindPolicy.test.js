import assert from 'node:assert/strict'
import test from 'node:test'
import { IMPOSTOR_TYPE, IMPOSTOR_TYPE_COUNT } from '../src/impostors/impostorTypes.js'
import {
	SCENERY_MESH_DISABLED_RANGE,
	SCENERY_MESH_MIN_BAND,
	createSceneryMeshSettings,
} from '../src/sceneryMeshPolicy.js'
import {
	SCENERY_WIND_DEFAULTS,
	SCENERY_WIND_RANGES,
	createSceneryWindSettings,
	getSceneryWindDirection,
	getSceneryWindFade,
	getSceneryWindRange,
	getSceneryWindSensitivities,
} from '../src/sceneryWindPolicy.js'

test('wind settings start enabled with the device range and their own copies', () => {
	for (const isMobile of [false, true]) {
		const settings = createSceneryWindSettings({ isMobile })
		const range = isMobile ? SCENERY_WIND_RANGES.mobile : SCENERY_WIND_RANGES.desktop
		assert.equal(settings.enabled, true)
		assert.equal(settings.start, range.start)
		assert.equal(settings.full, range.full)
		assert.equal(settings.intensity, SCENERY_WIND_DEFAULTS.intensity)
		// The defaults stay within the near meshes, before their hand-over.
		assert.ok(settings.full < settings.start)
		assert.ok(settings.start <= createSceneryMeshSettings({ isMobile }).start)
		settings.flutter.amount = 9
		settings.sensitivity.palm = 9
	}
	const fresh = createSceneryWindSettings()
	assert.equal(fresh.flutter.amount, SCENERY_WIND_DEFAULTS.flutter.amount)
	assert.equal(fresh.sensitivity.palm, SCENERY_WIND_DEFAULTS.sensitivity.palm)
})

test('the wind range stays inside the near meshes and valid for smoothstep', () => {
	const meshes = createSceneryMeshSettings()
	const wind = createSceneryWindSettings()
	assert.deepEqual(getSceneryWindRange(wind, meshes), [wind.full, wind.start])

	// Beyond the meshes' start, the motion is gone before the still impostor.
	assert.deepEqual(getSceneryWindRange({ ...wind, start: 900 }, meshes), [wind.full, meshes.start])
	// The full share keeps below the start.
	const [full, start] = getSceneryWindRange({ ...wind, full: 500 }, meshes)
	assert.equal(full, start - SCENERY_MESH_MIN_BAND)
	assert.equal(getSceneryWindRange({ ...wind, full: -5 }, meshes)[0], 0)

	// Disabled wind, disabled meshes, or no room: still everywhere.
	for (const [settings, meshSettings] of [
		[{ ...wind, enabled: false }, meshes],
		[wind, { ...meshes, enabled: false }],
		[{ ...wind, start: 0 }, meshes],
	]) {
		const range = getSceneryWindRange(settings, meshSettings)
		assert.deepEqual(range, [...SCENERY_MESH_DISABLED_RANGE])
		assert.equal(getSceneryWindFade(0, range), 0)
	}
})

test('the wind fade is full below `full` and gone beyond `start`', () => {
	const range = [70, 160]
	assert.equal(getSceneryWindFade(0, range), 1)
	assert.equal(getSceneryWindFade(70, range), 1)
	assert.equal(getSceneryWindFade(115, range), 0.5)
	assert.equal(getSceneryWindFade(160, range), 0)
	assert.equal(getSceneryWindFade(400, range), 0)
})

test('only the trees feel the wind, the palms most and the round trees least', () => {
	const sensitivity = getSceneryWindSensitivities(createSceneryWindSettings())
	assert.equal(sensitivity.length, IMPOSTOR_TYPE_COUNT)
	const { ROUND_TREE, CONIFER, PALM } = IMPOSTOR_TYPE
	assert.ok(sensitivity[ROUND_TREE] > 0)
	assert.ok(sensitivity[ROUND_TREE] < sensitivity[CONIFER])
	assert.ok(sensitivity[CONIFER] < sensitivity[PALM])
	sensitivity.forEach((value, type) => {
		if (![ROUND_TREE, CONIFER, PALM].includes(type)) assert.equal(value, 0, `type ${type}`)
	})
	const negative = createSceneryWindSettings()
	negative.sensitivity.palm = -1
	assert.equal(getSceneryWindSensitivities(negative)[PALM], 0)
})

test('the wind direction is a unit XZ vector from +X toward +Z', () => {
	const close = (actual, expected) =>
		actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-9))
	close(getSceneryWindDirection(0), [1, 0])
	close(getSceneryWindDirection(90), [0, 1])
	close(getSceneryWindDirection(180), [-1, 0])
	const [x, z] = getSceneryWindDirection(SCENERY_WIND_DEFAULTS.direction)
	assert.ok(Math.abs(Math.hypot(x, z) - 1) < 1e-9)
})
