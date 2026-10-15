import assert from 'node:assert/strict'
import test from 'node:test'
import { createAppParams } from '../src/appParams.js'
import { FLIGHT_LIMITS } from '../src/flightPolicy.js'
import {
	isCruising,
	getAileronRollAngle,
	getAileronRollTurnAngle,
	getBarrelRollPose,
	getBarrelRollRadius,
	getCircleFraming,
	getClickManeuver,
	getClickRoll,
	getFramingDistance,
	createImmelmannPath,
	getImmelmannCruise,
	getImmelmannDistance,
	getImmelmannFraming,
	getImmelmannPose,
	getImmelmannRig,
	getLoopFramingWeight,
	getLoopPose,
	getLoopRigSpeedFactor,
	getManeuverRadius,
	getManeuverSmoke,
	MANEUVER,
	MANEUVER_LIMITS,
	wrapAngle,
} from '../src/maneuverPolicy.js'

const degrees = (value) => (value * Math.PI) / 180
const close = (actual, expected, message, tolerance = 1e-9) =>
	assert.ok(Math.abs(actual - expected) < tolerance, `${message ?? ''} ${actual} != ${expected}`)

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

test('the aileron roll eases to an overshoot, swings back, and ends on two turns', () => {
	assert.equal(MANEUVER_LIMITS.aileronRollTurns, 2)
	assert.equal(getAileronRollTurnAngle(0, ROLL), 0)
	close(getAileronRollTurnAngle(0.7, ROLL), TURNS + degrees(20), 'overshoot')
	close(getAileronRollTurnAngle(1, ROLL), TURNS, 'end')
	close(getAileronRollTurnAngle(2, ROLL), TURNS, 'past the end')
	// Halfway through the ease, halfway to the overshoot.
	close(getAileronRollTurnAngle(0.35, ROLL), (TURNS + degrees(20)) / 2, 'halfway')

	// Rises without stopping to the overshoot, then one wobble swings below
	// the end before settling.
	let previous = 0
	let lowest = Infinity
	for (let step = 1; step <= 1000; step++) {
		const progress = step / 1000
		const angle = getAileronRollTurnAngle(progress, ROLL)
		if (progress <= 0.7) assert.ok(angle > previous, `rising at ${progress}`)
		else lowest = Math.min(lowest, angle)
		previous = angle
	}
	assert.ok(lowest < TURNS - degrees(1) && lowest > TURNS - degrees(20), `${lowest}`)

	// No speed at the start, at the overshoot, and at the end.
	const speed = (progress) =>
		(getAileronRollTurnAngle(progress + 1e-6, ROLL) -
			getAileronRollTurnAngle(progress - 1e-6, ROLL)) /
		2e-6
	for (const progress of [1e-6, 0.7, 1 - 1e-6]) {
		assert.ok(Math.abs(speed(progress)) < 1e-3, `${progress}: ${speed(progress)}`)
	}
})

test('the aileron roll ease follows its settings', () => {
	// Without wobbles the return never crosses the end angle.
	const smooth = { ...ROLL, wobbles: 0 }
	for (let step = 700; step <= 1000; step++) {
		assert.ok(getAileronRollTurnAngle(step / 1000, smooth) >= TURNS - 1e-12)
	}
	// Without a settle share there is no overshoot: a plain ease in and out.
	const plain = { ...ROLL, settle: 0 }
	close(getAileronRollTurnAngle(0.5, plain), TURNS / 2)
	close(getAileronRollTurnAngle(1, plain), TURNS)
	for (let step = 0; step <= 100; step++) {
		assert.ok(getAileronRollTurnAngle(step / 100, plain) <= TURNS + 1e-12)
	}
	// A higher power starts slower.
	assert.ok(
		getAileronRollTurnAngle(0.1, { ...ROLL, power: 4 }) < getAileronRollTurnAngle(0.1, ROLL),
	)
	// The settle share is capped, so the turns always keep some time.
	close(getAileronRollTurnAngle(0, { ...ROLL, settle: 1 }), 0)
})

test('the aileron roll angle stays wrapped and ends level in either direction', () => {
	const { duration } = ROLL
	assert.equal(getAileronRollAngle(0, ROLL, 1), 0)
	close(getAileronRollAngle(duration, ROLL, 1), 0, 'end')
	close(getAileronRollAngle(duration, ROLL, -1), 0, 'end, mirrored')
	close(getAileronRollAngle(duration * 3, ROLL, 1), 0, 'past the end')
	close(getAileronRollAngle(duration * 0.7, ROLL, 1), degrees(20), 'overshoot')
	close(getAileronRollAngle(duration * 0.7, ROLL, -1), degrees(-20), 'overshoot, mirrored')
	close(getAileronRollAngle(1, { ...ROLL, duration: 0 }, 1), 0, 'no duration')

	// The defaults sum up to the eased turns, never more than a third of a
	// turn per 16 ms frame, so the wing trails stay continuous.
	const defaults = createAppParams({
		urlParams: new URLSearchParams(),
		isMobile: false,
	}).aileronRoll
	let total = 0
	let previous = 0
	for (let elapsed = 0.016; elapsed < defaults.duration + 0.016; elapsed += 0.016) {
		const angle = getAileronRollAngle(Math.min(elapsed, defaults.duration), defaults, 1)
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

test('a click loops in the top of the screen, and rolls elsewhere, a barrel roll toward a side', () => {
	const side = MANEUVER_LIMITS.barrelRollSide
	const top = FLIGHT_LIMITS.verticalHoldTop
	assert.equal(getClickManeuver({ x: 0, yRatio: 0.1 }), MANEUVER.LOOP)
	assert.equal(getClickManeuver({ x: 0.9, yRatio: 0.1 }), MANEUVER.LOOP)
	assert.equal(getClickManeuver({ x: 0, yRatio: top - 0.01 }), MANEUVER.LOOP)
	assert.equal(getClickManeuver({ x: 0, yRatio: top }), MANEUVER.AILERON_ROLL)
	assert.equal(getClickManeuver({ x: side, yRatio: 0.9 }), MANEUVER.AILERON_ROLL)
	assert.equal(getClickManeuver({ x: -side, yRatio: 0.9 }), MANEUVER.AILERON_ROLL)
	assert.equal(getClickManeuver({ x: side + 0.01, yRatio: 0.9 }), MANEUVER.BARREL_ROLL)
	assert.equal(getClickManeuver({ x: -0.8, yRatio: 0.6 }), MANEUVER.BARREL_ROLL)
	assert.equal(getClickRoll(0.1), MANEUVER.AILERON_ROLL)
	assert.equal(getClickRoll(-0.5), MANEUVER.BARREL_ROLL)
	// The maneuver names are their params keys.
	for (const type of Object.values(MANEUVER)) assert.ok(params[type].duration > 0, type)
})

test('the wheel back turns around only at cruise speed or below', () => {
	assert.ok(isCruising(0))
	assert.ok(isCruising(-0.5))
	assert.ok(isCruising(MANEUVER_LIMITS.cruiseSpeedEffect))
	assert.ok(!isCruising(0.3))
	assert.ok(!isCruising(1))
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

test('the rig slows during a loop', () => {
	assert.equal(getLoopRigSpeedFactor(0, 0.15), 1)
	assert.equal(getLoopRigSpeedFactor(1, 0.15), 1)
	close(getLoopRigSpeedFactor(0.5, 0.15), 0.15)
	for (let step = 0; step <= 100; step++) {
		const factor = getLoopRigSpeedFactor(step / 100, 0.15)
		assert.ok(factor >= 0.15 - 1e-12 && factor <= 1)
	}
})

test('the Immelmann path turns past the top and eases out level and reversed at its starting height', () => {
	for (let peakAngle = 200; peakAngle <= 260; peakAngle += 10) {
		const path = createImmelmannPath(peakAngle)
		const last = path.heights.length - 1
		assert.ok(Math.abs(path.heights[last]) < 1e-9, `${peakAngle}: ${path.heights[last]}`)
		assert.equal(path.end, path.lengths[last])
		assert.ok(path.end < 0, 'ends behind where it started')
		assert.ok(path.height > 0.1 && path.front > 0 && path.back <= path.end)
		assert.ok(path.top > 0.2 && path.top < path.rise, `${peakAngle}: top ${path.top}`)
		close(path.peak, degrees(peakAngle))
	}
	const path = createImmelmannPath(IMMELMANN.peakAngle)
	// It passes the top about halfway.
	assert.ok(path.top > 0.45 && path.top < 0.6, `${path.top}`)
	const pose = getImmelmannPose(0, path, 1, 1, IMMELMANN, 1, {})
	assert.equal(pose.climb, 0)
	close(getImmelmannPose(1, path, 1, 1, IMMELMANN, 1, {}).climb, Math.PI)
	// Straight at both ends: no kink as it starts the climb or levels out.
	const climbAt = (u) =>
		getImmelmannPose(
			// The progress whose distance is `u` at a cruise of 1 (u = t here).
			u,
			path,
			1,
			1,
			IMMELMANN,
			1,
			{},
		).climb
	// A kink would turn about 1e-2 over this step.
	assert.ok(climbAt(1e-3) < 1e-3, `${climbAt(1e-3)}`)
	assert.ok(Math.abs(climbAt(1 - 1e-3) - Math.PI) < 1e-3)
})

test('an Immelmann enters and leaves at the flight speed and never stops', () => {
	assert.equal(getImmelmannCruise(55, 2, 100), 1.1)
	assert.equal(getImmelmannCruise(55, 20, 100), MANEUVER_LIMITS.maximumImmelmannCruise)
	for (const cruise of [0.5, 1, 2, 3]) {
		assert.equal(getImmelmannDistance(0, cruise), 0)
		close(getImmelmannDistance(1, cruise), 1)
		let previous = 0
		for (let step = 1; step <= 1000; step++) {
			const distance = getImmelmannDistance(step / 1000, cruise)
			assert.ok(distance >= previous - 1e-12, `${cruise} ${step}`)
			previous = distance
		}
	}
})

// The Immelmann flown in the world, with yaw 0 at the start: the rig along
// getImmelmannRig(), the airplane along getImmelmannPose() from it, and its
// wing axis through the pose src/plane.js gives the model.
function flyImmelmann(settings, direction, speed, step) {
	const path = createImmelmannPath(settings.peakAngle)
	const length = (2 * R) / path.height
	const cruise = getImmelmannCruise(speed, settings.duration, length)
	const samples = []
	for (let time = 0; time <= settings.duration + 1e-9; time += step) {
		const progress = Math.min(time / settings.duration, 1)
		const rig = getImmelmannRig(progress, path, cruise) * length
		const pose = getImmelmannPose(progress, path, length, cruise, settings, direction, {})
		samples.push({
			rig,
			pose,
			position: [0, pose.y, rig + pose.z],
			wing: toWorld([1, 0, 0], { pitch: -pose.climb, roll: pose.roll }),
		})
	}
	return { samples, path, length }
}

test('the Immelmann flies a smooth reversal back to its height and onto the rig', () => {
	const speed = 55
	const step = 1 / 120
	for (const settings of [IMMELMANN, { ...IMMELMANN, peakAngle: 210, duration: 3 }]) {
		for (const direction of [1, -1]) {
			const { samples } = flyImmelmann(settings, direction, speed, step)
			let previousVelocity = null
			for (let i = 1; i < samples.length; i++) {
				const [x0, y0, z0] = samples[i - 1].position
				const [x1, y1, z1] = samples[i].position
				const velocity = [(x1 - x0) / step, (y1 - y0) / step, (z1 - z0) / step]
				const flown = Math.hypot(...velocity) * step
				// Never stops, never jumps in velocity.
				assert.ok(flown / step > speed * 0.8, `${i}: ${flown / step}`)
				if (previousVelocity) {
					const change = Math.hypot(...velocity.map((v, axis) => v - previousVelocity[axis]))
					assert.ok(change < 6, `${i}: ${change}`)
				}
				previousVelocity = velocity
				// The nose along the path.
				const [, noseY, noseZ] = toWorld([0, 0, 1], { pitch: -samples[i].pose.climb })
				assert.ok(Math.abs(velocity[1] / (flown / step) - noseY) < 0.05, `${i}: nose y`)
				assert.ok(Math.abs(velocity[2] / (flown / step) - noseZ) < 0.05, `${i}: nose z`)
				// The wings turn at most about 15 degrees a unit flown.
				const [a, b] = [samples[i - 1].wing, samples[i].wing]
				const dot = Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])
				assert.ok(Math.acos(dot) / flown < degrees(15), `${i}: twist`)
			}
			// From and back onto the rig, at the flight speed both ways, and
			// level at the starting height on the reversed heading, upright.
			const [first, second] = samples
			const [beforeLast, last] = samples.slice(-2)
			close(first.pose.y, 0)
			close(first.pose.z, 0)
			assert.ok(Math.abs(last.pose.y) < 1e-6 && Math.abs(last.pose.z) < 1e-6)
			assert.ok(Math.abs((second.position[2] - first.position[2]) / step - speed) < 1, 'enters')
			assert.ok(Math.abs((last.position[2] - beforeLast.position[2]) / step + speed) < 1)
			close(last.pose.climb, Math.PI)
			close(Math.abs(last.pose.roll), Math.PI)
			assert.ok(Math.abs(last.wing[0] + 1) < 1e-9, 'wings level, upright on the reversed heading')
			// The half roll starts at the top, toward `direction`.
			const topIndex = samples.findIndex((sample) => sample.pose.climb >= Math.PI)
			assert.equal(Math.abs(samples[topIndex - 1].pose.roll), 0)
			const later = samples[Math.round((topIndex + samples.length) / 2)].pose.roll
			assert.equal(Math.sign(later), direction)
		}
	}
})

test('the turned-around rig holds the airplane in the same world pose', () => {
	// With the rig turned around (yaw PI), a climb angle A with a roll R is a
	// pitch of PI + A with a roll of PI + R (src/plane.js).
	for (const climb of [0, 1, 2.5, Math.PI, 4]) {
		for (const roll of [0, 0.7, -2, Math.PI]) {
			for (const axis of [
				[1, 0, 0],
				[0, 1, 0],
				[0, 0, 1],
			]) {
				const before = toWorld(axis, { yaw: 0.3, pitch: -climb, roll })
				const after = toWorld(axis, {
					yaw: 0.3 + Math.PI,
					pitch: wrapAngle(Math.PI + climb),
					roll: wrapAngle(Math.PI + roll),
				})
				for (let i = 0; i < 3; i++) assert.ok(Math.abs(after[i] - before[i]) < 1e-9)
			}
		}
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

test('the Immelmann camera frames the whole figure from ahead and hands back to the chase camera', () => {
	const { samples, path, length } = flyImmelmann(IMMELMANN, 1, 55, 1 / 60)
	const cruise = getImmelmannCruise(55, IMMELMANN.duration, length)
	const fov = 60
	const at = (progress, side = 1) => {
		const pose = getImmelmannPose(progress, path, length, cruise, IMMELMANN, 1, {})
		return getImmelmannFraming(
			progress,
			path,
			length,
			cruise,
			fov,
			1.5,
			IMMELMANN,
			side,
			pose,
			framing(),
		)
	}
	assert.equal(at(0).weight, 0)
	assert.equal(at(MANEUVER_LIMITS.immelmannTurn).weight, 1, 'fully in when the rig turns around')
	assert.equal(at(1).weight, 0)
	const middle = at(0.4)
	const rig = getImmelmannRig(0.4, path, cruise) * length
	const halfHeight = (path.height * length) / 2
	// Level with the figure's middle, ahead of it on `side`.
	assert.equal(middle.position.y, halfHeight)
	assert.ok(middle.position.x > 0 && at(0.4, -1).position.x === -middle.position.x)
	const figureMiddle = ((path.front + path.back) / 2) * length - rig
	assert.ok(middle.position.z > figureMiddle)
	close(middle.target.z, figureMiddle)
	// The whole figure fits in the view.
	const distance = Math.hypot(middle.position.x, middle.position.z - figureMiddle)
	assert.ok(Math.atan(halfHeight / distance) < degrees(fov / 2) / 1.2)
	// Late, it looks at the airplane.
	const end = at(0.95)
	const pose = getImmelmannPose(0.95, path, length, cruise, IMMELMANN, 1, {})
	close(end.target.y, pose.y)
	close(end.target.z, pose.z)
	assert.ok(samples.length > 0)
})

const BARREL = params.barrelRoll

test('a barrel roll keeps its top under the maximum, or falls back', () => {
	assert.equal(getBarrelRollRadius(12, 60), 12)
	close(getBarrelRollRadius(12, 160), (MANEUVER_LIMITS.maximumTopAltitude - 160) / 2)
	assert.equal(getBarrelRollRadius(12, 166), null)
})

test('the barrel roll circles an axis above the airplane, centered across, its top toward it', () => {
	for (const direction of [1, -1]) {
		for (const turns of [1, 2]) {
			const settings = { ...BARREL, turns }
			const start = getBarrelRollPose(0, settings, R, direction, {})
			for (const value of [start.x, start.y, start.roll, start.velocityX, start.velocityY]) {
				close(value, 0)
			}
			const end = getBarrelRollPose(1, settings, R, direction, {})
			for (const value of [end.x, end.y, end.roll]) assert.ok(Math.abs(value) < 1e-9)
			// Out to the side first (+X, the airplane's left, for a positive
			// roll), climbing.
			const early = getBarrelRollPose(0.05, settings, R, direction, {})
			assert.equal(Math.sign(early.x), direction)
			assert.ok(early.y > 0 && early.y < Math.abs(early.x))
			// Halfway in time is halfway round: over the top, inverted, after one
			// turn, back on the line after two.
			const half = getBarrelRollPose(0.5, settings, R, direction, {})
			close(half.x, 0, 'halfway across', 1e-9)
			close(half.y, turns === 1 ? 2 * R : 0, 'halfway height', 1e-9)
			if (turns === 1) close(Math.abs(half.roll), Math.PI, 'inverted on top')
			let left = 0
			let right = 0
			for (let step = 1; step < 400; step++) {
				const progress = step / 400
				const pose = getBarrelRollPose(progress, settings, R, direction, {})
				left = Math.max(left, pose.x)
				right = Math.min(right, pose.x)
				close(Math.hypot(pose.x, pose.y - R), R, 'on the cylinder')
				assert.ok(pose.y >= -1e-9, 'never below its line')
				assert.ok(pose.roll >= -Math.PI && pose.roll < Math.PI)
				// Its top (rolled up axis) toward the axis above.
				close(-pose.x / R, -Math.sin(pose.roll), 'top x', 1e-9)
				close((R - pose.y) / R, Math.cos(pose.roll), 'top y', 1e-9)
				// The reported speed across, square to its top.
				const next = getBarrelRollPose(progress + 1e-6, settings, R, direction, {})
				close((next.x - pose.x) / 1e-6, pose.velocityX, 'speed x', 1e-3 * R * 40)
				close((next.y - pose.y) / 1e-6, pose.velocityY, 'speed y', 1e-3 * R * 40)
				close(
					-Math.sin(pose.roll) * pose.velocityX + Math.cos(pose.roll) * pose.velocityY,
					0,
					'square',
					1e-6,
				)
			}
			// Centered across the screen.
			close(left, R, 'left', 1e-2)
			close(right, -R, 'right', 1e-2)
		}
	}
})
