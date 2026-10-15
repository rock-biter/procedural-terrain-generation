import { MathUtils, Matrix4, Quaternion, Vector3 } from 'three'
import { FLIGHT_LIMITS } from './flightPolicy'
import { CHASE_CAMERA } from './maneuverPolicy'

// Where the chase camera (a child of the Plane) settles once the Play intro
// ends; src/intro.js animates it there.
const FOLLOW_POSITION = new Vector3(0, CHASE_CAMERA.height, -CHASE_CAMERA.distance)
const UP = new Vector3(0, 1, 0)

// The chase camera's reaction to the flight: once start() runs, it eases back
// with a boost and forward with a brake, sideways against the turn, and its
// FOV widens on boost and narrows on brake. A maneuver's `framing` (from
// src/maneuverPolicy.js, in the Plane's level frame) blends it toward
// another place and aims it at a target there, so the horizon stays level.
export default class FollowCamera {
	active = false
	target = new Vector3()
	baseFov = 0
	// The camera's own orientation in the Plane (renderSetup's lookAt), the
	// one it keeps outside a framing.
	baseQuaternion = new Quaternion()
	lookMatrix = new Matrix4()
	lookQuaternion = new Quaternion()

	constructor(camera) {
		this.camera = camera
	}

	// After the intro: the current FOV is the base the effect offsets.
	start() {
		this.active = true
		this.baseFov = this.camera.fov
		this.baseQuaternion.copy(this.camera.quaternion)
	}

	getEffectFov(effect) {
		const offset =
			effect >= 0 ? FLIGHT_LIMITS.boostFovOffset * effect : FLIGHT_LIMITS.brakeFovOffset * effect
		return this.baseFov + offset
	}

	// `speedEffect` is the visual speed effect (-1 to 1), `turnInput` -1 to 1,
	// and `framing` a maneuver's { weight, position, target, floor } or null:
	// the camera heads for the blend of the chase place and the framing one,
	// never below `floor` (above the ground there).
	update(dt, speedEffect, turnInput, framing = null) {
		if (!this.active) return
		const weight = framing ? framing.weight : 0
		this.target.copy(FOLLOW_POSITION)
		this.target.z -= FLIGHT_LIMITS.cameraEffectDistance * speedEffect
		this.target.x = -turnInput * 5
		if (weight > 0) {
			this.target.lerp(framing.position, weight)
			this.target.y = Math.max(this.target.y, framing.floor)
		}
		this.camera.position.lerp(this.target, dt * 5)
		if (weight > 0) {
			// Cameras look down -Z: the matrix aims it from its place at the
			// target, upright in the level frame.
			this.lookMatrix.lookAt(this.camera.position, framing.target, UP)
			this.lookQuaternion.setFromRotationMatrix(this.lookMatrix)
			this.camera.quaternion.slerpQuaternions(this.baseQuaternion, this.lookQuaternion, weight)
		} else {
			this.camera.quaternion.copy(this.baseQuaternion)
		}
		this.camera.fov = MathUtils.lerp(this.camera.fov, this.getEffectFov(speedEffect), dt * 5)
		this.camera.updateProjectionMatrix()
	}

	// The Plane moved and turned without the camera (an Immelmann turning
	// around at its top): `delta` takes the camera's old local pose to the new
	// one, so it stays where it was in the world.
	rebase(delta) {
		this.camera.position.applyMatrix4(delta)
		this.lookQuaternion.setFromRotationMatrix(delta)
		this.camera.quaternion.premultiply(this.lookQuaternion)
	}
}
