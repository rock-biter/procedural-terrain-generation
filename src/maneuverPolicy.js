import { clamp01, lerp, smoothstep } from './math.js'
import { FLIGHT_LIMITS } from './flightPolicy.js'

// The airplane's aerobatic maneuvers (three-free, tested in Node): the
// aileron roll and the barrel roll (a click in the middle or toward a side
// of the screen), the loop (a click in the top of the screen), and the
// Immelmann (the wheel back at cruise speed). src/plane.js runs them
// one at a time; each pose is in the frame of the flying Plane (the rig),
// whose +Z is the flight direction and +Y up, with the model's pitch
// (rotation.x, negative is nose up) and roll (rotation.z).

export const MANEUVER = Object.freeze({
	AILERON_ROLL: 'aileronRoll',
	BARREL_ROLL: 'barrelRoll',
	LOOP: 'loop',
	IMMELMANN: 'immelmann',
})

export const MANEUVER_LIMITS = Object.freeze({
	// Full turns of the aileron roll about the nose, and the longest share of it
	// its elastic return may take, so the turns always keep some time.
	aileronRollTurns: 2,
	maximumAileronRollSettle: 0.9,
	// The loop and the Immelmann climb 2 radii above the rig. The top stays
	// below `maximumTopAltitude`, so the airplane and the eye stay well under
	// the cloud bases (Y 197 at the lowest); the radius shrinks near it, and
	// the maneuver does not start without room for `minimumRadius`.
	maximumTopAltitude: 170,
	minimumRadius: 12,
	// Up to this speed effect the airplane cruises: the wheel back turns
	// around with an Immelmann; above it (while accelerating, or still fast
	// after), the wheel back brakes.
	cruiseSpeedEffect: 0.15,
	// A click farther than this from the middle of the screen (-1 to 1 across
	// it, like the turn input), in a tight turn, flies a barrel roll toward
	// its side; nearer the middle an aileron roll.
	barrelRollSide: 0.3,
	// A barrel roll climbs 2 radii above the rig, smaller under
	// `maximumTopAltitude`, and falls back to an aileron roll without room for
	// `minimumBarrelRollRadius`.
	minimumBarrelRollRadius: 4,
	// The share of an Immelmann at which the rig turns around, its camera
	// framing fully in, and after which the framing hands back to the chase
	// camera behind the airplane on the new heading; and the fastest its entry
	// and exit speed may be, in path lengths per maneuver, so the airplane
	// never flies back along its path.
	immelmannTurn: 0.7,
	maximumImmelmannCruise: 3,
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

// The chase camera's place in the rig (src/followCamera.js).
export const CHASE_CAMERA = Object.freeze({
	height: 7,
	distance: 18,
})

const FULL_TURN = Math.PI * 2
const DEGREES = Math.PI / 180
// Points along the Immelmann's path table.
const PATH_SAMPLES = 256

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

// The aileron roll's unwrapped angle (radians, rolling toward +rotation.z) at
// `progress` (0 to 1) of the roll, eased by `settings` (params.aileronRoll):
// over the first `1 - settle` of the time it eases in and out with `power`
// to `overshoot` degrees past the `aileronRollTurns` turns, then swings back
// in a damped elastic return with `wobbles` half-swings across the end
// angle. The speed is zero at the start, at the overshoot, and at the end,
// where the angle is exactly the turns. Without a settle share there is no
// overshoot.
export function getAileronRollTurnAngle(progress, settings, limits = MANEUVER_LIMITS) {
	const turns = limits.aileronRollTurns * FULL_TURN
	const settle = Math.min(Math.max(settings.settle, 0), limits.maximumAileronRollSettle)
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
// aileron roll with `settings` (params.aileronRoll), toward `direction` (1 or
// -1, the sign of the model's rotation.z). It is 0 at the start and again
// from `settings.duration` on.
export function getAileronRollAngle(elapsed, settings, direction, limits = MANEUVER_LIMITS) {
	const progress = settings.duration > 0 ? elapsed / settings.duration : 1
	return wrapAngle(direction * getAileronRollTurnAngle(progress, settings, limits))
}

// Whether the airplane cruises (at `speedEffect`): the wheel back then turns
// around (an Immelmann); faster, it brakes.
export function isCruising(speedEffect, limits = MANEUVER_LIMITS) {
	return speedEffect <= limits.cruiseSpeedEffect
}

// The roll a click at `x` (-1 to 1 across the screen) starts: a barrel roll
// toward a side, past `barrelRollSide`, as in a tight turn; an aileron roll
// nearer the middle.
export function getClickRoll(x, limits = MANEUVER_LIMITS) {
	return Math.abs(x) > limits.barrelRollSide ? MANEUVER.BARREL_ROLL : MANEUVER.AILERON_ROLL
}

// The maneuver a click starts at `click` ({ x, yRatio }: -1 to 1 across the
// screen, and a ratio from its top): the loop in the top of the screen
// (above the climb band); anywhere else a roll (getClickRoll()).
export function getClickManeuver(click, top = FLIGHT_LIMITS.verticalHoldTop) {
	return click.yRatio < top ? MANEUVER.LOOP : getClickRoll(click.x)
}

// The radius a barrel roll flies from `altitude`: `radius`, smaller where
// its top would pass `maximumTopAltitude`, or null without room for
// `minimumBarrelRollRadius` (an aileron roll then).
export function getBarrelRollRadius(radius, altitude, limits = MANEUVER_LIMITS) {
	const fitting = Math.min(radius, (limits.maximumTopAltitude - altitude) / 2)
	return fitting >= limits.minimumBarrelRollRadius ? fitting : null
}

// The model's pose `progress` into a barrel roll of `radius`
// (params.barrelRoll), toward `direction` (1 or -1, the sign of its roll):
// `turns` full turns, eased in and out with `power`, on a cylinder along the
// flight whose axis runs `radius` above the rig. Seen from behind the
// airplane circles that axis, centered on the screen: out to one side while
// it climbs, over the top inverted, down the other side, and back. Its top
// always faces the axis, as in a real barrel roll, which rolls it toward
// `direction` and keeps its motion across the flight along its wings. `out`
// receives `x` and `y` (the model's local position: +X is the airplane's
// left), `roll`, and `velocityX` and `velocityY`, its speed across the flight
// per unit of progress (divide by the duration for units per second): with
// the flight speed ahead, the way its nose points.
export function getBarrelRollPose(progress, settings, radius, direction, out = {}) {
	const p = clamp01(progress)
	const turn = settings.turns * FULL_TURN
	const angle = easeInOut(p, settings.power) * turn
	out.x = direction * radius * Math.sin(angle)
	out.y = radius * (1 - Math.cos(angle))
	out.roll = wrapAngle(direction * angle)
	// The ease's slope: power (2p)^(power - 1), mirrored past halfway.
	const half = p < 0.5 ? 2 * p : 2 - 2 * p
	const rate = radius * turn * settings.power * half ** (settings.power - 1)
	out.velocityX = direction * Math.cos(angle) * rate
	out.velocityY = Math.sin(angle) * rate
	return out
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

// The Immelmann's climb angle (radians: 0 level ahead, PI/2 straight up, PI
// level back) at `u` (0 to 1) of its path: up with a smoothstep to `peak`
// over the first `rise` of it, then back to PI over the rest. It starts and
// ends straight, and turns from climbing to diving at `peak` without a kink.
function getPathAngle(u, peak, rise) {
	return u < rise
		? peak * smoothstep(0, 1, u / rise)
		: peak + (Math.PI - peak) * smoothstep(rise, 1, u)
}

// The path's end height per unit of its length, also filling `heights` and
// `lengths` (along the start heading) at PATH_SAMPLES + 1 points when given.
function integratePath(peak, rise, heights = null, lengths = null) {
	let height = 0
	let along = 0
	if (heights) {
		heights[0] = 0
		lengths[0] = 0
	}
	for (let i = 0; i < PATH_SAMPLES; i++) {
		const angle = getPathAngle((i + 0.5) / PATH_SAMPLES, peak, rise)
		height += Math.sin(angle) / PATH_SAMPLES
		along += Math.cos(angle) / PATH_SAMPLES
		if (heights) {
			heights[i + 1] = height
			lengths[i + 1] = along
		}
	}
	return height
}

// The Immelmann's path (params.immelmann.peakAngle): up like a loop, over
// the top, on to `peakAngle` degrees (into the dive; 270 would be three
// quarters of a loop), then eased out level on the reversed heading at its
// starting height, for which the share of the climb is solved. Positions are
// per unit of path length: `heights` and `lengths` (along the start heading)
// at PATH_SAMPLES + 1 points, the highest `height`, the `front` and `back`
// ends, and the `end`; `top` is where it passes the top, inverted.
export function createImmelmannPath(peakAngle) {
	const peak = Math.min(Math.max(peakAngle, 190), 265) * DEGREES
	let low = 0.05
	let high = 0.995
	for (let i = 0; i < 50; i++) {
		const rise = (low + high) / 2
		if (integratePath(peak, rise) > 0) high = rise
		else low = rise
	}
	const rise = (low + high) / 2
	const heights = new Float64Array(PATH_SAMPLES + 1)
	const lengths = new Float64Array(PATH_SAMPLES + 1)
	integratePath(peak, rise, heights, lengths)
	// Where the climb's smoothstep reaches PI / peak.
	let below = 0
	let above = 1
	for (let i = 0; i < 40; i++) {
		const x = (below + above) / 2
		if (peak * smoothstep(0, 1, x) < Math.PI) below = x
		else above = x
	}
	return {
		peak,
		rise,
		top: rise * (below + above) * 0.5,
		heights,
		lengths,
		height: Math.max(...heights),
		front: Math.max(...lengths),
		back: Math.min(...lengths),
		end: lengths[PATH_SAMPLES],
	}
}

// `values` (a path table) at `u` (0 to 1) of the path.
function samplePath(values, u) {
	const x = clamp01(u) * PATH_SAMPLES
	const i = Math.min(Math.floor(x), PATH_SAMPLES - 1)
	return values[i] + (values[i + 1] - values[i]) * (x - i)
}

// The cubic Hermite curve at `t` (0 to 1) from `start` to `end`, with those
// slopes there.
function hermite(t, start, startSlope, end, endSlope) {
	const t2 = t * t
	const t3 = t2 * t
	return (
		(2 * t3 - 3 * t2 + 1) * start +
		(t3 - 2 * t2 + t) * startSlope +
		(-2 * t3 + 3 * t2) * end +
		(t3 - t2) * endSlope
	)
}

// An Immelmann's entry and exit speed in path lengths per maneuver: the
// flight `speed` over `duration` seconds and a path `length` units long.
export function getImmelmannCruise(speed, duration, length, limits = MANEUVER_LIMITS) {
	return Math.min((speed * duration) / length, limits.maximumImmelmannCruise)
}

// The share of its path an Immelmann has flown `progress` into it, entering
// and leaving at `cruise` (getImmelmannCruise()), so at the flight speed,
// and faster (or slower) between: the airplane never stops.
export function getImmelmannDistance(progress, cruise) {
	return hermite(clamp01(progress), 0, cruise, 1, cruise)
}

// The rig's place `progress` into an Immelmann along the start heading, in
// path lengths: it leaves with the airplane, turns back, and arrives with
// it at the path's end, at the flight speed on the reversed heading, so the
// camera keeps up and the airplane lands back on the rig.
export function getImmelmannRig(progress, path, cruise) {
	return hermite(clamp01(progress), 0, cruise, path.end, -cruise)
}

// The airplane `progress` into an Immelmann along `path`, `length` units
// long (params.immelmann), toward `direction` (1 or -1): `out.y` and `out.z`,
// its place from the rig along the start heading; `out.climb`, its climb
// angle; and `out.roll`, the half roll back upright from the top to the
// path's end (eased with `rollPower`), where it is level on the reversed
// heading, back on the rig.
export function getImmelmannPose(progress, path, length, cruise, settings, direction, out = {}) {
	const u = getImmelmannDistance(progress, cruise)
	out.y = samplePath(path.heights, u) * length
	out.z = (samplePath(path.lengths, u) - getImmelmannRig(progress, path, cruise)) * length
	out.climb = getPathAngle(clamp01(u), path.peak, path.rise)
	out.roll = direction * Math.PI * easeInOut((u - path.top) / (1 - path.top), settings.rollPower)
	return out
}

// The width of the maneuver's smoke in the trails (0 to 1), `progress` into a
// loop or an Immelmann: full stripes at any speed, faded in and out.
export function getManeuverSmoke(progress, limits = MANEUVER_LIMITS) {
	const p = clamp01(progress)
	return smoothstep(0, limits.smokeIn, p) * (1 - smoothstep(1 - limits.smokeOut, 1, p))
}

// The camera distance from a vertical figure's middle that fits it,
// `halfHeight` tall and `halfLength` long each way, seen `azimuth` radians
// from its edge-on direction, with a margin in a view of `fov` vertical
// degrees and `aspect` (width over height), scaled by `distance`: its top and
// bottom at the middle's depth, and its nearest end, `halfLength`
// sin(azimuth) across but `halfLength` cos(azimuth) closer, which a portrait
// phone needs to back off for.
export function getFigureFramingDistance(
	halfHeight,
	halfLength,
	fov,
	aspect,
	azimuth,
	distance,
	limits = MANEUVER_LIMITS,
) {
	const tangent = Math.tan((fov * DEGREES) / 2)
	const margin = limits.framingMargin
	const height = (margin * halfHeight) / tangent
	const width =
		halfLength * Math.cos(azimuth) + (margin * halfLength * Math.sin(azimuth)) / (aspect * tangent)
	return distance * Math.max(height, width)
}

// getFigureFramingDistance() for a circle of `radius`.
export function getFramingDistance(
	radius,
	fov,
	aspect,
	azimuth,
	distance,
	limits = MANEUVER_LIMITS,
) {
	return getFigureFramingDistance(radius, radius, fov, aspect, azimuth, distance, limits)
}

// The camera's level framing of a loop, in the rig frame: `out.weight` (0 to 1, `weight`) of the blend from the
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

// The camera `progress` into an Immelmann, from the rig along the start
// heading like getImmelmannPose() (`pose`): level, beside the path,
// `cameraAzimuth` degrees from ahead toward `side`, so the airplane flies
// away from it on the way out, far enough to keep the whole figure in view,
// at the height of its middle; looking at its middle, then at the airplane
// as it dives and levels out. The weight blends in over `framingIn` and,
// once the rig has turned around (`immelmannTurn`), back to the chase camera
// behind the airplane on the new heading.
export function getImmelmannFraming(
	progress,
	path,
	length,
	cruise,
	fov,
	aspect,
	settings,
	side,
	pose,
	out,
	limits = MANEUVER_LIMITS,
) {
	const p = clamp01(progress)
	const azimuth = settings.cameraAzimuth * DEGREES
	const halfHeight = (path.height * length) / 2
	const halfLength = ((path.front - path.back) * length) / 2
	const middle = ((path.front + path.back) / 2 - getImmelmannRig(p, path, cruise)) * length
	const distance = getFigureFramingDistance(
		halfHeight,
		halfLength,
		fov,
		aspect,
		azimuth,
		settings.cameraDistance,
	)
	out.weight = smoothstep(0, limits.framingIn, p) * (1 - smoothstep(limits.immelmannTurn, 1, p))
	out.position.x = side * distance * Math.sin(azimuth)
	out.position.y = halfHeight
	out.position.z = middle + distance * Math.cos(azimuth)
	const follow = smoothstep(0.45, 0.8, p)
	out.target.x = 0
	out.target.y = lerp(halfHeight, pose.y, follow)
	out.target.z = lerp(middle, pose.z, follow)
	return out
}
