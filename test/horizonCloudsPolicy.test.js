import assert from 'node:assert/strict'
import test from 'node:test'
import { getDayNightState, getHorizonDip } from '../src/dayNightPolicy.js'
import {
	HORIZON_CLOUD_DEFAULTS,
	HORIZON_CLOUD_MAX_OCTAVES,
	HORIZON_CLOUD_NOISE_ABS_MEAN,
	HORIZON_CLOUD_NOISE_SPREAD,
	HORIZON_CLOUD_QUALITY,
	copyHorizonCloudSettings,
	createHorizonCloudMotion,
	createHorizonCloudSettings,
	getCoverageThreshold,
	getHorizonCloudBand,
	getHorizonCloudBankRadius,
	getHorizonCloudBillowReach,
	getHorizonCloudCoverage,
	getHorizonCloudOctaves,
	getHorizonCloudRepeats,
	getHorizonCloudWeather,
	parseHorizonCloudCoverage,
	selectHorizonCloudLight,
	stepHorizonCloudMotion,
} from '../src/horizonCloudsPolicy.js'
import {
	createNoiseGradients,
	NOISE_GAIN,
	NOISE_TILE_CELLS,
	sampleGradientNoise,
} from '../src/noiseTexturePolicy.js'

const DEGREE = Math.PI / 180

function assertClose(actual, expected, tolerance = 1e-9) {
	assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected}`)
}

// The baked tile's value of `channel` at tile coordinates (u, v), as the
// shaders read it (generateNoiseTile() without the 8-bit rounding).
const gradients = [0, 1].map((channel) => createNoiseGradients(channel))
function tile(channel, u, v) {
	const value = sampleGradientNoise(gradients[channel], u * NOISE_TILE_CELLS, v * NOISE_TILE_CELLS)
	return Math.min(Math.max(value * NOISE_GAIN, -1), 1)
}

test('settings are fresh copies with the device quality and the fixed coverage', () => {
	const desktop = createHorizonCloudSettings()
	const mobile = createHorizonCloudSettings({ isMobile: true, fixedCoverage: 0.4 })
	assert.deepEqual(desktop.quality, HORIZON_CLOUD_QUALITY.desktop)
	assert.deepEqual(mobile.quality, HORIZON_CLOUD_QUALITY.mobile)
	assert.equal(desktop.coverage.fixed, null)
	assert.equal(mobile.coverage.fixed, 0.4)
	desktop.repeats.billows[0] = 9
	desktop.light.bands[0] = 0.9
	assert.equal(
		HORIZON_CLOUD_DEFAULTS.repeats.billows[0],
		createHorizonCloudSettings().repeats.billows[0],
	)
	assert.equal(createHorizonCloudSettings().light.bands[0], HORIZON_CLOUD_DEFAULTS.light.bands[0])
	assert.ok(mobile.quality.octaves < desktop.quality.octaves)
})

test('a reset copies the defaults in place, keeping the nested objects', () => {
	const settings = createHorizonCloudSettings()
	const { shape, light } = settings
	const bands = light.bands
	shape.maxTop = 30
	bands[1] = 0.1
	settings.enabled = false
	copyHorizonCloudSettings(createHorizonCloudSettings(), settings)
	assert.equal(settings.shape, shape)
	assert.equal(settings.light.bands, bands)
	assert.deepEqual(settings, createHorizonCloudSettings())
})

test('parses ?clouds= as a fixed coverage share', () => {
	const parse = (query) => parseHorizonCloudCoverage(new URLSearchParams(query))
	assert.equal(parse(''), null)
	assert.equal(parse('clouds=0.3'), 0.3)
	assert.equal(parse('clouds=4'), 1)
	assert.equal(parse('clouds=-1'), 0)
	assert.equal(parse('clouds=many'), null)
	assert.equal(getHorizonCloudCoverage(100, createHorizonCloudSettings(), 0.3), 0.3)
})

test('tile repeats are whole numbers of at least one, and octaves stay in range', () => {
	assert.equal(getHorizonCloudRepeats(4.6), 5)
	assert.equal(getHorizonCloudRepeats(0), 1)
	assert.equal(getHorizonCloudRepeats('x'), 1)
	assert.deepEqual(getHorizonCloudOctaves({ octaves: 9, lightOctaves: 9 }), {
		octaves: HORIZON_CLOUD_MAX_OCTAVES,
		lightOctaves: HORIZON_CLOUD_MAX_OCTAVES,
	})
	assert.deepEqual(getHorizonCloudOctaves({ octaves: 2, lightOctaves: 3 }), {
		octaves: 2,
		lightOctaves: 2,
	})
	assert.deepEqual(getHorizonCloudOctaves({ octaves: 0, lightOctaves: -1 }), {
		octaves: 1,
		lightOctaves: 0,
	})
})

test('the bank circle crosses the requested cells over a turn', () => {
	for (const cells of [3, 14, 27.5]) {
		const radius = getHorizonCloudBankRadius(cells)
		assertClose(2 * Math.PI * radius * NOISE_TILE_CELLS, cells, 1e-9)
	}
	// The circle closes on itself: a turn later the shaders read the same texel.
	const radius = getHorizonCloudBankRadius(14)
	const at = (azimuth) =>
		tile(0, 0.5 + radius * Math.cos(azimuth), 0.5 + radius * Math.sin(azimuth))
	for (const azimuth of [-3, -0.4, 1.2, 2.9])
		assertClose(at(azimuth), at(azimuth + 2 * Math.PI), 1e-9)
})

test('the billow octaves wrap seamlessly around the turn', () => {
	// The azimuth jumps by a turn across atan()'s seam; whole repeats keep the
	// tile coordinate's fraction.
	for (const repeats of HORIZON_CLOUD_DEFAULTS.repeats.billows) {
		const tilesPerRadian = repeats / (2 * Math.PI)
		for (const elevation of [0, 0.05, 0.2]) {
			const u = -Math.PI * tilesPerRadian + 0.137
			const wrapped = Math.PI * tilesPerRadian + 0.137
			assertClose(
				tile(0, u, elevation * tilesPerRadian),
				tile(0, wrapped, elevation * tilesPerRadian),
				1e-9,
			)
		}
	}
})

test('the coverage threshold leaves about the requested share of the horizon covered', () => {
	assertClose(getCoverageThreshold(0.5), 0, 1e-6)
	assert.ok(getCoverageThreshold(0.2) > 0 && getCoverageThreshold(0.8) < 0)
	assertClose(getCoverageThreshold(0.2), -getCoverageThreshold(0.8), 1e-6)
	assert.ok(Number.isFinite(getCoverageThreshold(0)) && Number.isFinite(getCoverageThreshold(1)))

	// Measured on the tile along several bank circles, with the morph mix.
	const radius = getHorizonCloudBankRadius(14)
	const samples = []
	for (let circle = 0; circle < 24; circle++) {
		const center = [0.07 + (circle % 6) * 0.15, 0.11 + Math.floor(circle / 6) * 0.22]
		const morph = circle * 0.7
		for (let step = 0; step < 720; step++) {
			const azimuth = (step / 720) * 2 * Math.PI
			const u = center[0] + radius * Math.cos(azimuth)
			const v = center[1] + radius * Math.sin(azimuth)
			samples.push(tile(0, u, v) * Math.cos(morph) + tile(1, u, v) * Math.sin(morph))
		}
	}
	const spread = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length)
	assertClose(spread, HORIZON_CLOUD_NOISE_SPREAD, 0.05)
	const absMean = samples.reduce((sum, value) => sum + Math.abs(value), 0) / samples.length
	assertClose(absMean, HORIZON_CLOUD_NOISE_ABS_MEAN, 0.04)
	for (const coverage of [0.25, 0.45, 0.7]) {
		const threshold = getCoverageThreshold(coverage)
		const covered = samples.filter((value) => value > threshold).length / samples.length
		assertClose(covered, coverage, 0.08)
	}
})

test('the weather drifts smoothly within its range', () => {
	const { period } = HORIZON_CLOUD_DEFAULTS.coverage
	let previous = getHorizonCloudWeather(0, period)
	let lowest = 1
	let highest = 0
	for (let time = 0.5; time < period * 20; time += 0.5) {
		const weather = getHorizonCloudWeather(time, period)
		assert.ok(weather >= 0 && weather <= 1)
		assert.ok(Math.abs(weather - previous) < 0.01, `jump at ${time}`)
		lowest = Math.min(lowest, weather)
		highest = Math.max(highest, weather)
		previous = weather
	}
	assert.ok(highest - lowest > 0.5, 'it varies over the periods')
	const settings = createHorizonCloudSettings()
	for (const time of [0, 100, 1000]) {
		const coverage = getHorizonCloudCoverage(time, settings)
		assert.ok(coverage >= settings.coverage.min && coverage <= settings.coverage.max)
	}
})

test('the motion accumulates and wraps, the same for the same steps, and freezes', () => {
	const settings = createHorizonCloudSettings()
	const a = createHorizonCloudMotion()
	const b = createHorizonCloudMotion()
	for (let frame = 0; frame < 6000; frame++) stepHorizonCloudMotion(a, 1 / 60, settings)
	for (let frame = 0; frame < 3000; frame++) stepHorizonCloudMotion(b, 1 / 30, settings)
	assertClose(a.time, 100, 1e-9)
	assertClose(a.wind, settings.motion.wind * DEGREE * 100, 1e-9)
	assertClose(a.wind, b.wind, 1e-9)
	assertClose(a.billowMorph, b.billowMorph, 1e-9)
	for (const rise of a.rise) assert.ok(rise >= 0 && rise < 1)

	settings.motion.wind = 720
	stepHorizonCloudMotion(a, 1, settings)
	assert.ok(a.wind >= 0 && a.wind < 2 * Math.PI)

	const frozen = { ...a, rise: [...a.rise] }
	stepHorizonCloudMotion(a, 1, { ...settings, paused: true })
	stepHorizonCloudMotion(a, -1, settings)
	assert.deepEqual(a, frozen)
})

test('the band holds every top the billows can lift', () => {
	const settings = createHorizonCloudSettings()
	const [bottom, top] = getHorizonCloudBand(settings)
	assert.ok(bottom < -settings.shape.baseDepth * DEGREE)
	const reach = getHorizonCloudBillowReach(settings)
	assert.ok(top >= settings.shape.maxTop * DEGREE + reach)
	// The lobes reach at most the clamped noise less its mean, over every octave.
	const { amplitude, gain } = settings.billows
	assertClose(
		reach,
		amplitude * DEGREE * (1 + gain + gain * gain) * (1 - HORIZON_CLOUD_NOISE_ABS_MEAN),
	)
	assert.ok(getHorizonCloudBillowReach(settings, 1) < reach)
})

test('the light is the sun by day and the moon by night, with no pop at the handover', () => {
	const dip = getHorizonDip(67, 3000)
	assert.equal(
		selectHorizonCloudLight(getDayNightState(0.5, undefined, undefined, dip)).light,
		'sun',
	)
	const midnight = selectHorizonCloudLight(getDayNightState(0, undefined, undefined, dip))
	assert.equal(midnight.light, 'moon')
	assert.ok(midnight.contrast > 0)

	let previous = null
	let handovers = 0
	for (let time = 0.6; time < 0.95; time += 0.0005) {
		const light = selectHorizonCloudLight(getDayNightState(time, undefined, undefined, dip))
		if (previous) {
			assert.ok(Math.abs(light.contrast - previous.contrast) < 0.05, `contrast jump at ${time}`)
			if (light.light !== previous.light) {
				handovers++
				assert.ok(light.contrast < 0.05 && previous.contrast < 0.05)
			}
		}
		previous = light
	}
	assert.equal(handovers, 1)
})
