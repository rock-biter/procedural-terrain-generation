import { clamp01, lerp, smoothstep } from './math.js'
import { TERRAIN_HEIGHT_BANDS } from './terrainBands.js'
export const FLIGHT_LIMITS = Object.freeze({
	minimumTerrainClearance: 10,
	// Extra clearance where tall scenery stands (getSceneryClearance()): the
	// forest's trees, whose largest conifers reach about 18 units above the
	// ground, and the deep ocean islets' palms, about 15. It is full from
	// `sceneryClearanceShore` units above the sea and starts
	// `sceneryClearanceDepth` units below it.
	forestClearance: 9,
	isletClearance: 7,
	sceneryClearanceShore: 1,
	sceneryClearanceDepth: 6,
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
	// The wheel: each event holds a boost (+1) or brake (-1) request for
	// `wheelHold` seconds, which eases the speed effect toward it at
	// `wheelResponse` (about 95% in 0.2 s); without a request the effect decays
	// toward 0 at `speedEffectDecay` per second.
	wheelHold: 0.2,
	wheelResponse: 15,
	speedEffectDecay: 0.6,
	// The smallest wheel delta back that starts a turnaround
	// (src/maneuverPolicy.js), so a faint trackpad nudge only brakes.
	turnaroundWheelDelta: 4,
})

// The speed effect (-1 brake to 1 boost) after `dt` seconds, with `request`
// the held wheel request (1, -1, or 0 for none). Its only writer, so wheel
// events no longer tween it while the frame loop decays it.
export function getNextSpeedEffect(effect, request, dt, limits = FLIGHT_LIMITS) {
	if (request !== 0) return lerp(effect, request, 1 - Math.exp(-limits.wheelResponse * dt))
	return lerp(effect, 0, dt * limits.speedEffectDecay)
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
	const reliefLoad = (terrainRelief - limits.terrainSlowdownStartRelief) / slowdownRange
	const climbLoad = clamp01(altitudeDeficit / limits.altitudeDeficitForMaximumSlowdown)
	const severeSlowdownRange = Math.max(
		limits.altitudeDeficitForSevereSlowdown - limits.altitudeDeficitForMaximumSlowdown,
		Number.EPSILON,
	)
	const severeClimbLoad = clamp01(
		(altitudeDeficit - limits.altitudeDeficitForMaximumSlowdown) / severeSlowdownRange,
	)
	const maximumSlowdown =
		limits.maximumTerrainSlowdown +
		(limits.maximumClimbTerrainSlowdown - limits.maximumTerrainSlowdown) *
			smoothstep(0, 1, climbLoad) +
		(limits.maximumSevereClimbTerrainSlowdown - limits.maximumClimbTerrainSlowdown) *
			smoothstep(0, 1, severeClimbLoad)

	return maximumSlowdown * smoothstep(0, 1, reliefLoad)
}

export function getTerrainAdjustedSpeed({ speed, baseSpeed, terrainSlowdown }) {
	if (speed <= baseSpeed) return speed

	return baseSpeed + (speed - baseSpeed) * (1 - clamp01(terrainSlowdown))
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
		limits.terrainBrakeMaximumAltitudeJump - limits.terrainBrakeStartAltitudeJump,
		Number.EPSILON,
	)
	const jumpLoad = (altitudeJump - limits.terrainBrakeStartAltitudeJump) / altitudeJumpRange

	return limits.maximumTerrainBrakeEffect * smoothstep(0, 1, jumpLoad)
}

export function getVerticalInput(screenYRatio, limits = FLIGHT_LIMITS) {
	const pointerPosition = clamp01(screenYRatio)

	if (pointerPosition < limits.verticalHoldTop) {
		return (limits.verticalHoldTop - pointerPosition) / limits.verticalHoldTop
	}

	if (pointerPosition > limits.verticalHoldBottom) {
		return -((pointerPosition - limits.verticalHoldBottom) / (1 - limits.verticalHoldBottom))
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
		nextAltitude: previousAltitude >= minimumAltitude ? minimumAltitude : previousAltitude,
		verticalVelocity: 0,
	}
}

export function getSafetyClimbSpeed({
	currentTerrainHeight,
	terrainCeiling,
	limits = FLIGHT_LIMITS,
}) {
	const terrainLoad = clamp01(
		Math.max(terrainCeiling - currentTerrainHeight, 0) / limits.terrainReliefForMaximumClimb,
	)

	return (
		limits.minimumSafetyClimbSpeed +
		(limits.maximumSafetyClimbSpeed - limits.minimumSafetyClimbSpeed) *
			smoothstep(0, 1, terrainLoad)
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
	const smoothedAltitude = currentAltitude + (cappedTargetAltitude - currentAltitude) * blend

	return Math.max(collisionAltitude, Math.min(smoothedAltitude, limits.maximumAltitude))
}

const SNOW_BAND = TERRAIN_HEIGHT_BANDS.snow

// Extra clearance above ground of `height` for the scenery standing there:
// `forest` and `islets` are the shares (0 to 1) of the forest and of the deep
// ocean, whose only land is its islets, at that point. It rises from
// `sceneryClearanceDepth` below the sea to full at `sceneryClearanceShore`,
// so the airplane climbs over the shallows rather than at the beach. The
// forest's fades out across the snow band's wave, above which no tree stands,
// so the mountains keep the plain terrain clearance under the flight ceiling.
export function getSceneryClearance(height, forest, islets, limits = FLIGHT_LIMITS) {
	const shore = smoothstep(-limits.sceneryClearanceDepth, limits.sceneryClearanceShore, height)
	if (shore <= 0) return 0
	const belowSnow =
		1 - smoothstep(SNOW_BAND.level, SNOW_BAND.level + 2 * SNOW_BAND.amplitude, height)
	return (
		shore *
		(clamp01(forest) * belowSnow * limits.forestClearance + clamp01(islets) * limits.isletClearance)
	)
}

// The object getFlightCorridor() fills: four terrain samples (under the
// airplane, then near, middle, and far ahead) and the altitude limits.
export function createFlightCorridor() {
	return {
		samples: Array.from({ length: 4 }, () => ({ x: 0, z: 0, height: 0, distance: 0 })),
		lookAheadScale: 0,
		nearLookAheadDistance: 0,
		middleLookAheadDistance: 0,
		lookAheadDistance: 0,
		currentTerrainHeight: 0,
		nearTerrainHeight: 0,
		middleTerrainHeight: 0,
		farTerrainHeight: 0,
		terrainCeiling: 0,
		terrainClearance: 0,
		collisionAltitude: 0,
		minimumAltitude: 0,
		maximumAltitude: 0,
	}
}

function setSample(sample, x, z, height, distance) {
	sample.x = x
	sample.z = z
	sample.height = height
	sample.distance = distance
}

// Over the sea the airplane may fly lower than over land, as its waves allow
// (getSeaFlightClearance()): the clearance follows the local wave level, the
// highest the waves can rise there (getSeaCrestHeight() in
// src/seaSurfacePolicy.js) between the highest they rise in the calmest and
// in the roughest open water of that sea, from `calmClearance` (above the
// drawn sea) on the calmest water, or calmer by the coast, to the terrain
// clearance on the roughest sea, which so keeps the land's floor; it stays at
// least `crestClearance` above the local crests.
// The sea's clearance comes in over the first `shoreDepth` world units of
// water. `enabled` false keeps the terrain clearance everywhere.
export const SEA_FLIGHT_DEFAULTS = Object.freeze({
	enabled: true,
	calmClearance: 4,
	crestClearance: 1.5,
	shoreDepth: 2,
})

export function createSeaFlightSettings() {
	return { ...SEA_FLIGHT_DEFAULTS }
}

// Clearance over a point `depth` world units under the sea (the flight
// height's opposite; 0 or less is land) whose waves can rise `crest` world
// units above the drawn sea, `calmCrest` and `roughCrest` in the calmest and
// the roughest open water of that sea, with `settings`
// (createSeaFlightSettings()).
export function getSeaFlightClearance(
	depth,
	crest,
	calmCrest,
	roughCrest,
	settings,
	limits = FLIGHT_LIMITS,
) {
	const terrain = limits.minimumTerrainClearance
	if (!settings?.enabled || depth <= 0) return terrain
	const range = roughCrest - calmCrest
	const level = range > 0 ? clamp01((crest - calmCrest) / range) : 0
	const calm = Math.min(settings.calmClearance, terrain)
	const sea = Math.min(
		terrain,
		Math.max(calm + (terrain - calm) * level, Math.max(crest, 0) + settings.crestClearance),
	)
	const share = smoothstep(0, Math.max(settings.shoreDepth, 1e-3), depth)
	return terrain + (sea - terrain) * share
}

function getSampleClearance(sampleClearance, x, z, height, limits) {
	return sampleClearance ? sampleClearance(x, z, height) : limits.minimumTerrainClearance
}

// Samples the terrain under and ahead of the airplane, farther at higher
// speed, and derives the altitude limits. `sampleClearance(x, z, height)`,
// called right after `sampleHeight(x, z)` at the same point with its result,
// returns the clearance there (the terrain's without it). Writes into `out`
// (createFlightCorridor()), so passing the same object every frame allocates
// nothing.
export function getFlightCorridor(
	{
		x,
		z,
		forwardX,
		forwardZ,
		speed,
		baseSpeed = speed,
		sampleHeight,
		sampleClearance = null,
		limits = FLIGHT_LIMITS,
	},
	out = createFlightCorridor(),
) {
	const forwardLength = Math.hypot(forwardX, forwardZ)
	const directionX = forwardLength > 0 ? forwardX / forwardLength : 0
	const directionZ = forwardLength > 0 ? forwardZ / forwardLength : 1
	const forwardSpeed = Math.max(speed, 0)
	const cruiseSpeed = Math.max(baseSpeed, 0)
	const boostSpeedRange = Math.max(cruiseSpeed * (limits.boostSpeedMultiplier - 1), Number.EPSILON)
	const speedLoad = clamp01((forwardSpeed - cruiseSpeed) / boostSpeedRange)
	const lookAheadScale =
		limits.minimumLookAheadScale + (1 - limits.minimumLookAheadScale) * speedLoad
	const nearLookAheadDistance = limits.maximumNearLookAheadDistance * lookAheadScale
	const middleLookAheadDistance = limits.maximumMiddleLookAheadDistance * lookAheadScale
	const lookAheadDistance = limits.maximumFarLookAheadDistance * lookAheadScale
	const nearX = x + directionX * nearLookAheadDistance
	const nearZ = z + directionZ * nearLookAheadDistance
	const middleX = x + directionX * middleLookAheadDistance
	const middleZ = z + directionZ * middleLookAheadDistance
	const farX = x + directionX * lookAheadDistance
	const farZ = z + directionZ * lookAheadDistance
	let height = sampleHeight(x, z)
	const terrainClearance = getSampleClearance(sampleClearance, x, z, height, limits)
	const currentTerrainHeight = Math.max(height, -1)
	height = sampleHeight(nearX, nearZ)
	const nearClearance = getSampleClearance(sampleClearance, nearX, nearZ, height, limits)
	const nearTerrainHeight = Math.max(height, -1)
	height = sampleHeight(middleX, middleZ)
	const middleClearance = getSampleClearance(sampleClearance, middleX, middleZ, height, limits)
	const middleTerrainHeight = Math.max(height, -1)
	height = sampleHeight(farX, farZ)
	const farClearance = getSampleClearance(sampleClearance, farX, farZ, height, limits)
	const farTerrainHeight = Math.max(height, -1)
	const terrainCeiling = Math.max(
		currentTerrainHeight,
		nearTerrainHeight,
		middleTerrainHeight,
		farTerrainHeight,
	)
	// The highest floor of the four: each sample's height plus its clearance.
	const floor = Math.max(
		currentTerrainHeight + terrainClearance,
		nearTerrainHeight + nearClearance,
		middleTerrainHeight + middleClearance,
		farTerrainHeight + farClearance,
	)
	const { samples } = out
	setSample(samples[0], x, z, currentTerrainHeight, 0)
	setSample(samples[1], nearX, nearZ, nearTerrainHeight, nearLookAheadDistance)
	setSample(samples[2], middleX, middleZ, middleTerrainHeight, middleLookAheadDistance)
	setSample(samples[3], farX, farZ, farTerrainHeight, lookAheadDistance)

	out.lookAheadScale = lookAheadScale
	out.nearLookAheadDistance = nearLookAheadDistance
	out.middleLookAheadDistance = middleLookAheadDistance
	out.lookAheadDistance = lookAheadDistance
	out.currentTerrainHeight = currentTerrainHeight
	out.nearTerrainHeight = nearTerrainHeight
	out.middleTerrainHeight = middleTerrainHeight
	out.farTerrainHeight = farTerrainHeight
	out.terrainCeiling = terrainCeiling
	out.terrainClearance = terrainClearance
	out.collisionAltitude = Math.min(currentTerrainHeight + terrainClearance, limits.maximumAltitude)
	out.minimumAltitude = Math.min(floor, limits.maximumAltitude)
	out.maximumAltitude = limits.maximumAltitude
	return out
}
