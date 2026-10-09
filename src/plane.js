import { MathUtils, Object3D, Vector3 } from 'three'
import FlightInput from './flightInput'
import FollowCamera from './followCamera'
import Propeller from './propeller'
import WingTrails from './wingTrails'
import {
	constrainDescentToMinimum,
	FLIGHT_LIMITS,
	getFlightCorridor,
	getNextSpeedEffect,
	getSafetyClimbSpeed,
	getSpeedForEffect,
	getTerrainAdjustedSpeed,
	getTerrainBrakeImpulse,
	getTerrainSlowdown,
	getVerticalInput,
	smoothMinimumAltitude,
} from './flightPolicy'
const V3 = new Vector3(0, 0, 0)

// The player airplane: flight (speed, turn, terrain-aware altitude), the
// banking model, and the parts it drives: the input (src/flightInput.js), the
// chase camera (src/followCamera.js), the propeller (src/propeller.js), and
// the wing trails (src/wingTrails.js).
export default class Plane extends Object3D {
	baseSpeed = 35
	// The cruise speed to restore while hold() keeps the airplane still.
	heldBaseSpeed = null
	speed = 0
	verticalVelocity = 0
	actualVerticalSpeed = 0
	terrainSampler = null
	flightCorridor = null
	smoothedMinimumAltitude = null
	terrainSlowdown = 0
	terrainBrakeEffect = 0
	acceleration = 0
	uniforms = {
		uAcceleration: { value: 0 },
	}

	// `modelConfig` is the airplane's entry in AIRPLANE_MODELS
	// (src/airplaneModels.js): trail anchor and propeller data.
	constructor(airplane, params, camera, modelConfig) {
		super()

		this.params = params
		this.model = airplane
		this.modelConfig = modelConfig
		this.trailAnchor = new Vector3().fromArray(modelConfig.trailAnchor)
		this.add(airplane)
		this.input = new FlightInput()
		this.cursor = this.input.cursor
		this.addCamera(camera)
		this.followCamera = new FollowCamera(camera)
		this.propeller = new Propeller(airplane, modelConfig, params.propeller)
		this.wingTrails = new WingTrails(params.trails)
		// A direct scene child (src/world.js): the ribbon is in world space.
		this.trails = this.wingTrails.mesh
	}

	// The chase camera rides as a child; the ?debug=1 pause detaches it and
	// calls this again on resume.
	addCamera(camera) {
		this.camera = camera
		this.add(camera)
	}

	get pointerYRatio() {
		return this.input.pointerYRatio
	}

	setDayNight({ trailTint }) {
		this.wingTrails.setTint(trailTint)
	}

	// Rebuilds the ribbon from its history (params.trails edits while paused).
	refreshTrails() {
		this.wingTrails.refresh()
	}

	// After the Play intro: the chase camera starts reacting to the flight.
	addEffect() {
		this.followCamera.start()
	}

	updateSpeed(progress) {
		const effectSpeed = getSpeedForEffect(this.baseSpeed, progress)
		this.speed = getTerrainAdjustedSpeed({
			speed: effectSpeed,
			baseSpeed: this.baseSpeed,
			terrainSlowdown: Math.max(this.terrainSlowdown, this.terrainBrakeEffect),
		})
	}

	getVisualSpeedEffect() {
		return this.terrainBrakeEffect > 0
			? Math.min(this.acceleration, -this.terrainBrakeEffect)
			: this.acceleration
	}

	setTerrainSampler(sampleHeight) {
		this.terrainSampler = sampleHeight
	}

	// Forgets the smoothed terrain corridor after the terrain changes under the
	// plane (a new world seed), so the altitude jump does not trigger a brake.
	resetTerrainState() {
		this.smoothedMinimumAltitude = null
		this.terrainBrakeEffect = 0
		this.terrainSlowdown = 0
	}

	// Holds the airplane still until release() (?debug=1 and ?gui=1 before
	// Play, src/world.js): no speed, and no turn, climb, or wheel input.
	hold() {
		this.heldBaseSpeed ??= this.baseSpeed
		this.baseSpeed = 0
		this.speed = 0
		this.setInputEnabled(false)
		this.input.center()
	}

	release() {
		if (this.heldBaseSpeed === null) return
		this.baseSpeed = this.heldBaseSpeed
		this.heldBaseSpeed = null
		this.setInputEnabled(true)
	}

	// Moves the airplane without flying there (the ?gui=1 biome map): the
	// heading stays, the corridor, climb, and wing trails start over.
	teleport(x, y, z) {
		this.position.set(x, y, z)
		this.verticalVelocity = 0
		this.actualVerticalSpeed = 0
		this.resetTerrainState()
		this.wingTrails.clear()
	}

	updateAltitude(dt) {
		if (!this.terrainSampler) return

		V3.set(0, 0, 1).applyQuaternion(this.quaternion)
		// Filled in place after the first frame.
		this.flightCorridor = getFlightCorridor(
			{
				x: this.position.x,
				z: this.position.z,
				forwardX: V3.x,
				forwardZ: V3.z,
				speed: this.speed,
				baseSpeed: this.baseSpeed,
				sampleHeight: this.terrainSampler,
			},
			this.flightCorridor ?? undefined,
		)
		const targetMinimumAltitude = this.flightCorridor.minimumAltitude
		const currentMinimumAltitude = this.smoothedMinimumAltitude
		const minimumAltitudeJump = Number.isFinite(currentMinimumAltitude)
			? Math.max(targetMinimumAltitude - currentMinimumAltitude, 0)
			: 0
		const terrainBrakeImpulse = getTerrainBrakeImpulse({
			speed: this.speed,
			baseSpeed: this.baseSpeed,
			currentMinimumAltitude,
			minimumAltitude: targetMinimumAltitude,
			altitude: this.position.y,
		})
		const hasTerrainCollisionRisk = targetMinimumAltitude > this.position.y
		this.terrainBrakeEffect = hasTerrainCollisionRisk
			? Math.max(
					terrainBrakeImpulse,
					MathUtils.damp(this.terrainBrakeEffect, 0, FLIGHT_LIMITS.terrainBrakeReleaseResponse, dt),
				)
			: 0
		if (this.terrainBrakeEffect < 0.005) this.terrainBrakeEffect = 0
		this.flightCorridor.minimumAltitudeJump = minimumAltitudeJump
		this.flightCorridor.hasTerrainCollisionRisk = hasTerrainCollisionRisk
		this.flightCorridor.terrainBrakeImpulse = terrainBrakeImpulse
		this.flightCorridor.terrainBrakeEffect = this.terrainBrakeEffect
		const targetTerrainSlowdown = getTerrainSlowdown({
			speed: this.speed,
			baseSpeed: this.baseSpeed,
			currentTerrainHeight: this.flightCorridor.currentTerrainHeight,
			terrainCeiling: this.flightCorridor.terrainCeiling,
			altitude: this.position.y,
			minimumAltitude: targetMinimumAltitude,
		})
		this.terrainSlowdown = hasTerrainCollisionRisk
			? MathUtils.damp(
					this.terrainSlowdown,
					targetTerrainSlowdown,
					FLIGHT_LIMITS.terrainSlowdownResponse,
					dt,
				)
			: 0
		this.flightCorridor.targetTerrainSlowdown = targetTerrainSlowdown
		this.flightCorridor.terrainSlowdown = this.terrainSlowdown
		this.smoothedMinimumAltitude = smoothMinimumAltitude({
			currentAltitude: this.smoothedMinimumAltitude,
			targetAltitude: targetMinimumAltitude,
			collisionAltitude: this.flightCorridor.collisionAltitude,
			deltaTime: dt,
		})
		this.flightCorridor.targetMinimumAltitude = targetMinimumAltitude
		this.flightCorridor.minimumAltitude = this.smoothedMinimumAltitude

		const verticalInput = getVerticalInput(this.pointerYRatio)
		const desiredVerticalSpeed = verticalInput * FLIGHT_LIMITS.maximumVerticalSpeed
		this.verticalVelocity = MathUtils.damp(
			this.verticalVelocity,
			desiredVerticalSpeed,
			FLIGHT_LIMITS.verticalResponse,
			dt,
		)

		const previousAltitude = this.position.y
		let nextAltitude = previousAltitude + this.verticalVelocity * dt
		const constrainedDescent = constrainDescentToMinimum({
			previousAltitude,
			nextAltitude,
			minimumAltitude: this.flightCorridor.minimumAltitude,
			verticalVelocity: this.verticalVelocity,
		})
		nextAltitude = constrainedDescent.nextAltitude
		this.verticalVelocity = constrainedDescent.verticalVelocity
		const safetyClimbSpeed = getSafetyClimbSpeed({
			currentTerrainHeight: this.flightCorridor.currentTerrainHeight,
			terrainCeiling: this.flightCorridor.terrainCeiling,
		})
		this.flightCorridor.safetyClimbSpeed = safetyClimbSpeed
		if (nextAltitude < this.flightCorridor.minimumAltitude) {
			const safetyAltitude = Math.max(
				previousAltitude,
				MathUtils.damp(
					nextAltitude,
					this.flightCorridor.minimumAltitude,
					FLIGHT_LIMITS.safetyClimbResponse,
					dt,
				),
			)
			nextAltitude = Math.min(safetyAltitude, previousAltitude + safetyClimbSpeed * dt)
		}

		this.position.y = MathUtils.clamp(
			nextAltitude,
			this.flightCorridor.collisionAltitude,
			this.flightCorridor.maximumAltitude,
		)
		// A zero delta (THREE.Timer reports one while the page is hidden) would
		// make this NaN, and the pitch lerp would keep the NaN for good.
		this.actualVerticalSpeed = dt > 0 ? (this.position.y - previousAltitude) / dt : 0

		if (
			(this.position.y === this.flightCorridor.maximumAltitude && this.verticalVelocity > 0) ||
			(this.position.y === this.flightCorridor.collisionAltitude && this.verticalVelocity < 0)
		) {
			this.verticalVelocity = 0
		}
	}

	update(dt) {
		this.translateZ(Math.abs(this.speed * dt))
		this.rotation.y += Math.PI * -this.cursor.x * dt * 0.2
		this.updateAltitude(dt)
		this.propeller.update(dt)
		const visualSpeedEffect = this.getVisualSpeedEffect()

		this.model.rotation.z = MathUtils.lerp(
			this.model.rotation.z,
			Math.PI * this.cursor.x * 0.25 * (1 - this.acceleration * 0.5),
			dt * 5,
		)
		const pitch = MathUtils.clamp(
			this.actualVerticalSpeed / FLIGHT_LIMITS.maximumVerticalSpeed,
			-1,
			1,
		)
		this.model.rotation.x = MathUtils.lerp(this.model.rotation.x, -Math.PI * pitch * 0.08, dt * 5)

		// The speed follows the effect once the intro has handed over.
		if (this.followCamera.active) this.updateSpeed(this.acceleration)
		this.followCamera.update(dt, visualSpeedEffect, this.cursor.x)

		this.speed = MathUtils.lerp(this.speed, this.baseSpeed, dt * 0.3)
		this.uniforms.uAcceleration.value = Math.max(visualSpeedEffect, 0)
		this.acceleration = getNextSpeedEffect(this.acceleration, this.input.takeRequest(dt), dt)
		this.wingTrails.record(
			this,
			this.model,
			this.trailAnchor,
			this.cursor.x,
			this.speed,
			this.baseSpeed,
		)
		this.wingTrails.refresh()
	}

	setInputEnabled(enabled) {
		this.input.enabled = enabled
		// A wheel request held when input stops must not apply on resume.
		if (!enabled) this.input.requestTime = 0
	}

	dispose() {
		this.input.dispose()
	}

	getStats() {
		return {
			position: {
				x: this.position.x,
				y: this.position.y,
				z: this.position.z,
			},
			speed: this.speed,
			speedEffect: this.acceleration,
			visualSpeedEffect: this.getVisualSpeedEffect(),
			terrainBrakeEffect: this.terrainBrakeEffect,
			pointerYRatio: this.pointerYRatio,
			verticalInput: getVerticalInput(this.pointerYRatio),
			verticalVelocity: this.verticalVelocity,
			camera: this.camera
				? {
						x: this.camera.position.x,
						y: this.camera.position.y,
						z: this.camera.position.z,
						fov: this.camera.fov,
					}
				: null,
			// A snapshot: the corridor and its samples are filled in place.
			corridor: this.flightCorridor
				? {
						...this.flightCorridor,
						samples: this.flightCorridor.samples.map((sample) => ({ ...sample })),
					}
				: null,
		}
	}
}
