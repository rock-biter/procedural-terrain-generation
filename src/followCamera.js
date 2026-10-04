import { MathUtils, Vector3 } from 'three'
import { FLIGHT_LIMITS } from './flightPolicy'

// Where the chase camera (a child of the Plane) settles once the Play intro
// ends; src/intro.js animates it there.
const FOLLOW_POSITION = new Vector3(0, 7, -18)

// The chase camera's reaction to the flight: once start() runs, it eases back
// with a boost and forward with a brake, sideways against the turn, and its
// FOV widens on boost and narrows on brake.
export default class FollowCamera {
	active = false
	target = new Vector3()
	baseFov = 0

	constructor(camera) {
		this.camera = camera
	}

	// After the intro: the current FOV is the base the effect offsets.
	start() {
		this.active = true
		this.baseFov = this.camera.fov
	}

	getEffectFov(effect) {
		const offset =
			effect >= 0 ? FLIGHT_LIMITS.boostFovOffset * effect : FLIGHT_LIMITS.brakeFovOffset * effect
		return this.baseFov + offset
	}

	// `speedEffect` is the visual speed effect (-1 to 1), `turnInput` -1 to 1.
	update(dt, speedEffect, turnInput) {
		if (!this.active) return
		this.target.copy(FOLLOW_POSITION)
		this.target.z -= FLIGHT_LIMITS.cameraEffectDistance * speedEffect
		this.target.x = -turnInput * 5
		this.camera.position.lerp(this.target, dt * 5)
		this.camera.fov = MathUtils.lerp(this.camera.fov, this.getEffectFov(speedEffect), dt * 5)
		this.camera.updateProjectionMatrix()
	}
}
