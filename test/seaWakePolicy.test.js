import assert from 'node:assert/strict'
import test from 'node:test'
import { SEA_SURFACE_Y } from '../src/chunkGeometry.js'
import {
	SEA_WAKE_MAP_SIZES,
	addSeaWakeStamp,
	advanceSeaWakeOccupancy,
	clearSeaWakeOccupancy,
	createSeaWakeOccupancy,
	createSeaWakeSettings,
	getSeaWakeAltitude,
	getSeaWakeBound,
	getSeaWakeDecay,
	getSeaWakeFadeRange,
	getSeaWakeFoamSpread,
	getSeaWakeLineWavenumber,
	getSeaWakeOccupiedRect,
	getSeaWakePulse,
	getSeaWakePulsePhase,
	getSeaWakeRollBoost,
	getSeaWakeSettleTime,
	getSeaWakeSpeedWidth,
	getSeaWakeStampGains,
	getSeaWakeSteps,
	getSeaWakeStrength,
	getSeaWakeTexel,
	getSeaWakeTexelPoint,
	getSeaWakeWaveSpeed,
	getSeaWakeWindow,
	isSeaWakeStepDue,
} from '../src/seaWakePolicy.js'

const BOOST_SPEED = 35 * 3

test('desktop and mobile settings keep about a world unit or two per texel', () => {
	for (const isMobile of [false, true]) {
		const settings = createSeaWakeSettings({ isMobile })
		const texel = getSeaWakeTexel(settings)
		assert.ok(texel > 0.5 && texel < 2.5, `texel ${texel}`)
		assert.ok(SEA_WAKE_MAP_SIZES.includes(settings.mapSize))
		// About four texels per ripple wavelength or more.
		const wavelength = (2 * Math.PI) / getSeaWakeLineWavenumber(settings)
		assert.ok(wavelength / texel >= 4, `wavelength ${wavelength}`)
	}
	assert.equal(createSeaWakeSettings({ isMobile: true }).shading.vertexAmplitude, 0)
	assert.ok(createSeaWakeSettings().shading.vertexAmplitude > 0)
})

test('creates fresh nested settings', () => {
	const a = createSeaWakeSettings()
	const b = createSeaWakeSettings()
	assert.notEqual(a, b)
	for (const key of [
		'altitude',
		'steps',
		'trail',
		'waves',
		'foam',
		'lines',
		'shading',
		'roll',
		'speed',
		'occupancy',
	]) {
		assert.notEqual(a[key], b[key], key)
	}
	a.trail.impulse = 99
	assert.notEqual(createSeaWakeSettings().trail.impulse, 99)
	// The mobile preset overrides one key of a group and keeps the others.
	const mobile = createSeaWakeSettings({ isMobile: true })
	assert.equal(mobile.trail.radius, a.trail.radius)
	assert.notEqual(mobile.trail.pulseSpacing, a.trail.pulseSpacing)
})

test('snaps the window to whole texels and scrolls by whole texels', () => {
	const settings = createSeaWakeSettings()
	const texel = getSeaWakeTexel(settings)
	const first = getSeaWakeWindow(123.456, -987.654, settings)
	assert.equal(first.reset, true)
	assert.equal(first.shiftX, 0)
	assert.ok(Math.abs(first.x - 123.456) <= texel / 2 + 1e-9)
	assert.ok(Math.abs(first.z + 987.654) <= texel / 2 + 1e-9)
	assert.ok(Math.abs(first.x / texel - Math.round(first.x / texel)) < 1e-9)

	const next = getSeaWakeWindow(123.456 + texel * 3.2, -987.654 - texel, settings, first)
	assert.equal(next.reset, false)
	assert.equal(next.shiftX, 3)
	assert.equal(next.shiftZ, -1)
	// A jump across the map, or a new texel size, starts over.
	assert.equal(
		getSeaWakeWindow(first.x + settings.radius * 2, first.z, settings, first).reset,
		true,
	)
	const coarser = { ...settings, mapSize: settings.mapSize / 2 }
	assert.equal(getSeaWakeWindow(first.x, first.z, coarser, first).reset, true)

	// The airplane stays within half a texel of the map's center.
	const point = getSeaWakeTexelPoint(123.456, -987.654, first)
	assert.ok(Math.abs(point.x - settings.mapSize / 2) <= 0.5 + 1e-9)
	assert.ok(Math.abs(point.y - settings.mapSize / 2) <= 0.5 + 1e-9)
})

test('stamps low over open water only', () => {
	const settings = createSeaWakeSettings()
	const { full, none } = settings.altitude
	assert.equal(getSeaWakeStrength(full, 10, settings), 1)
	assert.equal(getSeaWakeStrength(none, 10, settings), 0)
	const middle = getSeaWakeStrength((full + none) / 2, 10, settings)
	assert.ok(middle > 0 && middle < 1)
	assert.equal(getSeaWakeStrength(full, 0, settings), 0)
	assert.equal(getSeaWakeStrength(full, -5, settings), 0)
	assert.equal(getSeaWakeStrength(full, 10, { ...settings, enabled: false }), 0)
	assert.equal(getSeaWakeAltitude(SEA_SURFACE_Y + 12), 12)
})

test('steps once per frame at 60 and 120 Hz, more after a long frame, none without time', () => {
	const settings = createSeaWakeSettings()
	const steps = {}
	for (let frame = 0; frame < 10000; frame++) {
		getSeaWakeSteps(1 / 60, settings, steps)
		assert.equal(steps.count, 1)
	}
	assert.equal(getSeaWakeSteps(1 / 120, settings).count, 1)
	assert.equal(getSeaWakeSteps(0.016, settings).count, 1)
	assert.equal(getSeaWakeSteps(1 / 30, settings).count, 2)
	const hitch = getSeaWakeSteps(1, settings)
	assert.equal(hitch.count, settings.steps.maxSteps)
	assert.equal(getSeaWakeSteps(0, settings).count, 0)
	assert.equal(getSeaWakeSteps(-0.1, settings).count, 0)
})

test('takes more steps to keep fast waves stable instead of slowing them', () => {
	const settings = createSeaWakeSettings()
	const texel = getSeaWakeTexel(settings)
	const share = Math.sin((settings.waves.angle * Math.PI) / 180)
	// The measured boost reaches about 155 units per second.
	const fast = 155 * share
	const plan = getSeaWakeSteps(0.016, settings, {}, fast, texel)
	assert.equal(plan.count, 2)
	const waves = getSeaWakeWaveSpeed(155, texel, plan.stepTime, settings)
	assert.equal(waves.clamped, false)
	assert.equal(getSeaWakeSteps(0.016, settings, {}, 35 * share, texel).count, 1)
	// Never beyond maxSteps.
	assert.equal(getSeaWakeSteps(0.016, settings, {}, 1e4, texel).count, settings.steps.maxSteps)
})

test('keeps the waves stable at every preset, resolution, and speed', () => {
	for (const isMobile of [false, true]) {
		for (const mapSize of SEA_WAKE_MAP_SIZES) {
			const settings = { ...createSeaWakeSettings({ isMobile }), mapSize }
			const texel = getSeaWakeTexel(settings)
			for (const deltaTime of [1 / 120, 1 / 60, 0.016, 1 / 30, 0.1]) {
				const { stepTime } = getSeaWakeSteps(deltaTime, settings)
				for (const speed of [0, 35, BOOST_SPEED]) {
					const waves = getSeaWakeWaveSpeed(speed, texel, stepTime, settings)
					assert.ok(waves.courant <= settings.waves.maxCourant + 1e-9)
					assert.ok(waves.courant < Math.SQRT1_2)
				}
			}
		}
	}
})

test('runs the waves at a fixed share of the airplane speed, so the V keeps its angle', () => {
	const settings = createSeaWakeSettings()
	const texel = getSeaWakeTexel(settings)
	const share = Math.sin((settings.waves.angle * Math.PI) / 180)
	for (const speed of [35, -35, BOOST_SPEED]) {
		const waves = getSeaWakeWaveSpeed(speed, texel, 1 / 60, settings)
		assert.ok(Math.abs(waves.speed - Math.abs(speed) * share) < 1e-9)
		assert.equal(waves.clamped, false)
	}
	assert.equal(getSeaWakeWaveSpeed(0, texel, 1 / 60, settings).speed, settings.waves.minSpeed)
	const capped = getSeaWakeWaveSpeed(BOOST_SPEED, texel, 0.1, settings)
	assert.equal(capped.clamped, true)
})

test('decays by half every half-life and spreads the foam stably', () => {
	assert.ok(Math.abs(getSeaWakeDecay(1.2, 1.2) - 0.5) < 1e-12)
	assert.ok(Math.abs(getSeaWakeDecay(1.2, 0.6) ** 2 - 0.5) < 1e-12)
	assert.equal(getSeaWakeDecay(0, 1 / 60), 0)
	assert.equal(getSeaWakeDecay(1, 0), 1)
	const spread = getSeaWakeFoamSpread(3.5, 1 / 60, 1.25)
	assert.ok(spread > 0 && spread < 1)
	// Twice the steps of half the length spread as far.
	assert.ok(Math.abs(getSeaWakeFoamSpread(3.5, 1 / 120, 1.25) * 2 - spread) < 1e-12)
	assert.equal(getSeaWakeFoamSpread(1e6, 1, 0.1), 1)
	assert.equal(getSeaWakeFoamSpread(-1, 1, 1), 0)
})

test('pulses with the distance flown', () => {
	const settings = createSeaWakeSettings()
	const { pulseSpacing } = settings.trail
	const at = (distance) => getSeaWakePulse(getSeaWakePulsePhase(distance, settings), settings)
	assert.ok(Math.abs(at(5) - at(5 + pulseSpacing)) < 1e-9)
	assert.equal(getSeaWakePulse(1, { trail: { pulseMix: 0 } }), -1)
	assert.equal(getSeaWakePulse(Math.PI / 2, { trail: { pulseMix: 1 } }), 1)
	for (let distance = 0; distance < pulseSpacing; distance += 0.5) {
		assert.ok(at(distance) >= -1 && at(distance) <= 1)
	}
})

test('orders the readers fade inside the map and starts the sponge before its end', () => {
	const settings = createSeaWakeSettings()
	const range = getSeaWakeFadeRange(settings)
	assert.ok(range.start < range.end && range.end < 1)
	assert.ok(1 - settings.waves.spongeWidth <= range.end)
	const flipped = getSeaWakeFadeRange({ shading: { fadeStart: 0.9, fadeEnd: 0.5 } })
	assert.ok(flipped.start < flipped.end)
	assert.ok(getSeaWakeFadeRange({ shading: { fadeStart: 0, fadeEnd: 2 } }).end <= 1)
})

test('bounds the vertex displacement while enabled', () => {
	const settings = createSeaWakeSettings()
	assert.equal(getSeaWakeBound(settings), settings.shading.vertexAmplitude)
	assert.equal(getSeaWakeBound({ ...settings, enabled: false }), 0)
	assert.equal(getSeaWakeBound(undefined), 0)
})

test('tracks a conservative occupied rectangle that empties once settled', () => {
	const settings = createSeaWakeSettings()
	const window = getSeaWakeWindow(0, 0, settings)
	const occupancy = createSeaWakeOccupancy(8)
	const { interval } = settings.occupancy
	const settle = getSeaWakeSettleTime(settings)
	assert.ok(settle > settings.foam.halfLife)
	assert.equal(getSeaWakeOccupiedRect(occupancy, window, 1).empty, true)

	addSeaWakeStamp(occupancy, 0, 0, 1, 2, 3, interval)
	let rect = getSeaWakeOccupiedRect(occupancy, window, 1)
	assert.equal(rect.empty, false)
	assert.deepEqual([rect.minX, rect.minZ, rect.maxX, rect.maxZ], [-4, -4, 5, 6])

	// Grows at the waves' speed.
	advanceSeaWakeOccupancy(occupancy, 0.5, 10, settle)
	rect = getSeaWakeOccupiedRect(occupancy, window, 1)
	assert.deepEqual([rect.minX, rect.maxZ], [-9, 11])

	// Stays clipped to the window.
	advanceSeaWakeOccupancy(occupancy, settle / 2, 1000, settle)
	rect = getSeaWakeOccupiedRect(occupancy, window, 1)
	assert.equal(rect.minX, window.x - window.halfSize)
	assert.equal(rect.maxZ, window.z + window.halfSize)

	// Empties after its settle time, and on a clear.
	advanceSeaWakeOccupancy(occupancy, settle, 10, settle)
	assert.equal(getSeaWakeOccupiedRect(occupancy, window, 1).empty, true)
	addSeaWakeStamp(occupancy, 0, 0, 1, 1, 1, interval)
	clearSeaWakeOccupancy(occupancy)
	assert.equal(getSeaWakeOccupiedRect(occupancy, window, 1).empty, true)
})

test('opens a box per interval and merges the oldest when full, still covering every stamp', () => {
	const settings = createSeaWakeSettings()
	const window = getSeaWakeWindow(0, 0, settings)
	const occupancy = createSeaWakeOccupancy(4)
	const { interval } = settings.occupancy
	const stamps = []
	for (let index = 0; index < 20; index++) {
		const x = index * 4
		addSeaWakeStamp(occupancy, x, 0, x + 4, 1, 2, interval)
		stamps.push([x - 2, -2, x + 6, 3])
		advanceSeaWakeOccupancy(occupancy, interval, 5, 100)
	}
	assert.ok(occupancy.boxes.length <= 4)
	const rect = getSeaWakeOccupiedRect(occupancy, window, 0)
	for (const [minX, minZ, maxX, maxZ] of stamps) {
		assert.ok(rect.minX <= minX && rect.minZ <= minZ && rect.maxX >= maxX && rect.maxZ >= maxZ)
	}
	// A box stamped again restarts its settling.
	const fresh = createSeaWakeOccupancy()
	addSeaWakeStamp(fresh, 0, 0, 0, 0, 1, 10)
	advanceSeaWakeOccupancy(fresh, 3, 0, 4)
	addSeaWakeStamp(fresh, 0, 0, 0, 0, 1, 10)
	advanceSeaWakeOccupancy(fresh, 3, 0, 4)
	assert.equal(fresh.boxes.length, 1)
})

test('advances at most at the step rate, every 60 Hz frame and every other 120 Hz one', () => {
	const settings = createSeaWakeSettings()
	const due = (frame, frames) => {
		let pending = 0
		let count = 0
		for (let index = 0; index < frames; index++) {
			pending += frame
			if (isSeaWakeStepDue(pending, settings)) {
				count++
				pending = 0
			}
		}
		return count
	}
	// The flight's own step at 60 Hz is clamped to 0.016 s.
	assert.equal(due(0.016, 600), 600)
	assert.equal(due(1 / 60, 600), 600)
	assert.equal(due(1 / 120, 1200), 600)
	assert.equal(isSeaWakeStepDue(0, settings), false)
	// Rate 0 advances every frame.
	const everyFrame = { ...settings, steps: { ...settings.steps, rate: 0 } }
	assert.equal(isSeaWakeStepDue(1 / 240, everyFrame), true)
})

test('an aileron roll boosts the stamp with its speed and the boost fades after it', () => {
	const settings = createSeaWakeSettings()
	const { fullRate, halfLife } = settings.roll
	assert.equal(getSeaWakeRollBoost(0, 0, 1 / 60, settings), 0)
	assert.equal(getSeaWakeRollBoost(0, fullRate, 1 / 60, settings), 1)
	assert.equal(getSeaWakeRollBoost(0, -fullRate * 2, 1 / 60, settings), 1)
	const half = getSeaWakeRollBoost(0, fullRate / 2, 1 / 60, settings)
	assert.ok(half > 0 && half < 1)
	// Once the roll slows, it halves every half-life instead of dropping.
	assert.ok(Math.abs(getSeaWakeRollBoost(1, 0, halfLife, settings) - 0.5) < 1e-12)
	let boost = 1
	for (let frame = 0; frame < 60; frame++) boost = getSeaWakeRollBoost(boost, 0, 1 / 60, settings)
	assert.ok(boost < 0.1)
	// Without a roll the stamp keeps its gains; a full roll scales all three.
	const plain = getSeaWakeStampGains(0, settings.speed.slow, settings)
	assert.deepEqual(plain, { width: 1, foam: 1, kick: 1 })
	const rolled = getSeaWakeStampGains(1, settings.speed.slow, settings)
	assert.equal(rolled.width, settings.roll.width)
	assert.equal(rolled.foam, settings.roll.foam)
	assert.equal(rolled.kick, settings.roll.kick)
})

test('the trail widens with the speed, from cruise to a full boost', () => {
	const settings = createSeaWakeSettings()
	const { slow, fast, width } = settings.speed
	assert.equal(getSeaWakeSpeedWidth(0, settings), 1)
	assert.equal(getSeaWakeSpeedWidth(slow, settings), 1)
	assert.equal(getSeaWakeSpeedWidth(fast, settings), width)
	assert.equal(getSeaWakeSpeedWidth(fast * 2, settings), width)
	assert.ok(Math.abs(getSeaWakeSpeedWidth((slow + fast) / 2, settings) - (1 + width) / 2) < 1e-12)
	// The roll's width multiplies the speed's.
	const both = getSeaWakeStampGains(1, fast, settings)
	assert.ok(Math.abs(both.width - width * settings.roll.width) < 1e-12)
})
