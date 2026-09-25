import assert from 'node:assert/strict'
import test from 'node:test'
import {
	FLIGHT_LIMITS,
	getFlightCorridor,
	getSafetyClimbSpeed,
	getSpeedForEffect,
	getVerticalInput,
} from '../src/flightPolicy.js'

test('maps boost and braking to asymmetric speed changes', () => {
	assert.equal(getSpeedForEffect(55, 1), 165)
	assert.equal(getSpeedForEffect(55, 0), 55)
	assert.equal(getSpeedForEffect(55, -1), 52.25)
	assert.equal(getSpeedForEffect(55, 2), 165)
	assert.equal(getSpeedForEffect(55, -2), 52.25)
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

test('softens safety climbs and raises the limit only for speed or relief', () => {
	const brakingFlat = getSafetyClimbSpeed({
		speed: 52.25,
		baseSpeed: 55,
		currentTerrainHeight: 5,
		terrainCeiling: 5,
	})
	const cruiseFlat = getSafetyClimbSpeed({
		speed: 55,
		baseSpeed: 55,
		currentTerrainHeight: 5,
		terrainCeiling: 5,
	})
	const cruiseRidge = getSafetyClimbSpeed({
		speed: 55,
		baseSpeed: 55,
		currentTerrainHeight: 5,
		terrainCeiling: 45,
	})
	const brakingSlope = getSafetyClimbSpeed({
		speed: 52.25,
		baseSpeed: 55,
		currentTerrainHeight: 5,
		terrainCeiling: 20,
	})
	const boostFlat = getSafetyClimbSpeed({
		speed: 165,
		baseSpeed: 55,
		currentTerrainHeight: 5,
		terrainCeiling: 5,
	})

	assert.equal(brakingFlat, FLIGHT_LIMITS.minimumSafetyClimbSpeed)
	assert.ok(cruiseFlat > brakingFlat)
	assert.ok(brakingSlope > brakingFlat)
	assert.ok(brakingSlope < FLIGHT_LIMITS.maximumSafetyClimbSpeed)
	assert.equal(cruiseRidge, FLIGHT_LIMITS.maximumSafetyClimbSpeed)
	assert.equal(boostFlat, FLIGHT_LIMITS.maximumSafetyClimbSpeed)
})

test('looks farther ahead and adds clearance as speed increases', () => {
	const cruise = getFlightCorridor({
		x: 0,
		z: 0,
		forwardX: 0,
		forwardZ: 1,
		speed: 55,
		baseSpeed: 55,
		sampleHeight: (x, z) => (z >= 60 ? 30 : 0),
	})
	const boost = getFlightCorridor({
		x: 0,
		z: 0,
		forwardX: 0,
		forwardZ: 1,
		speed: 165,
		baseSpeed: 55,
		sampleHeight: (x, z) => (z >= 200 ? 40 : 0),
	})

	assert.equal(cruise.lookAheadDistance, 82.5)
	assert.equal(cruise.currentTerrainHeight, 0)
	assert.equal(cruise.terrainCeiling, 30)
	assert.ok(cruise.minimumAltitude > 40)
	assert.ok(cruise.collisionAltitude < cruise.minimumAltitude)
	assert.equal(boost.lookAheadDistance, 247.5)
	assert.equal(boost.terrainCeiling, 40)
	assert.equal(boost.terrainClearance, 14)
})

test('keeps the terrain corridor below the cloud-layer cap', () => {
	const corridor = getFlightCorridor({
		x: 0,
		z: 0,
		forwardX: 1,
		forwardZ: 0,
		speed: 165,
		baseSpeed: 55,
		sampleHeight: () => 90,
	})

	assert.equal(corridor.minimumAltitude, FLIGHT_LIMITS.maximumAltitude)
	assert.equal(corridor.collisionAltitude, FLIGHT_LIMITS.maximumAltitude)
	assert.equal(corridor.maximumAltitude, FLIGHT_LIMITS.maximumAltitude)
})
