import { clamp01, lerp, smoothstep } from './math.js'
import { FLIGHT_LIMITS } from './flightPolicy.js'

// The airplane's aerobatic maneuvers (three-free, tested in Node): the barrel
// roll (a click on the canvas), the loop (a click in the top of the screen),
// and the Immelmann (the wheel back at cruise speed). src/plane.js runs them
// one at a time; each pose is in the frame of the flying Plane (the rig),
// whose +Z is the flight direction and +Y up, with the model's pitch
// (rotation.x, negative is nose up) and roll (rotation.z).

export const MANEUVER = Object.freeze({
	BARREL_ROLL: 'barrelRoll',
	LOOP: 'loop',
	IMMELMANN: 'immelmann',
})

export const MANEUVER_LIMITS = Object.freeze({
	// Full turns of the barrel roll about the nose, and the longest share of it
	// its elastic return may take, so the turns always keep some time.
	barrelRollTurns: 2,
	maximumBarrelRollSettle: 0.9,
	// The loop and the Immelmann climb 2 radii above the rig. The top stays
	// below `maximumTopAltitude`, so the airplane and the eye stay well under
	// the cloud bases (Y 197 at the lowest); the radius shrinks near it, and
	// the maneuver does not start without room for `minimumRadius`.
	maximumTopAltitude: 170,
	minimumRadius: 12,
	// The wheel back turns around with an Immelmann at up to this speed effect
	// (cruise); above it, it brakes.
	cruiseSpeedEffect: 0.15,
	// After an Immelmann the ceiling above FLIGHT_LIMITS.maximumAltitude comes
	// down at up to this speed (units per second), speeding up and slowing
	// down at `ceilingDescentAcceleration`, so the airplane glides back under it.
	ceilingDescentSpeed: 10,
	ceilingDescentAcceleration: 8,
	// Shares of a loop or an Immelmann over which the rig slows down at the
	// start and speeds up at the end, the camera framing eases in and out, and
	// the smoke of the trails fades in and out.
	rigRamp: 0.25,
	framingIn: 0.2,
	framingOut: 0.25,
	smokeIn: 0.06,
	smokeOut: 0.12,
	// The framing fits the circle with this margin, and stays this far above
	// the ground below the camera.
	framingMargin: 1.35,
	cameraClearance: 6,
})

// The chase camera's place in the rig (src/followCamera.js), where the
// Immelmann's camera orbit ends, and where its line of sight (renderSetup's
// lookAt, 0.1 down per unit ahead) crosses the airplane's place: the orbit
// ends looking there, so the blend back to the chase camera does not nod.
export const CHASE_CAMERA = Object.freeze({
	height: 7,
	distance: 18,
	lookHeight: 5.2,
})

const FULL_TURN = Math.PI * 2
const DEGREES = Math.PI / 180

// `angle` (radians) brought into [-PI, PI), so a rotation never accumulates:
// 375 degrees becomes 15, 720 becomes 0, and -10 stays -10.
export function wrapAngle(angle) {
	return angle - FULL_TURN * Math.floor((angle + Math.PI) / FULL_TURN)
}

// Power ease in and out of `t` (0 to 1), with no speed at either end for a
// `power` above 1.
export function easeInOut(t, power) {
	const x = clamp01(t)
	return x < 0.5 ? 0.5 * (2 * x) ** power : 1 - 0.5 * (2 - 2 * x) ** power
}

// The barrel roll's unwrapped angle (radians, rolling toward +rotation.z) at
// `progress` (0 to 1) of the roll, eased by `settings` (params.barrelRoll):
// over the first `1 - settle` of the time it eases in and out with `power`
// to `overshoot` degrees past the `barrelRollTurns` turns, then swings back
// in a damped elastic return with `wobbles` half-swings across the end
// angle. The speed is zero at the start, at the overshoot, and at the end,
// where the angle is exactly the turns. Without a settle share there is no
// overshoot.
export function getBarrelRollTurnAngle(progress, settings, limits = MANEUVER_LIMITS) {
	const turns = limits.barrelRollTurns * FULL_TURN
	const settle = Math.min(Math.max(settings.settle, 0), limits.maximumBarrelRollSettle)
	const overshoot = settle > 0 ? settings.overshoot * DEGREES : 0
	const swingStart = 1 - settle
	const t = clamp01(progress)
	if (settle === 0 || t < swingStart) {
		return easeInOut(t / swingStart, settings.power) * (turns + overshoot)
	}
	const swing = (t - swingStart) / settle
	const envelope = 1 - smoothstep(0, 1, swing)
	return turns + overshoot * envelope * Math.cos(settings.wobbles * Math.PI * swing)
}

// The roll angle (radians, wrapped by wrapAngle()) `elapsed` seconds into a
// barrel roll with `settings` (params.barrelRoll), toward `direction` (1 or
// -1, the sign of the model's rotation.z). It is 0 at the start and again
// from `settings.duration` on.
export function getBarrelRollAngle(elapsed, settings, direction, limits = MANEUVER_LIMITS) {
	const progress = settings.duration > 0 ? elapsed / settings.duration : 1
	return wrapAngle(direction * getBarrelRollTurnAngle(progress, settings, limits))
}

// The maneuver a click starts: the loop in the top of the screen (above the
// climb band, `yRatio` from the top), the barrel roll anywhere else.
export function getClickManeuver(yRatio, top = FLIGHT_LIMITS.verticalHoldTop) {
	return yRatio < top ? MANEUVER.LOOP : MANEUVER.BARREL_ROLL
}

// Whether the wheel back turns around (an Immelmann) instead of braking.
export function canTurnAround(speedEffect, limits = MANEUVER_LIMITS) {
	return speedEffect <= limits.cruiseSpeedEffect
}

// The radius a loop or an Immelmann flies from `altitude`: `radius`, smaller
// where its top would pass `maximumTopAltitude`, or null without room for
// `minimumRadius` (the maneuver does not start).
export function getManeuverRadius(radius, altitude, limits = MANEUVER_LIMITS) {
	const fitting = Math.min(radius, (limits.maximumTopAltitude - altitude) / 2)
	return fitting >= limits.minimumRadius ? fitting : null
}

// The rig's share of the flight speed `progress` into a loop: down from 1 to
// `rigSpeed` at the start and back at the end, so the camera keeps moving
// while the ring stays close to a circle in the world.
export function getLoopRigSpeedFactor(progress, rigSpeed, limits = MANEUVER_LIMITS) {
	const p = clamp01(progress)
	const dip = smoothstep(0, limits.rigRamp, p) * (1 - smoothstep(1 - limits.rigRamp, 1, p))
	return lerp(1, rigSpeed, dip)
}

// The rig's share of the flight speed `progress` into an Immelmann
// (params.immelmann): during the climb it slows down and turns back, to
// `-topSpeed` at the top (`climbShare`), where the airplane, at rest on the
// rig, flies back with it; turned around there, the rig goes on at
// `topSpeed` the same way in the world, then speeds back up. Neither the
// rig, the camera on it, nor the airplane ever stops or jumps in speed.
export function getImmelmannRigSpeedFactor(progress, settings) {
	const p = clamp01(progress)
	const { climbShare, topSpeed } = settings
	return p < climbShare
		? lerp(1, -topSpeed, smoothstep(0, climbShare, p))
		: lerp(topSpeed, 1, smoothstep(climbShare, 1, p))
}

// The Immelmann's half roll (0 to 1) `progress` into it: from `rollOverlap`
// of the climb before the top, so it cross-fades with the half loop, to the
// end, eased with `rollPower`.
export function getImmelmannRoll(progress, settings) {
	const start = settings.climbShare * (1 - settings.rollOverlap)
	return easeInOut((clamp01(progress) - start) / (1 - start), settings.rollPower)
}

// The model's pose `progress` into a loop of `radius` (params.loop): a full
// vertical circle in the rig frame, eased in and out with `power`, from and
// back to the rig. `out` receives `y` and `z` (the model's local position),
// `pitch`, and `roll`.
export function getLoopPose(progress, settings, radius, out = {}) {
	const angle = easeInOut(progress, settings.power) * FULL_TURN
	out.y = radius * (1 - Math.cos(angle))
	out.z = radius * Math.sin(angle)
	out.pitch = wrapAngle(-angle)
	out.roll = 0
	return out
}

// The model's pose `progress` into an Immelmann of `radius`
// (params.immelmann), with `out.phase`:
// 1. over the first `climbShare` of the time, a half loop eased in and out
//    with `power`, ending above the rig, inverted, nose back, at rest on the
//    rig, which by then flies back with it (getImmelmannRigSpeedFactor());
// 2. then, in the frame of the rig turned around and lifted to the top
//    (src/plane.js), straight on.
// The half roll back upright, toward `direction` (1 or -1), starts before the
// top and runs through it (getImmelmannRoll()). Turned around, the airplane
// keeps its pose: a pitch of -PI is a yaw of PI with a roll of PI.
export function getImmelmannPose(progress, settings, radius, direction, out = {}) {
	const p = clamp01(progress)
	const climbShare = settings.climbShare
	const roll = direction * Math.PI * getImmelmannRoll(p, settings)
	if (p < climbShare) {
		const angle = easeInOut(p / climbShare, settings.power) * Math.PI
		out.phase = 1
		out.y = radius * (1 - Math.cos(angle))
		out.z = radius * Math.sin(angle)
		out.pitch = wrapAngle(-angle)
		out.roll = wrapAngle(roll)
		return out
	}
	out.phase = 2
	out.y = 0
	out.z = 0
	out.pitch = 0
	out.roll = wrapAngle(Math.PI + roll)
	return out
}

// The width of the maneuver's smoke in the trails (0 to 1), `progress` into a
// loop or an Immelmann: full stripes at any speed, faded in and out.
export function getManeuverSmoke(progress, limits = MANEUVER_LIMITS) {
	const p = clamp01(progress)
	return smoothstep(0, limits.smokeIn, p) * (1 - smoothstep(1 - limits.smokeOut, 1, p))
}

// The camera distance from a circle's center that fits the circle of
// `radius`, seen `azimuth` radians from straight behind, with a margin in a
// view of `fov` vertical degrees and `aspect` (width over height), scaled by
// `distance`: its top and bottom at the center's depth, and its nearest side,
// R sin(azimuth) across but R cos(azimuth) closer, which a portrait phone
// needs to back off for.
export function getFramingDistance(
	radius,
	fov,
	aspect,
	azimuth,
	distance,
	limits = MANEUVER_LIMITS,
) {
	const tangent = Math.tan((fov * DEGREES) / 2)
	const margin = limits.framingMargin
	const height = (margin * radius) / tangent
	const width =
		radius * Math.cos(azimuth) + (margin * radius * Math.sin(azimuth)) / (aspect * tangent)
	return distance * Math.max(height, width)
}

// The camera's level framing of a loop or the climb of an Immelmann, in the
// rig frame: `out.weight` (0 to 1, `weight`) of the blend from the
// chase camera, `out.position` beside and behind the circle, `cameraAzimuth`
// degrees from straight behind toward `side` (1 or -1, +X or -X), at the
// height of its center, and `out.target`, the circle's center. From straight
// behind, a loop would collapse into a vertical line.
export function getCircleFraming(weight, radius, fov, aspect, settings, side, out) {
	const azimuth = settings.cameraAzimuth * DEGREES
	const distance = getFramingDistance(radius, fov, aspect, azimuth, settings.cameraDistance)
	out.weight = weight
	out.position.x = side * distance * Math.sin(azimuth)
	out.position.y = radius
	out.position.z = -distance * Math.cos(azimuth)
	out.target.x = 0
	out.target.y = radius
	out.target.z = 0
	return out
}

// The framing weight `progress` into a loop: in over `framingIn`, out over
// `framingOut`.
export function getLoopFramingWeight(progress, limits = MANEUVER_LIMITS) {
	const p = clamp01(progress)
	return smoothstep(0, limits.framingIn, p) * (1 - smoothstep(1 - limits.framingOut, 1, p))
}

// The camera `progress` into an Immelmann (see getCircleFraming()): during
// the climb, the level framing of the half circle; once the rig has turned
// around at the top, an orbit around the rig from that same place (in the
// new frame: mirrored, and 2 radii lower) to the chase position behind the
// airplane, looking from the old circle's center to the airplane, and the
// blend back to the chase camera over the last `framingOut` of that turn.
export function getImmelmannFraming(
	progress,
	radius,
	fov,
	aspect,
	settings,
	side,
	out,
	limits = MANEUVER_LIMITS,
) {
	const p = clamp01(progress)
	const climbShare = settings.climbShare
	// Fully in by the top, where the rig turns around.
	const fadeIn = smoothstep(0, Math.min(limits.framingIn, climbShare), p)
	if (p < climbShare) return getCircleFraming(fadeIn, radius, fov, aspect, settings, side, out)

	const azimuth = settings.cameraAzimuth * DEGREES
	const distance = getFramingDistance(radius, fov, aspect, azimuth, settings.cameraDistance)
	const turn = (p - climbShare) / (1 - climbShare)
	const t = easeInOut(turn, 2)
	// Mirrored by the turn: from behind toward `side` becomes ahead toward
	// `-side`, the start of an orbit back behind the airplane on that side.
	const startAngle = -side * (Math.PI - azimuth)
	const angle = startAngle * (1 - t)
	const orbitRadius = lerp(distance, CHASE_CAMERA.distance, t)
	out.weight = 1 - smoothstep(1 - limits.framingOut, 1, turn)
	out.position.x = orbitRadius * Math.sin(angle)
	out.position.y = lerp(-radius, CHASE_CAMERA.height, t)
	out.position.z = -orbitRadius * Math.cos(angle)
	const look = smoothstep(0, 0.5, t)
	out.target.x = 0
	out.target.y = lerp(-radius, CHASE_CAMERA.lookHeight, look)
	out.target.z = 0
	return out
}

// Moves `ceiling` ({ altitude, speed }, the raised ceiling and its descent
// speed) `dt` seconds on, in place: the descent speeds up, up to
// `ceilingDescentSpeed`, and slows down to settle on the flight ceiling, so
// the rig the clamp pulls down neither drops nor stops at once.
export function stepAltitudeCeiling(ceiling, dt, limits = MANEUVER_LIMITS, flight = FLIGHT_LIMITS) {
	const above = ceiling.altitude - flight.maximumAltitude
	if (above <= 0) {
		ceiling.altitude = flight.maximumAltitude
		ceiling.speed = 0
		return ceiling
	}
	const acceleration = limits.ceilingDescentAcceleration
	ceiling.speed = Math.min(
		ceiling.speed + acceleration * dt,
		limits.ceilingDescentSpeed,
		Math.sqrt(2 * acceleration * above),
	)
	ceiling.altitude = Math.max(flight.maximumAltitude, ceiling.altitude - ceiling.speed * dt)
	return ceiling
}
