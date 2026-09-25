export const FLIGHT_LIMITS = Object.freeze({
	minimumTerrainClearance: 10,
	speedTerrainClearance: 4,
	minimumLookAheadDistance: 80,
	lookAheadSeconds: 1.5,
	terrainSamples: 12,
	maximumAltitude: 95,
	boostSpeedMultiplier: 3,
	brakeSpeedMultiplier: 0.95,
	maximumVerticalSpeed: 28,
	verticalHoldTop: 0.45,
	verticalHoldBottom: 0.65,
	verticalResponse: 5,
	safetyClimbResponse: 3,
	minimumSafetyClimbSpeed: 6,
	maximumSafetyClimbSpeed: 28,
	terrainReliefForMaximumClimb: 30,
	boostFovOffset: 30,
	brakeFovOffset: 10,
	cameraEffectDistance: 7,
})

function clampUnit(value) {
	return Math.max(0, Math.min(value, 1))
}

function smoothstep(value) {
	const clampedValue = clampUnit(value)
	return clampedValue * clampedValue * (3 - 2 * clampedValue)
}

export function getSpeedForEffect(baseSpeed, effect, limits = FLIGHT_LIMITS) {
	const signedEffect = Math.max(-1, Math.min(effect, 1))
	const multiplier =
		signedEffect >= 0
			? 1 + signedEffect * (limits.boostSpeedMultiplier - 1)
			: 1 + -signedEffect * (limits.brakeSpeedMultiplier - 1)

	return baseSpeed * multiplier
}

export function getVerticalInput(screenYRatio, limits = FLIGHT_LIMITS) {
	const pointerPosition = clampUnit(screenYRatio)

	if (pointerPosition < limits.verticalHoldTop) {
		return (limits.verticalHoldTop - pointerPosition) / limits.verticalHoldTop
	}

	if (pointerPosition > limits.verticalHoldBottom) {
		return -(
			(pointerPosition - limits.verticalHoldBottom) /
			(1 - limits.verticalHoldBottom)
		)
	}

	return 0
}

export function getSafetyClimbSpeed({
	speed,
	baseSpeed,
	currentTerrainHeight,
	terrainCeiling,
	limits = FLIGHT_LIMITS,
}) {
	const speedRatio = baseSpeed > 0 ? speed / baseSpeed : 1
	const speedLoad = clampUnit(
		(speedRatio - limits.brakeSpeedMultiplier) /
			(limits.boostSpeedMultiplier - limits.brakeSpeedMultiplier),
	)
	const terrainLoad = clampUnit(
		Math.max(terrainCeiling - currentTerrainHeight, 0) /
			limits.terrainReliefForMaximumClimb,
	)
	const climbLoad = 1 - (1 - speedLoad) * (1 - terrainLoad)

	return (
		limits.minimumSafetyClimbSpeed +
		(limits.maximumSafetyClimbSpeed - limits.minimumSafetyClimbSpeed) *
			smoothstep(climbLoad)
	)
}

export function getFlightCorridor({
	x,
	z,
	forwardX,
	forwardZ,
	speed,
	baseSpeed,
	sampleHeight,
	limits = FLIGHT_LIMITS,
}) {
	const forwardLength = Math.hypot(forwardX, forwardZ)
	const directionX = forwardLength > 0 ? forwardX / forwardLength : 0
	const directionZ = forwardLength > 0 ? forwardZ / forwardLength : 1
	const lookAheadDistance = Math.max(
		limits.minimumLookAheadDistance,
		speed * limits.lookAheadSeconds,
	)
	let terrainCeiling = -Infinity
	let currentTerrainHeight = -Infinity

	for (let sample = 0; sample <= limits.terrainSamples; sample++) {
		const distance = lookAheadDistance * (sample / limits.terrainSamples)
		const height = Math.max(
			sampleHeight(x + directionX * distance, z + directionZ * distance),
			-1,
		)
		if (sample === 0) currentTerrainHeight = height
		terrainCeiling = Math.max(terrainCeiling, height)
	}

	const speedRatio = baseSpeed > 0 ? speed / baseSpeed : 1
	const speedLoad = Math.max(
		0,
		Math.min(
			(speedRatio - limits.brakeSpeedMultiplier) /
				(limits.boostSpeedMultiplier - limits.brakeSpeedMultiplier),
			1,
		),
	)
	const terrainClearance =
		limits.minimumTerrainClearance + limits.speedTerrainClearance * speedLoad

	return {
		lookAheadDistance,
		currentTerrainHeight,
		terrainCeiling,
		terrainClearance,
		collisionAltitude: Math.min(
			currentTerrainHeight + terrainClearance,
			limits.maximumAltitude,
		),
		minimumAltitude: Math.min(
			terrainCeiling + terrainClearance,
			limits.maximumAltitude,
		),
		maximumAltitude: limits.maximumAltitude,
	}
}
