import assert from 'node:assert/strict'
import test from 'node:test'
import {
	constrainDescentToMinimum,
	FLIGHT_LIMITS,
	createFlightCorridor,
	getFlightCorridor,
	getSafetyClimbSpeed,
	getNextSpeedEffect,
	getSpeedForEffect,
	getTerrainBrakeImpulse,
	getTerrainAdjustedSpeed,
	getTerrainSlowdown,
	getVerticalInput,
	smoothMinimumAltitude,
} from '../src/flightPolicy.js'

test('maps boost and braking to asymmetric speed changes', () => {
	assert.equal(getSpeedForEffect(55, 1), 165)
	assert.equal(getSpeedForEffect(55, 0), 55)
	assert.equal(getSpeedForEffect(55, -1), 52.25)
	assert.equal(getSpeedForEffect(55, 2), 165)
	assert.equal(getSpeedForEffect(55, -2), 52.25)
})

test('accentuates boosted-flight slowdown when high terrain requires a climb', () => {
	const safeAltitudeSlowdown = getTerrainSlowdown({
		speed: 165,
		baseSpeed: 55,
		currentTerrainHeight: 5,
		terrainCeiling: 35,
		altitude: 35,
		minimumAltitude: 35,
	})
	const climbingSlowdown = getTerrainSlowdown({
		speed: 165,
		baseSpeed: 55,
		currentTerrainHeight: 5,
		terrainCeiling: 35,
		altitude: 15,
		minimumAltitude: 35,
	})
	const severeClimbingSlowdown = getTerrainSlowdown({
		speed: 165,
		baseSpeed: 55,
		currentTerrainHeight: 5,
		terrainCeiling: 45,
		altitude: 15,
		minimumAltitude: 55,
	})

	assert.equal(
		getTerrainSlowdown({
			speed: 55,
			baseSpeed: 55,
			currentTerrainHeight: 5,
			terrainCeiling: 35,
			altitude: 15,
			minimumAltitude: 35,
		}),
		0,
	)
	assert.equal(
		getTerrainSlowdown({
			speed: 165,
			baseSpeed: 55,
			currentTerrainHeight: 5,
			terrainCeiling: 14,
			altitude: 15,
			minimumAltitude: 35,
		}),
		0,
	)
	assert.equal(safeAltitudeSlowdown, 0)
	assert.equal(climbingSlowdown, FLIGHT_LIMITS.maximumClimbTerrainSlowdown)
	assert.equal(severeClimbingSlowdown, FLIGHT_LIMITS.maximumSevereClimbTerrainSlowdown)
	assert.equal(
		getTerrainAdjustedSpeed({
			speed: 165,
			baseSpeed: 55,
			terrainSlowdown: climbingSlowdown,
		}),
		137.5,
	)
	assert.equal(
		getTerrainAdjustedSpeed({
			speed: 165,
			baseSpeed: 55,
			terrainSlowdown: severeClimbingSlowdown,
		}),
		115.5,
	)
	assert.equal(
		getTerrainAdjustedSpeed({
			speed: 52.25,
			baseSpeed: 55,
			terrainSlowdown: climbingSlowdown,
		}),
		52.25,
	)
})

test('creates a visible sub-wheel brake impulse for abrupt altitude jumps', () => {
	const mediumImpulse = getTerrainBrakeImpulse({
		speed: 165,
		baseSpeed: 55,
		currentMinimumAltitude: 15,
		minimumAltitude: 35,
		altitude: 15,
	})
	const maximumImpulse = getTerrainBrakeImpulse({
		speed: 165,
		baseSpeed: 55,
		currentMinimumAltitude: 15,
		minimumAltitude: 45,
		altitude: 15,
	})

	assert.equal(
		getTerrainBrakeImpulse({
			speed: 165,
			baseSpeed: 55,
			currentMinimumAltitude: null,
			minimumAltitude: 45,
			altitude: 15,
		}),
		0,
	)
	assert.equal(
		getTerrainBrakeImpulse({
			speed: 55,
			baseSpeed: 55,
			currentMinimumAltitude: 15,
			minimumAltitude: 45,
			altitude: 15,
		}),
		0,
	)
	assert.equal(
		getTerrainBrakeImpulse({
			speed: 165,
			baseSpeed: 55,
			currentMinimumAltitude: 15,
			minimumAltitude: 22,
			altitude: 15,
		}),
		0,
	)
	assert.equal(
		getTerrainBrakeImpulse({
			speed: 165,
			baseSpeed: 55,
			currentMinimumAltitude: 15,
			minimumAltitude: 45,
			altitude: 60,
		}),
		0,
	)
	assert.ok(mediumImpulse > 0)
	assert.ok(mediumImpulse < FLIGHT_LIMITS.maximumTerrainBrakeEffect)
	assert.equal(maximumImpulse, FLIGHT_LIMITS.maximumTerrainBrakeEffect)
	assert.equal(
		getTerrainAdjustedSpeed({
			speed: 165,
			baseSpeed: 55,
			terrainSlowdown: maximumImpulse,
		}),
		93.5,
	)
})

test('holds altitude between 45% and 65% of the screen', () => {
	assert.equal(getVerticalInput(0), 1)
	assert.equal(getVerticalInput(0.225), 0.5)
	assert.equal(getVerticalInput(0.45), 0)
	assert.equal(getVerticalInput(0.55), 0)
	assert.equal(getVerticalInput(0.6), 0)
	assert.equal(getVerticalInput(0.65), 0)
	assert.ok(Math.abs(getVerticalInput(0.825) + 0.5) < Number.EPSILON)
	assert.equal(getVerticalInput(1), -1)
})

test('cancels repeated descent at the minimum altitude without snapping upward', () => {
	assert.deepEqual(
		constrainDescentToMinimum({
			previousAltitude: 20,
			nextAltitude: 19.8,
			minimumAltitude: 20,
			verticalVelocity: -12,
		}),
		{ nextAltitude: 20, verticalVelocity: 0 },
	)
	assert.deepEqual(
		constrainDescentToMinimum({
			previousAltitude: 18,
			nextAltitude: 17.8,
			minimumAltitude: 20,
			verticalVelocity: -12,
		}),
		{ nextAltitude: 18, verticalVelocity: 0 },
	)
	assert.deepEqual(
		constrainDescentToMinimum({
			previousAltitude: 22,
			nextAltitude: 21.8,
			minimumAltitude: 20,
			verticalVelocity: -12,
		}),
		{ nextAltitude: 21.8, verticalVelocity: -12 },
	)
})

test('bases safety climb speed only on topographic relief', () => {
	const flat = getSafetyClimbSpeed({
		currentTerrainHeight: 5,
		terrainCeiling: 5,
	})
	const slope = getSafetyClimbSpeed({
		currentTerrainHeight: 5,
		terrainCeiling: 20,
	})
	const ridge = getSafetyClimbSpeed({
		currentTerrainHeight: 5,
		terrainCeiling: 45,
	})

	assert.equal(flat, FLIGHT_LIMITS.minimumSafetyClimbSpeed)
	assert.ok(slope > flat)
	assert.ok(slope < FLIGHT_LIMITS.maximumSafetyClimbSpeed)
	assert.equal(ridge, FLIGHT_LIMITS.maximumSafetyClimbSpeed)
})

test('the corridor is filled in place when an object is passed in', () => {
	const options = { x: 0, z: 0, forwardX: 0, forwardZ: 1, speed: 55, sampleHeight: () => 3 }
	const out = createFlightCorridor()
	const { samples } = out
	const first = samples[0]
	assert.equal(getFlightCorridor(options, out), out)
	assert.equal(out.samples, samples)
	assert.equal(out.samples[0], first)
	assert.deepEqual(
		getFlightCorridor({ ...options, x: 5 }, out),
		getFlightCorridor({ ...options, x: 5 }),
	)
	assert.equal(out.samples[0].x, 5)
})

test('samples four points at half range at cruise speed', () => {
	const sampledPositions = []
	const sampledHeights = [2, 12, 4, 18]
	const corridor = getFlightCorridor({
		x: 0,
		z: 0,
		forwardX: 0,
		forwardZ: 1,
		speed: 55,
		baseSpeed: 55,
		sampleHeight: (x, z) => {
			sampledPositions.push([x, z])
			return sampledHeights[sampledPositions.length - 1]
		},
	})

	assert.deepEqual(sampledPositions, [
		[0, 0],
		[0, 20.625],
		[0, 41.25],
		[0, 61.875],
	])
	assert.deepEqual(corridor.samples, [
		{ x: 0, z: 0, height: 2, distance: 0 },
		{ x: 0, z: 20.625, height: 12, distance: 20.625 },
		{ x: 0, z: 41.25, height: 4, distance: 41.25 },
		{ x: 0, z: 61.875, height: 18, distance: 61.875 },
	])
	assert.equal(corridor.lookAheadScale, 0.5)
	assert.equal(corridor.currentTerrainHeight, 2)
	assert.equal(corridor.nearTerrainHeight, 12)
	assert.equal(corridor.middleTerrainHeight, 4)
	assert.equal(corridor.farTerrainHeight, 18)
	assert.equal(corridor.terrainCeiling, 18)
	assert.equal(corridor.terrainClearance, 10)
	assert.equal(corridor.minimumAltitude, 28)
	assert.equal(corridor.collisionAltitude, 12)
})

test('uses the former cruise range only at maximum speed', () => {
	const cruise = getFlightCorridor({
		x: 0,
		z: 0,
		forwardX: 0,
		forwardZ: 1,
		speed: 55,
		baseSpeed: 55,
		sampleHeight: () => 7,
	})
	const maximumSpeed = getFlightCorridor({
		x: 0,
		z: 0,
		forwardX: 0,
		forwardZ: 1,
		speed: 165,
		baseSpeed: 55,
		sampleHeight: () => 7,
	})

	assert.equal(cruise.minimumAltitude, 17)
	assert.equal(maximumSpeed.minimumAltitude, cruise.minimumAltitude)
	assert.equal(maximumSpeed.terrainClearance, cruise.terrainClearance)
	assert.equal(cruise.lookAheadDistance, 61.875)
	assert.equal(maximumSpeed.nearLookAheadDistance, 41.25)
	assert.equal(maximumSpeed.middleLookAheadDistance, 82.5)
	assert.equal(maximumSpeed.lookAheadDistance, 123.75)
	assert.equal(maximumSpeed.lookAheadScale, 1)
})

test('smooths the minimum altitude faster upward than downward', () => {
	const rising = smoothMinimumAltitude({
		currentAltitude: 10,
		targetAltitude: 30,
		collisionAltitude: 10,
		deltaTime: 0.25,
	})
	const falling = smoothMinimumAltitude({
		currentAltitude: 30,
		targetAltitude: 10,
		collisionAltitude: 10,
		deltaTime: 0.25,
	})
	const collisionLimited = smoothMinimumAltitude({
		currentAltitude: 10,
		targetAltitude: 10,
		collisionAltitude: 18,
		deltaTime: 0.25,
	})

	assert.ok(rising > 10 && rising < 30)
	assert.ok(falling > 10 && falling < 30)
	assert.ok(rising - 10 > 30 - falling)
	assert.equal(collisionLimited, 18)
})

test('keeps the terrain corridor below the cloud-layer cap', () => {
	const corridor = getFlightCorridor({
		x: 0,
		z: 0,
		forwardX: 1,
		forwardZ: 0,
		speed: 165,
		sampleHeight: () => 90,
	})

	assert.equal(corridor.minimumAltitude, FLIGHT_LIMITS.maximumAltitude)
	assert.equal(corridor.collisionAltitude, FLIGHT_LIMITS.maximumAltitude)
	assert.equal(corridor.maximumAltitude, FLIGHT_LIMITS.maximumAltitude)
})

test('the wheel eases the speed effect toward its request, then it decays', () => {
	const dt = 1 / 60
	let effect = 0
	for (let frame = 0; frame < 12; frame++) effect = getNextSpeedEffect(effect, 1, dt)
	// About 95% of a boost after 0.2 s, like the former tween.
	assert.ok(effect > 0.93 && effect < 1)
	const held = effect
	effect = getNextSpeedEffect(effect, 0, dt)
	assert.equal(effect, held * (1 - dt * FLIGHT_LIMITS.speedEffectDecay))
	for (let frame = 0; frame < 12; frame++) effect = getNextSpeedEffect(effect, -1, dt)
	assert.ok(effect < -0.85)
})
