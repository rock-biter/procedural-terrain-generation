export const FLIGHT_LIMITS = Object.freeze({
	minimumTerrainClearance: 10,
	minimumLookAheadScale: 0.5,
	maximumNearLookAheadDistance: 41.25,
	maximumMiddleLookAheadDistance: 82.5,
	maximumFarLookAheadDistance: 123.75,
	maximumAltitude: 95,
	boostSpeedMultiplier: 3,
	brakeSpeedMultiplier: 0.95,
	terrainSlowdownStartRelief: 10,
	terrainReliefForMaximumSlowdown: 30,
	maximumTerrainSlowdown: 0.1,
	maximumClimbTerrainSlowdown: 0.25,
	altitudeDeficitForMaximumSlowdown: 20,
	maximumSevereClimbTerrainSlowdown: 0.45,
	altitudeDeficitForSevereSlowdown: 40,
	terrainSlowdownResponse: 2,
	terrainBrakeStartAltitudeJump: 8,
	terrainBrakeMaximumAltitudeJump: 30,
	maximumTerrainBrakeEffect: 0.65,
	terrainBrakeReleaseResponse: 1.5,
	maximumVerticalSpeed: 28,
	verticalHoldTop: 0.45,
	verticalHoldBottom: 0.65,
	verticalResponse: 5,
	safetyClimbResponse: 3,
	minimumAltitudeRiseResponse: 3,
	minimumAltitudeFallResponse: 0.75,
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

export function getTerrainSlowdown({
	speed,
	baseSpeed,
	currentTerrainHeight,
	terrainCeiling,
	altitude,
	minimumAltitude,
	limits = FLIGHT_LIMITS,
}) {
	const altitudeDeficit = Math.max(minimumAltitude - altitude, 0)
	if (speed <= baseSpeed || altitudeDeficit <= 0) return 0

	const terrainRelief = Math.max(terrainCeiling - currentTerrainHeight, 0)
	const slowdownRange = Math.max(
		limits.terrainReliefForMaximumSlowdown - limits.terrainSlowdownStartRelief,
		Number.EPSILON,
	)
	const reliefLoad =
		(terrainRelief - limits.terrainSlowdownStartRelief) / slowdownRange
	const climbLoad = clampUnit(
		altitudeDeficit / limits.altitudeDeficitForMaximumSlowdown,
	)
	const severeSlowdownRange = Math.max(
		limits.altitudeDeficitForSevereSlowdown -
			limits.altitudeDeficitForMaximumSlowdown,
		Number.EPSILON,
	)
	const severeClimbLoad = clampUnit(
		(altitudeDeficit - limits.altitudeDeficitForMaximumSlowdown) /
			severeSlowdownRange,
	)
	const maximumSlowdown =
		limits.maximumTerrainSlowdown +
		(limits.maximumClimbTerrainSlowdown - limits.maximumTerrainSlowdown) *
			smoothstep(climbLoad) +
		(limits.maximumSevereClimbTerrainSlowdown -
			limits.maximumClimbTerrainSlowdown) *
			smoothstep(severeClimbLoad)

	return maximumSlowdown * smoothstep(reliefLoad)
}

export function getTerrainAdjustedSpeed({ speed, baseSpeed, terrainSlowdown }) {
	if (speed <= baseSpeed) return speed

	return baseSpeed + (speed - baseSpeed) * (1 - clampUnit(terrainSlowdown))
}

export function getTerrainBrakeImpulse({
	speed,
	baseSpeed,
	currentMinimumAltitude,
	minimumAltitude,
	altitude,
	limits = FLIGHT_LIMITS,
}) {
	if (
		speed <= baseSpeed ||
		minimumAltitude <= altitude ||
		!Number.isFinite(currentMinimumAltitude)
	) {
		return 0
	}

	const altitudeJump = Math.max(minimumAltitude - currentMinimumAltitude, 0)
	const altitudeJumpRange = Math.max(
		limits.terrainBrakeMaximumAltitudeJump -
			limits.terrainBrakeStartAltitudeJump,
		Number.EPSILON,
	)
	const jumpLoad =
		(altitudeJump - limits.terrainBrakeStartAltitudeJump) / altitudeJumpRange

	return limits.maximumTerrainBrakeEffect * smoothstep(jumpLoad)
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

export function constrainDescentToMinimum({
	previousAltitude,
	nextAltitude,
	minimumAltitude,
	verticalVelocity,
}) {
	if (verticalVelocity >= 0 || nextAltitude >= minimumAltitude) {
		return { nextAltitude, verticalVelocity }
	}

	return {
		nextAltitude:
			previousAltitude >= minimumAltitude ? minimumAltitude : previousAltitude,
		verticalVelocity: 0,
	}
}

export function getSafetyClimbSpeed({
	currentTerrainHeight,
	terrainCeiling,
	limits = FLIGHT_LIMITS,
}) {
	const terrainLoad = clampUnit(
		Math.max(terrainCeiling - currentTerrainHeight, 0) /
			limits.terrainReliefForMaximumClimb,
	)

	return (
		limits.minimumSafetyClimbSpeed +
		(limits.maximumSafetyClimbSpeed - limits.minimumSafetyClimbSpeed) *
			smoothstep(terrainLoad)
	)
}

export function smoothMinimumAltitude({
	currentAltitude,
	targetAltitude,
	collisionAltitude,
	deltaTime,
	limits = FLIGHT_LIMITS,
}) {
	const cappedTargetAltitude = Math.min(targetAltitude, limits.maximumAltitude)
	if (!Number.isFinite(currentAltitude)) {
		return Math.max(collisionAltitude, cappedTargetAltitude)
	}

	const response =
		cappedTargetAltitude > currentAltitude
			? limits.minimumAltitudeRiseResponse
			: limits.minimumAltitudeFallResponse
	const blend = 1 - Math.exp(-response * Math.max(deltaTime, 0))
	const smoothedAltitude =
		currentAltitude + (cappedTargetAltitude - currentAltitude) * blend

	return Math.max(
		collisionAltitude,
		Math.min(smoothedAltitude, limits.maximumAltitude),
	)
}

export function getFlightCorridor({
	x,
	z,
	forwardX,
	forwardZ,
	speed,
	baseSpeed = speed,
	sampleHeight,
	limits = FLIGHT_LIMITS,
}) {
	const forwardLength = Math.hypot(forwardX, forwardZ)
	const directionX = forwardLength > 0 ? forwardX / forwardLength : 0
	const directionZ = forwardLength > 0 ? forwardZ / forwardLength : 1
	const forwardSpeed = Math.max(speed, 0)
	const cruiseSpeed = Math.max(baseSpeed, 0)
	const boostSpeedRange = Math.max(
		cruiseSpeed * (limits.boostSpeedMultiplier - 1),
		Number.EPSILON,
	)
	const speedLoad = clampUnit((forwardSpeed - cruiseSpeed) / boostSpeedRange)
	const lookAheadScale =
		limits.minimumLookAheadScale +
		(1 - limits.minimumLookAheadScale) * speedLoad
	const nearLookAheadDistance =
		limits.maximumNearLookAheadDistance * lookAheadScale
	const middleLookAheadDistance =
		limits.maximumMiddleLookAheadDistance * lookAheadScale
	const lookAheadDistance = limits.maximumFarLookAheadDistance * lookAheadScale
	const currentTerrainHeight = Math.max(sampleHeight(x, z), -1)
	const nearTerrainHeight = Math.max(
		sampleHeight(
			x + directionX * nearLookAheadDistance,
			z + directionZ * nearLookAheadDistance,
		),
		-1,
	)
	const middleTerrainHeight = Math.max(
		sampleHeight(
			x + directionX * middleLookAheadDistance,
			z + directionZ * middleLookAheadDistance,
		),
		-1,
	)
	const farTerrainHeight = Math.max(
		sampleHeight(
			x + directionX * lookAheadDistance,
			z + directionZ * lookAheadDistance,
		),
		-1,
	)
	const terrainCeiling = Math.max(
		currentTerrainHeight,
		nearTerrainHeight,
		middleTerrainHeight,
		farTerrainHeight,
	)
	const terrainClearance = limits.minimumTerrainClearance
	const samples = [
		{ x, z, height: currentTerrainHeight, distance: 0 },
		{
			x: x + directionX * nearLookAheadDistance,
			z: z + directionZ * nearLookAheadDistance,
			height: nearTerrainHeight,
			distance: nearLookAheadDistance,
		},
		{
			x: x + directionX * middleLookAheadDistance,
			z: z + directionZ * middleLookAheadDistance,
			height: middleTerrainHeight,
			distance: middleLookAheadDistance,
		},
		{
			x: x + directionX * lookAheadDistance,
			z: z + directionZ * lookAheadDistance,
			height: farTerrainHeight,
			distance: lookAheadDistance,
		},
	]

	return {
		samples,
		lookAheadScale,
		nearLookAheadDistance,
		middleLookAheadDistance,
		lookAheadDistance,
		currentTerrainHeight,
		nearTerrainHeight,
		middleTerrainHeight,
		farTerrainHeight,
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
