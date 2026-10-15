import assert from 'node:assert/strict'
import test from 'node:test'
import { createAppParams } from '../src/appParams.js'
import { FLIGHT_LIMITS } from '../src/flightPolicy.js'
import {
	canTurnAround,
	CHASE_CAMERA,
	getBarrelRollAngle,
	getBarrelRollTurnAngle,
	getCircleFraming,
	getClickManeuver,
	getFramingDistance,
	getImmelmannFraming,
	getImmelmannPose,
	getImmelmannRigSpeedFactor,
	getImmelmannRoll,
	getLoopFramingWeight,
	getLoopPose,
	getLoopRigSpeedFactor,
	getManeuverRadius,
	getManeuverSmoke,
	MANEUVER,
	MANEUVER_LIMITS,
	stepAltitudeCeiling,
	wrapAngle,
} from '../src/maneuverPolicy.js'

const degrees = (value) => (value * Math.PI) / 180
const close = (actual, expected, message) =>
	assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? ''} ${actual} != ${expected}`)

test('wrapAngle keeps an angle within one turn, in [-PI, PI)', () => {
	close(wrapAngle(degrees(375)), degrees(15))
	close(wrapAngle(degrees(720)), 0)
	close(wrapAngle(degrees(-10)), degrees(-10))
	close(wrapAngle(degrees(190)), degrees(-170))
	close(wrapAngle(degrees(-725)), degrees(-5))
	assert.equal(wrapAngle(0), 0)
	for (let angle = -50; angle <= 50; angle += 0.37) {
		const wrapped = wrapAngle(angle)
		assert.ok(wrapped >= -Math.PI && wrapped < Math.PI, `${angle} -> ${wrapped}`)
		// The same orientation: a whole number of turns apart.
		const turns = (angle - wrapped) / (Math.PI * 2)
		close(turns, Math.round(turns), `${angle}`)
	}
})

const ROLL = { duration: 0.75, power: 2, overshoot: 20, settle: 0.3, wobbles: 1 }
const TURNS = Math.PI * 4

test('the barrel roll eases to an overshoot, swings back, and ends on two turns', () => {
	assert.equal(MANEUVER_LIMITS.barrelRollTurns, 2)
	assert.equal(getBarrelRollTurnAngle(0, ROLL), 0)
	close(getBarrelRollTurnAngle(0.7, ROLL), TURNS + degrees(20), 'overshoot')
	close(getBarrelRollTurnAngle(1, ROLL), TURNS, 'end')
	close(getBarrelRollTurnAngle(2, ROLL), TURNS, 'past the end')
	// Halfway through the ease, halfway to the overshoot.
	close(getBarrelRollTurnAngle(0.35, ROLL), (TURNS + degrees(20)) / 2, 'halfway')

	// Rises without stopping to the overshoot, then one wobble swings below
	// the end before settling.
	let previous = 0
	let lowest = Infinity
	for (let step = 1; step <= 1000; step++) {
		const progress = step / 1000
		const angle = getBarrelRollTurnAngle(progress, ROLL)
		if (progress <= 0.7) assert.ok(angle > previous, `rising at ${progress}`)
		else lowest = Math.min(lowest, angle)
		previous = angle
	}
	assert.ok(lowest < TURNS - degrees(1) && lowest > TURNS - degrees(20), `${lowest}`)

	// No speed at the start, at the overshoot, and at the end.
	const speed = (progress) =>
		(getBarrelRollTurnAngle(progress + 1e-6, ROLL) -
			getBarrelRollTurnAngle(progress - 1e-6, ROLL)) /
		2e-6
	for (const progress of [1e-6, 0.7, 1 - 1e-6]) {
		assert.ok(Math.abs(speed(progress)) < 1e-3, `${progress}: ${speed(progress)}`)
	}
})

test('the barrel roll ease follows its settings', () => {
	// Without wobbles the return never crosses the end angle.
	const smooth = { ...ROLL, wobbles: 0 }
	for (let step = 700; step <= 1000; step++) {
		assert.ok(getBarrelRollTurnAngle(step / 1000, smooth) >= TURNS - 1e-12)
	}
	// Without a settle share there is no overshoot: a plain ease in and out.
	const plain = { ...ROLL, settle: 0 }
	close(getBarrelRollTurnAngle(0.5, plain), TURNS / 2)
	close(getBarrelRollTurnAngle(1, plain), TURNS)
	for (let step = 0; step <= 100; step++) {
		assert.ok(getBarrelRollTurnAngle(step / 100, plain) <= TURNS + 1e-12)
	}
	// A higher power starts slower.
	assert.ok(getBarrelRollTurnAngle(0.1, { ...ROLL, power: 4 }) < getBarrelRollTurnAngle(0.1, ROLL))
	// The settle share is capped, so the turns always keep some time.
	close(getBarrelRollTurnAngle(0, { ...ROLL, settle: 1 }), 0)
})

test('the barrel roll angle stays wrapped and ends level in either direction', () => {
	const { duration } = ROLL
	assert.equal(getBarrelRollAngle(0, ROLL, 1), 0)
	close(getBarrelRollAngle(duration, ROLL, 1), 0, 'end')
	close(getBarrelRollAngle(duration, ROLL, -1), 0, 'end, mirrored')
	close(getBarrelRollAngle(duration * 3, ROLL, 1), 0, 'past the end')
	close(getBarrelRollAngle(duration * 0.7, ROLL, 1), degrees(20), 'overshoot')
	close(getBarrelRollAngle(duration * 0.7, ROLL, -1), degrees(-20), 'overshoot, mirrored')
	close(getBarrelRollAngle(1, { ...ROLL, duration: 0 }, 1), 0, 'no duration')

	// The defaults sum up to the eased turns, never more than a third of a
	// turn per 16 ms frame, so the wing trails stay continuous.
	const defaults = createAppParams({ urlParams: new URLSearchParams(), isMobile: false }).barrelRoll
	let total = 0
	let previous = 0
	for (let elapsed = 0.016; elapsed < defaults.duration + 0.016; elapsed += 0.016) {
		const angle = getBarrelRollAngle(Math.min(elapsed, defaults.duration), defaults, 1)
		assert.ok(angle >= -Math.PI && angle < Math.PI)
		const delta = wrapAngle(angle - previous)
		assert.ok(Math.abs(delta) < (Math.PI * 2) / 3, `${elapsed}: ${delta}`)
		total += delta
		previous = angle
	}
	close(total, TURNS, 'two turns')
})

const params = createAppParams({ urlParams: new URLSearchParams(), isMobile: false })
const LOOP = params.loop
const IMMELMANN = params.immelmann
const R = 28

// A model-space vector through the model's pose (Euler XYZ, no Y) and the
// rig's yaw, as three.js composes them.
function toWorld([x, y, z], { yaw = 0, pitch = 0, roll = 0 }) {
	// Rz(roll)
	const a = x * Math.cos(roll) - y * Math.sin(roll)
	const rolledY = x * Math.sin(roll) + y * Math.cos(roll)
	// Rx(pitch)
	const b = rolledY * Math.cos(pitch) - z * Math.sin(pitch)
	const c = rolledY * Math.sin(pitch) + z * Math.cos(pitch)
	// Ry(yaw)
	return [a * Math.cos(yaw) + c * Math.sin(yaw), b, -a * Math.sin(yaw) + c * Math.cos(yaw)]
}

function framing() {
	return { weight: 0, position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } }
}

test('a click loops in the top of the screen and rolls elsewhere', () => {
	assert.equal(getClickManeuver(0.1), MANEUVER.LOOP)
	assert.equal(getClickManeuver(FLIGHT_LIMITS.verticalHoldTop - 0.01), MANEUVER.LOOP)
	assert.equal(getClickManeuver(FLIGHT_LIMITS.verticalHoldTop), MANEUVER.BARREL_ROLL)
	assert.equal(getClickManeuver(0.9), MANEUVER.BARREL_ROLL)
	// The maneuver names are their params keys.
	for (const type of Object.values(MANEUVER)) assert.ok(params[type].duration > 0, type)
})

test('the wheel back turns around only at cruise speed or below', () => {
	assert.ok(canTurnAround(0))
	assert.ok(canTurnAround(-0.5))
	assert.ok(canTurnAround(MANEUVER_LIMITS.cruiseSpeedEffect))
	assert.ok(!canTurnAround(0.3))
	assert.ok(!canTurnAround(1))
})

test('a loop or an Immelmann keeps its top under the maximum, or does not start', () => {
	assert.equal(getManeuverRadius(R, 60), R)
	assert.equal(getManeuverRadius(R, FLIGHT_LIMITS.maximumAltitude), R)
	close(getManeuverRadius(R, 130), 20)
	assert.equal(getManeuverRadius(R, 150), null)
	for (let altitude = 0; altitude <= 180; altitude += 2.5) {
		const radius = getManeuverRadius(40, altitude)
		if (radius === null) continue
		assert.ok(radius >= MANEUVER_LIMITS.minimumRadius)
		assert.ok(altitude + 2 * radius <= MANEUVER_LIMITS.maximumTopAltitude + 1e-9)
	}
})

test('the loop flies a full circle above the rig, nose along it, and comes back level', () => {
	const pose = {}
	getLoopPose(0, LOOP, R, pose)
	for (const value of [pose.y, pose.z, pose.pitch, pose.roll]) close(value, 0)
	getLoopPose(1, LOOP, R, pose)
	close(pose.y, 0)
	close(pose.z, 0)
	close(pose.pitch, 0)
	getLoopPose(0.5, LOOP, R, pose)
	close(pose.y, 2 * R, 'top')
	close(pose.z, 0)
	close(Math.abs(pose.pitch), Math.PI, 'inverted')
	for (let step = 1; step < 100; step++) {
		const progress = step / 100
		getLoopPose(progress, LOOP, R, pose)
		close(Math.hypot(pose.z, pose.y - R), R, `on the circle at ${progress}`)
		assert.ok(pose.pitch >= -Math.PI && pose.pitch < Math.PI)
		// The nose follows the circle's tangent.
		const next = getLoopPose(progress + 1e-6, LOOP, R, {})
		const along = Math.hypot(next.y - pose.y, next.z - pose.z)
		const [, noseY, noseZ] = toWorld([0, 0, 1], { pitch: pose.pitch })
		assert.ok(Math.abs((next.y - pose.y) / along - noseY) < 1e-4, `nose y at ${progress}`)
		assert.ok(Math.abs((next.z - pose.z) / along - noseZ) < 1e-4, `nose z at ${progress}`)
	}
	// From and back to the rig without a jump in speed.
	const start = getLoopPose(1e-4, LOOP, R, {})
	const end = getLoopPose(1 - 1e-4, LOOP, R, {})
	assert.ok(Math.hypot(start.y, start.z) < 1e-3 && Math.hypot(end.y, end.z) < 1e-3)
})

test('the rig slows during a loop and turns back with the airplane over the top of an Immelmann', () => {
	assert.equal(getLoopRigSpeedFactor(0, 0.15), 1)
	assert.equal(getLoopRigSpeedFactor(1, 0.15), 1)
	close(getLoopRigSpeedFactor(0.5, 0.15), 0.15)
	for (let step = 0; step <= 100; step++) {
		const factor = getLoopRigSpeedFactor(step / 100, 0.15)
		assert.ok(factor >= 0.15 - 1e-12 && factor <= 1)
	}
	const { climbShare, topSpeed } = IMMELMANN
	assert.equal(getImmelmannRigSpeedFactor(0, IMMELMANN), 1)
	close(getImmelmannRigSpeedFactor(climbShare - 1e-9, IMMELMANN), -topSpeed, 'flying back')
	// Turned around: the same speed the same way in the world.
	assert.equal(getImmelmannRigSpeedFactor(climbShare, IMMELMANN), topSpeed)
	assert.equal(getImmelmannRigSpeedFactor(1, IMMELMANN), 1)
})

// The Immelmann flown in the world: the rig moving along its heading by the
// signed speed factor, turned around and lifted at the top as src/plane.js
// does, and the airplane's place and wing axis on it.
function flyImmelmann(settings, direction, speed, step) {
	let x = 0
	let y = 0
	let z = 0
	let yaw = 0
	let turned = false
	const samples = []
	for (let time = 0; time <= settings.duration + 1e-9; time += step) {
		const progress = Math.min(time / settings.duration, 1)
		if (!turned && progress >= settings.climbShare) {
			turned = true
			y += 2 * R
			yaw += Math.PI
		}
		const advance = speed * getImmelmannRigSpeedFactor(progress, settings) * step
		x += Math.sin(yaw) * advance
		z += Math.cos(yaw) * advance
		const pose = getImmelmannPose(progress, settings, R, direction, {})
		const [offsetX, offsetY, offsetZ] = toWorld([0, pose.y, pose.z], { yaw })
		samples.push({
			position: [x + offsetX, y + offsetY, z + offsetZ],
			wing: toWorld([1, 0, 0], { yaw, pitch: pose.pitch, roll: pose.roll }),
		})
	}
	return samples
}

test('the Immelmann climbs a half loop, rolls through the top in the same pose, and ends upright', () => {
	const { climbShare, rollOverlap } = IMMELMANN
	const pose = {}
	getImmelmannPose(0, IMMELMANN, R, 1, pose)
	assert.equal(pose.phase, 1)
	for (const value of [pose.y, pose.z, pose.pitch, pose.roll]) close(value, 0)
	const top = getImmelmannPose(climbShare - 1e-9, IMMELMANN, R, 1, {})
	assert.equal(top.phase, 1)
	close(top.y, 2 * R)
	assert.ok(Math.abs(top.z) < 1e-6)
	// At rest on the rig at the top (the rig carries the speed there).
	const below = getImmelmannPose(climbShare - 1e-4, IMMELMANN, R, 1, {})
	assert.ok(Math.hypot(top.y - below.y, top.z - below.z) < 1e-4)
	// The half roll cross-fades with the climb: it starts before the top and
	// is under way there.
	const rollStart = climbShare * (1 - rollOverlap)
	assert.equal(getImmelmannRoll(rollStart - 1e-3, IMMELMANN), 0)
	const atTop = getImmelmannRoll(climbShare, IMMELMANN)
	assert.ok(atTop > 0.01 && atTop < 0.5, `${atTop}`)
	assert.equal(getImmelmannRoll(1, IMMELMANN), 1)

	for (const direction of [1, -1]) {
		const before = getImmelmannPose(climbShare - 1e-9, IMMELMANN, R, direction, {})
		const turned = getImmelmannPose(climbShare, IMMELMANN, R, direction, {})
		assert.equal(turned.phase, 2)
		for (const value of [turned.y, turned.z, turned.pitch]) close(value, 0)
		// The rig turned around (yaw + PI) holds the airplane in the same world
		// pose as the old rig did, mid-roll.
		for (const axis of [
			[1, 0, 0],
			[0, 1, 0],
			[0, 0, 1],
		]) {
			const old = toWorld(axis, { yaw: 0.3, pitch: before.pitch, roll: before.roll })
			const now = toWorld(axis, { yaw: 0.3 + Math.PI, pitch: turned.pitch, roll: turned.roll })
			for (let i = 0; i < 3; i++) assert.ok(Math.abs(now[i] - old[i]) < 1e-6, `${axis} ${i}`)
		}
		const end = getImmelmannPose(1, IMMELMANN, R, direction, {})
		close(end.roll, 0, 'upright')
		const late = getImmelmannPose(climbShare + 0.8 * (1 - climbShare), IMMELMANN, R, direction, {})
		assert.equal(Math.sign(wrapAngle(late.roll - Math.PI)), direction, 'rolls toward direction')
	}
})

test('the Immelmann flies on through the top without stopping, jumping, or knotting the trails', () => {
	const speed = 55
	const step = 1 / 120
	for (const settings of [IMMELMANN, { ...IMMELMANN, topSpeed: 0.3, rollOverlap: 0.6 }]) {
		const samples = flyImmelmann(settings, 1, speed, step)
		let previousVelocity = null
		for (let i = 1; i < samples.length; i++) {
			const [x0, y0, z0] = samples[i - 1].position
			const [x1, y1, z1] = samples[i].position
			const velocity = [(x1 - x0) / step, (y1 - y0) / step, (z1 - z0) / step]
			const flown = Math.hypot(...velocity) * step
			// Never stops: at least the speed share at the top.
			assert.ok(flown / step > speed * settings.topSpeed * 0.9, `${i}: ${flown / step}`)
			// No jump in velocity, the turnaround included: the curve's own
			// acceleration only.
			if (previousVelocity) {
				const change = Math.hypot(...velocity.map((v, axis) => v - previousVelocity[axis]))
				assert.ok(change < 6, `${i}: ${change}`)
			}
			previousVelocity = velocity
			// The wings turn at most about 15 degrees a unit flown.
			const [a, b] = [samples[i - 1].wing, samples[i].wing]
			const dot = Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])
			assert.ok(Math.acos(dot) / flown < (15 * Math.PI) / 180, `${i}: twist`)
		}
		// Back the other way, two radii up.
		const last = samples.at(-1)
		const first = samples[0]
		close(last.position[1] - first.position[1], 2 * R)
		close(last.wing[0], -1, 'wings level on the reversed heading')
	}
})

test('the maneuver smoke fades in and out', () => {
	assert.equal(getManeuverSmoke(0), 0)
	assert.equal(getManeuverSmoke(0.5), 1)
	assert.equal(getManeuverSmoke(1), 0)
})

test('the loop framing looks at the whole circle from beside it, level, and blends in and out', () => {
	assert.equal(getLoopFramingWeight(0), 0)
	assert.equal(getLoopFramingWeight(0.5), 1)
	assert.equal(getLoopFramingWeight(1), 0)
	const fov = 60
	const aspect = 16 / 9
	const azimuth = (LOOP.cameraAzimuth * Math.PI) / 180
	const out = getCircleFraming(1, R, fov, aspect, LOOP, 1, framing())
	assert.deepEqual(out.target, { x: 0, y: R, z: 0 })
	assert.equal(out.position.y, R, 'level with the center')
	const distance = Math.hypot(out.position.x, out.position.z)
	close(distance, getFramingDistance(R, fov, aspect, azimuth, LOOP.cameraDistance))
	close(Math.atan2(out.position.x, -out.position.z), azimuth)
	// The circle fits in the view with a margin.
	assert.ok(Math.atan(R / distance) < ((fov / 2) * Math.PI) / 180 / 1.2)
	const mirrored = getCircleFraming(1, R, fov, aspect, LOOP, -1, framing())
	assert.equal(mirrored.position.x, -out.position.x)
	// On a portrait phone the camera backs off so the circle's nearest side,
	// R sin(azimuth) across and R cos(azimuth) closer, fits too.
	const portrait = 390 / 844
	const phoneFov = 92.7
	const phone = getFramingDistance(R, phoneFov, portrait, azimuth, 1)
	const halfWidth = Math.atan(portrait * Math.tan(((phoneFov / 2) * Math.PI) / 180))
	const nearest = Math.atan((R * Math.sin(azimuth)) / (phone - R * Math.cos(azimuth)))
	assert.ok(nearest < halfWidth / 1.2, `${nearest} ${halfWidth}`)
	// Landscape fits the height first, whatever the width.
	assert.equal(
		getFramingDistance(R, fov, aspect, azimuth, 1),
		getFramingDistance(R, fov, 3, azimuth, 1),
	)
})

test('the Immelmann camera orbits on from where the climb framing left it to behind the airplane', () => {
	const { climbShare } = IMMELMANN
	for (const side of [1, -1]) {
		const before = getImmelmannFraming(climbShare - 1e-9, R, 60, 1.5, IMMELMANN, side, framing())
		const after = getImmelmannFraming(climbShare, R, 60, 1.5, IMMELMANN, side, framing())
		assert.equal(before.weight, 1)
		assert.equal(after.weight, 1)
		// The rig turned around and rose 2 radii: (x, y, z) becomes (-x, y - 2R, -z).
		close(after.position.x, -before.position.x)
		close(after.position.y, before.position.y - 2 * R)
		close(after.position.z, -before.position.z)
		close(after.target.y, before.target.y - 2 * R)
		const end = getImmelmannFraming(1, R, 60, 1.5, IMMELMANN, side, framing())
		assert.equal(end.weight, 0)
		close(end.position.x, 0)
		close(end.position.y, CHASE_CAMERA.height)
		close(end.position.z, -CHASE_CAMERA.distance)
		// Looking along the chase camera's own line of sight (0.1 down per unit).
		close(end.target.y, CHASE_CAMERA.height - 0.1 * CHASE_CAMERA.distance)
	}
})

test('the raised ceiling eases down to the flight ceiling', () => {
	const ceiling = { altitude: 150, speed: 0 }
	const step = 1 / 60
	let previousSpeed = 0
	let time = 0
	while (ceiling.altitude > FLIGHT_LIMITS.maximumAltitude && time < 20) {
		stepAltitudeCeiling(ceiling, step)
		// Never faster than the cap, and never a jump in speed (within the
		// discrete step where the slowing down takes over).
		assert.ok(ceiling.speed <= MANEUVER_LIMITS.ceilingDescentSpeed + 1e-9)
		assert.ok(
			Math.abs(ceiling.speed - previousSpeed) <=
				MANEUVER_LIMITS.ceilingDescentAcceleration * step * 1.5,
			`${time}`,
		)
		previousSpeed = ceiling.speed
		time += step
	}
	assert.equal(ceiling.altitude, FLIGHT_LIMITS.maximumAltitude)
	// 55 units at up to 10 per second: 5.5 s, and about 1.25 s more with the ramps.
	assert.ok(time > 6.5 && time < 7, `${time}`)
	stepAltitudeCeiling(ceiling, step)
	assert.deepEqual(ceiling, { altitude: FLIGHT_LIMITS.maximumAltitude, speed: 0 })
})
