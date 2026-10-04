import assert from 'node:assert/strict'
import test from 'node:test'
import {
	advanceTimeOfDay,
	copyKeyframe,
	createDayNightPalette,
	createDayNightState,
	DAY_NIGHT_DEFAULTS,
	getApparentElevation,
	getCelestialDirections,
	getDayNightState,
	getHorizonDip,
	getPaletteTime,
	getTimeOfDayForPaletteTime,
	parseTimeOfDay,
	wrapTimeOfDay,
} from '../src/dayNightPolicy.js'

function assertClose(actual, expected, tolerance = 1e-6) {
	assert.ok(
		Math.abs(actual - expected) <= tolerance,
		`expected ${actual} to be within ${tolerance} of ${expected}`,
	)
}

const CURVATURE = 3000
// Horizon dip seen from roughly the cruise camera height.
const CRUISE_DIP = getHorizonDip(70, CURVATURE)

function length([x, y, z]) {
	return Math.hypot(x, y, z)
}

test('advances and wraps the time of day in both directions', () => {
	assertClose(advanceTimeOfDay(0.5, 60, 240), 0.75)
	assertClose(advanceTimeOfDay(0.9, 48, 240), 0.1)
	assertClose(advanceTimeOfDay(0.1, -48, 240), 0.9)
	assertClose(advanceTimeOfDay(0.2, 240 * 3, 240), 0.2)
	assert.equal(advanceTimeOfDay(0.4, 10, 0), 0.4)
	assert.equal(wrapTimeOfDay(1), 0)
	assert.equal(wrapTimeOfDay(-1e-18), 0)
})

test('keeps celestial directions unit length and opposite', () => {
	for (let step = 0; step <= 20; step++) {
		const { sun, moon } = getCelestialDirections(step / 20)
		assertClose(length(sun), 1)
		assertClose(length(moon), 1)
		for (let axis = 0; axis < 3; axis++) assertClose(sun[axis], -moon[axis])
	}
})

test('places the sun at the zenith arc at noon and below at midnight', () => {
	const noon = getCelestialDirections(0.5)
	const midnight = getCelestialDirections(0)
	const sunrise = getCelestialDirections(0.25)
	assert.ok(noon.sun[1] > 0.8)
	assert.ok(midnight.sun[1] < -0.8)
	assertClose(sunrise.sun[1], 0)
	assert.ok(sunrise.sun[0] > 0.99)
})

test('orders keyframes inside one day', () => {
	const { keyframes } = DAY_NIGHT_DEFAULTS
	for (let index = 0; index < keyframes.length; index++) {
		assert.ok(keyframes[index].t >= 0 && keyframes[index].t < 1)
		if (index > 0) assert.ok(keyframes[index].t > keyframes[index - 1].t)
	}
})

test('is continuous across midnight', () => {
	const start = getDayNightState(0)
	const end = getDayNightState(1 - 1e-7)
	for (const field of ['zenith', 'horizon', 'atmosphere', 'trailTint']) {
		for (let channel = 0; channel < 3; channel++) {
			assertClose(start[field][channel], end[field][channel], 1e-4)
		}
	}
	assertClose(start.night, end.night, 1e-4)
	assertClose(start.sunIntensity, end.sunIntensity, 1e-4)
	assertClose(start.moonIntensity, end.moonIntensity, 1e-4)
})

test('matches a keyframe exactly at its time', () => {
	const noon = DAY_NIGHT_DEFAULTS.keyframes.find((frame) => frame.t === 0.5)
	const state = getDayNightState(0.5)
	assert.deepEqual(state.horizon, noon.horizon)
	assert.equal(state.night, 0)
	assert.equal(state.stars, 0)
})

test('computes the curved-world horizon dip from height', () => {
	assert.equal(getHorizonDip(0, CURVATURE), 0)
	assert.equal(getHorizonDip(-20, CURVATURE), 0)
	assert.equal(getHorizonDip(70, 0), 0)
	assertClose(getHorizonDip(70, CURVATURE), Math.sqrt((2 * 70) / CURVATURE), 5e-3)
	assert.ok(getHorizonDip(100, CURVATURE) > getHorizonDip(50, CURVATURE))
	assertClose(getApparentElevation(0, CRUISE_DIP), CRUISE_DIP)
	assertClose(getApparentElevation(-Math.sin(CRUISE_DIP), CRUISE_DIP), 0)
})

test('keeps palette time as the identity on a flat horizon', () => {
	for (let step = 0; step < 40; step++) {
		assertClose(getPaletteTime(step / 40, 0), step / 40, 1e-9)
	}
})

test('aligns palette sunrise and sunset with the dipped horizon', () => {
	for (const crossing of [0.25, 0.75]) {
		// Find the real time at which the sun meets the apparent horizon.
		let time = crossing
		const direction = crossing === 0.25 ? -1 : 1
		while (getApparentElevation(getCelestialDirections(time).sun[1], CRUISE_DIP) > 0) {
			time += direction * 1e-5
		}
		assertClose(getPaletteTime(time, CRUISE_DIP), crossing, 1e-4)
	}
	assertClose(getPaletteTime(0.5, CRUISE_DIP), 0.5, 1e-9)
	assertClose(getPaletteTime(0, CRUISE_DIP), 0, 1e-9)
})

test('keeps palette time continuous and monotonic with a dip', () => {
	let previous = getPaletteTime(0, CRUISE_DIP)
	for (let step = 1; step <= 1000; step++) {
		const current = getPaletteTime(step / 1000, CRUISE_DIP)
		const delta = step === 1000 ? current + 1 - previous : current - previous
		assert.ok(delta > 0 && delta < 0.005, `jump at ${step / 1000}: ${delta}`)
		previous = step === 1000 ? current + 1 : current
	}
})

test('inverts palette time at any dip', () => {
	for (const dip of [0, CRUISE_DIP, getHorizonDip(150, CURVATURE)]) {
		for (let step = 0; step < 100; step++) {
			const timeOfDay = step / 100
			const paletteTime = getPaletteTime(timeOfDay, dip)
			assertClose(getTimeOfDayForPaletteTime(paletteTime, dip), timeOfDay, 1e-9)
		}
	}
	for (const { t } of DAY_NIGHT_DEFAULTS.keyframes) {
		const timeOfDay = getTimeOfDayForPaletteTime(t, CRUISE_DIP)
		assertClose(getPaletteTime(timeOfDay, CRUISE_DIP), t, 1e-9)
	}
})

test('edits a palette copy without touching the defaults', () => {
	const palette = createDayNightPalette()
	const noonIndex = DAY_NIGHT_DEFAULTS.keyframes.findIndex((frame) => frame.t === 0.5)
	const defaultHorizon = [...DAY_NIGHT_DEFAULTS.keyframes[noonIndex].horizon]
	assert.deepEqual(palette, DAY_NIGHT_DEFAULTS.keyframes)

	palette[noonIndex].horizon[0] = 0.123
	palette[noonIndex].sunIntensity = 0.5
	assert.deepEqual(DAY_NIGHT_DEFAULTS.keyframes[noonIndex].horizon, defaultHorizon)
	const options = { ...DAY_NIGHT_DEFAULTS, keyframes: palette }
	const state = getDayNightState(0.5, options)
	assert.equal(state.horizon[0], 0.123)
	assert.equal(state.sunIntensity < getDayNightState(0.5).sunIntensity, true)

	const horizon = palette[noonIndex].horizon
	copyKeyframe(DAY_NIGHT_DEFAULTS.keyframes[noonIndex], palette[noonIndex])
	assert.equal(palette[noonIndex].horizon, horizon)
	assert.deepEqual(palette, DAY_NIGHT_DEFAULTS.keyframes)
})

test('lights the world only while each body is above the apparent horizon', () => {
	for (const crossing of [0.25, 0.75]) {
		// On a flat horizon each body is off just below it (about -0.055 rad).
		const sunBelow = crossing === 0.25 ? crossing - 0.01 : crossing + 0.01
		const moonBelow = crossing === 0.25 ? crossing + 0.01 : crossing - 0.01
		assert.equal(getDayNightState(sunBelow).sunIntensity, 0)
		assert.equal(getDayNightState(moonBelow).moonIntensity, 0)
		// With a dip both bodies are above the dipped horizon at the flat crossing.
		const curved = getDayNightState(crossing, DAY_NIGHT_DEFAULTS, undefined, CRUISE_DIP)
		assert.ok(curved.sunIntensity > 0.1)
		assert.ok(curved.moonIntensity > 0.05)
	}
	const noon = getDayNightState(0.5, DAY_NIGHT_DEFAULTS, undefined, CRUISE_DIP)
	const midnight = getDayNightState(0, DAY_NIGHT_DEFAULTS, undefined, CRUISE_DIP)
	assert.ok(noon.sunIntensity > 1)
	assert.equal(noon.moonIntensity, 0)
	assert.equal(midnight.sunIntensity, 0)
	assert.ok(midnight.moonIntensity > 0.1)
})

test('reuses the provided output state', () => {
	const out = createDayNightState()
	const horizon = out.horizon
	assert.equal(getDayNightState(0.3, DAY_NIGHT_DEFAULTS, out), out)
	assert.equal(out.horizon, horizon)
})

test('parses the time URL parameter', () => {
	const parse = (query) => parseTimeOfDay(new URLSearchParams(query))
	assert.equal(parse('time=0.5'), 0.5)
	assert.equal(parse('time=0'), 0)
	assert.equal(parse('time=1'), 0)
	assert.equal(parse('time=1.5'), null)
	assert.equal(parse('time=-0.1'), null)
	assert.equal(parse('time=noon'), null)
	assert.equal(parse('time='), null)
	assert.equal(parse(''), null)
})
