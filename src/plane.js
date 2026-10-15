import { MathUtils, Matrix4, Object3D, Vector3 } from 'three'
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
import {
	canTurnAround,
	getBarrelRollAngle,
	getCircleFraming,
	getClickManeuver,
	getImmelmannFraming,
	getImmelmannPose,
	getImmelmannRigSpeedFactor,
	getLoopFramingWeight,
	getLoopPose,
	getLoopRigSpeedFactor,
	getManeuverRadius,
	getManeuverSmoke,
	MANEUVER,
	MANEUVER_LIMITS,
	stepAltitudeCeiling,
	wrapAngle,
} from './maneuverPolicy'
const V3 = new Vector3(0, 0, 0)
const RIG_BEFORE = new Matrix4()
const REBASE = new Matrix4()

// The player airplane: flight (speed, turn, terrain-aware altitude), the
// banking model and its maneuvers (src/maneuverPolicy.js: the barrel roll,
// the loop, and the Immelmann), and the parts it drives: the input
// (src/flightInput.js), the chase camera (src/followCamera.js), the propeller
// (src/propeller.js), and the wing trails (src/wingTrails.js). The Plane
// itself is the rig the camera, the streaming, and most of the world follow:
// it only moves forward and turns about Y, while a loop or an Immelmann
// moves the airplane model away from it and back.
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
	// The model's rotation.z is the steering bank plus a maneuver's roll, kept
	// apart so the bank's ease never pulls the roll back.
	bank = 0
	roll = 0
	// The maneuver under way, or null: its `type` (MANEUVER), seconds
	// `elapsed`, `settings` (a copy of params[type] as it started, so a ?gui=1
	// edit does not make it jump), `radius`, `direction` (1 or -1, toward the
	// turn as it started), the camera's `fov` then, and the Immelmann's `phase`.
	maneuver = null
	// The loop's and the Immelmann's pose of the model, and the camera framing
	// (src/maneuverPolicy.js), filled in place.
	maneuverPose = { phase: 1, y: 0, z: 0, pitch: 0, roll: 0 }
	framing = { weight: 0, position: new Vector3(), target: new Vector3(), floor: 0 }
	// The flight ceiling, raised above FLIGHT_LIMITS.maximumAltitude after an
	// Immelmann and coming back down at `speed` (stepAltitudeCeiling()).
	ceiling = { altitude: FLIGHT_LIMITS.maximumAltitude, speed: 0 }
	uniforms = {
		uAcceleration: { value: 0 },
	}

	// `modelConfig` is the airplane's entry in AIRPLANE_MODELS
	// (src/airplaneModels.js): trail anchor and propeller data. A click on
	// `canvas` starts a loop or a barrel roll.
	constructor(airplane, params, camera, modelConfig, canvas) {
		super()

		this.params = params
		this.model = airplane
		this.modelConfig = modelConfig
		this.trailAnchor = new Vector3().fromArray(modelConfig.trailAnchor)
		this.add(airplane)
		this.input = new FlightInput(window, canvas)
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
	// heading stays, the corridor, climb, maneuver, and wing trails start over.
	teleport(x, y, z) {
		this.endManeuver()
		this.position.set(x, y, z)
		this.verticalVelocity = 0
		this.actualVerticalSpeed = 0
		this.ceiling.altitude = FLIGHT_LIMITS.maximumAltitude
		this.ceiling.speed = 0
		this.resetTerrainState()
		this.wingTrails.clear()
	}

	// `verticalInput` is -1 (descend) to 1 (climb).
	updateAltitude(dt, verticalInput) {
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
		// Raised after an Immelmann, until it has come back down.
		this.flightCorridor.maximumAltitude = Math.max(
			this.flightCorridor.maximumAltitude,
			this.ceiling.altitude,
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

	get isRolling() {
		return this.maneuver?.type === MANEUVER.BARREL_ROLL
	}

	// A loop or an Immelmann: the airplane leaves the rig, steering waits, and
	// the speed effect holds.
	get isFlyingFigure() {
		return this.maneuver !== null && this.maneuver.type !== MANEUVER.BARREL_ROLL
	}

	// An Immelmann: the chunk streaming (src/chunkManager.js) keeps both
	// headings, so the turn neither drops the terrain the camera still looks
	// at nor waits for the new heading's.
	get isTurningAround() {
		return this.maneuver?.type === MANEUVER.IMMELMANN
	}

	// Starts the `type` maneuver (MANEUVER) toward the current turn (right in
	// level flight), unless one is under way, the Play intro has not handed
	// over yet (the speed does not follow the effect before), or a loop or an
	// Immelmann has no room below the top altitude. Returns whether it started.
	startManeuver(type) {
		if (this.maneuver || !this.followCamera.active) return false
		const settings = { ...this.params[type] }
		let radius = 0
		if (type !== MANEUVER.BARREL_ROLL) {
			radius = getManeuverRadius(settings.radius, this.position.y)
			if (radius === null) return false
		}
		this.maneuver = {
			type,
			elapsed: 0,
			settings,
			radius,
			direction: this.cursor.x < 0 ? -1 : 1,
			fov: this.camera.getEffectiveFOV(),
			aspect: this.camera.aspect,
			phase: 1,
		}
		if (type !== MANEUVER.BARREL_ROLL) this.wingTrails.startManeuver()
		return true
	}

	// Back to plain flight: the model on the rig, level.
	endManeuver() {
		if (this.maneuver && this.maneuver.type !== MANEUVER.BARREL_ROLL) {
			this.model.position.set(0, 0, 0)
			this.model.rotation.x = 0
		}
		this.maneuver = null
		this.roll = 0
		this.framing.weight = 0
	}

	// Clicks and wheel gestures are taken every frame, so one during a
	// maneuver is dropped, not queued: a click in the top of the screen loops
	// (or rolls, without room above for a loop), elsewhere it rolls; the wheel
	// back at cruise speed turns around with an Immelmann, and the rest of
	// that gesture does not brake.
	takeManeuverRequests() {
		const clickRatio = this.input.takeClickRequest()
		if (clickRatio !== null && !this.maneuver) {
			const type = getClickManeuver(clickRatio)
			if (!this.startManeuver(type) && type === MANEUVER.LOOP) {
				this.startManeuver(MANEUVER.BARREL_ROLL)
			}
		}
		if (!this.input.takeTurnRequest()) return
		if (this.maneuver) {
			this.input.consumeWheelGesture()
		} else if (canTurnAround(this.acceleration) && this.startManeuver(MANEUVER.IMMELMANN)) {
			this.input.consumeWheelGesture()
		}
	}

	// The maneuver's progress (0 to 1) after `dt` more seconds, so it freezes
	// with the ?debug=1 pause; 0 without one.
	advanceManeuver(dt) {
		const maneuver = this.maneuver
		if (!maneuver) return 0
		maneuver.elapsed += dt
		const { duration } = maneuver.settings
		return duration > 0 ? Math.min(maneuver.elapsed / duration, 1) : 1
	}

	// The rig's share of the flight speed `progress` into the maneuver,
	// negative to fly back: it slows down during a loop, and during an
	// Immelmann's climb it turns back to fly on with the airplane over the top.
	getRigSpeedFactor(progress) {
		const maneuver = this.maneuver
		if (maneuver?.type === MANEUVER.LOOP) {
			return getLoopRigSpeedFactor(progress, maneuver.settings.rigSpeed)
		}
		if (maneuver?.type === MANEUVER.IMMELMANN) {
			return getImmelmannRigSpeedFactor(progress, maneuver.settings)
		}
		return 1
	}

	// Turns the rig around once an Immelmann passes its top, before the rig
	// moves this frame, so it moves on along the new heading.
	updateTurnaround(progress) {
		const maneuver = this.maneuver
		if (maneuver?.type !== MANEUVER.IMMELMANN || maneuver.phase !== 1) return
		if (progress < maneuver.settings.climbShare) return
		maneuver.phase = 2
		this.turnAround(maneuver.radius)
	}

	// Poses the model `progress` into the maneuver: the barrel roll's roll, or
	// the loop's and the Immelmann's place, pitch, and roll on the rig.
	applyManeuverPose(progress) {
		const maneuver = this.maneuver
		if (!maneuver) return
		if (maneuver.type === MANEUVER.BARREL_ROLL) {
			this.roll = getBarrelRollAngle(maneuver.elapsed, maneuver.settings, maneuver.direction)
			return
		}
		const pose = this.maneuverPose
		if (maneuver.type === MANEUVER.LOOP) {
			getLoopPose(progress, maneuver.settings, maneuver.radius, pose)
		} else {
			getImmelmannPose(progress, maneuver.settings, maneuver.radius, maneuver.direction, pose)
		}
		this.model.position.set(0, pose.y, pose.z)
		this.roll = pose.roll
	}

	// The Immelmann's top: the rig rises to the airplane, 2 radii up, and turns
	// around, where the airplane keeps the same pose (a pitch of -PI is a yaw
	// of PI with a roll of PI) and, flying back with the rig, the same speed. The camera stays where it was in the
	// world, the ceiling lets the rig stay up there, and the terrain corridor
	// starts over on the new heading, so the turn does not brake.
	turnAround(radius) {
		this.updateMatrix()
		RIG_BEFORE.copy(this.matrix)
		this.position.y += 2 * radius
		this.rotation.y = wrapAngle(this.rotation.y + Math.PI)
		this.updateMatrix()
		this.updateMatrixWorld()
		// The rig is a direct scene child: the old local pose, through the old
		// rig and back through the new one.
		REBASE.copy(this.matrix).invert().multiply(RIG_BEFORE)
		this.followCamera.rebase(REBASE)
		this.ceiling.altitude = Math.max(this.ceiling.altitude, this.position.y)
		this.ceiling.speed = 0
		this.verticalVelocity = 0
		this.actualVerticalSpeed = 0
		this.resetTerrainState()
	}

	// The camera framing `progress` into a loop or an Immelmann, with its
	// `floor`: the lowest local height above the ground (or the sea) under the
	// framing place and under the camera, which beside the flight may rise.
	updateFraming(progress) {
		const maneuver = this.maneuver
		const framing = this.framing
		const { settings, radius, fov, aspect, direction } = maneuver
		if (maneuver.type === MANEUVER.LOOP) {
			const weight = getLoopFramingWeight(progress)
			getCircleFraming(weight, radius, fov, aspect, settings, direction, framing)
		} else {
			getImmelmannFraming(progress, radius, fov, aspect, settings, direction, framing)
		}
		framing.floor = -Infinity
		if (this.terrainSampler) {
			V3.copy(framing.position).applyQuaternion(this.quaternion).add(this.position)
			let ground = this.terrainSampler(V3.x, V3.z)
			V3.copy(this.camera.position).applyQuaternion(this.quaternion).add(this.position)
			ground = Math.max(ground, this.terrainSampler(V3.x, V3.z), 0)
			framing.floor = ground + MANEUVER_LIMITS.cameraClearance - this.position.y
		}
		return framing
	}

	update(dt) {
		this.takeManeuverRequests()
		const progress = this.advanceManeuver(dt)
		const figure = this.isFlyingFigure
		// Steering waits during a loop or an Immelmann.
		const turnInput = figure ? 0 : this.cursor.x
		this.updateTurnaround(progress)
		this.translateZ(Math.abs(this.speed) * this.getRigSpeedFactor(progress) * dt)
		this.rotation.y += Math.PI * -turnInput * dt * 0.2
		this.updateAltitude(dt, figure ? 0 : getVerticalInput(this.pointerYRatio))
		this.propeller.update(dt)
		const visualSpeedEffect = this.getVisualSpeedEffect()

		this.applyManeuverPose(progress)
		this.bank = MathUtils.lerp(
			this.bank,
			Math.PI * turnInput * 0.25 * (1 - this.acceleration * 0.5),
			dt * 5,
		)
		this.model.rotation.z = wrapAngle(this.bank + this.roll)
		if (figure) {
			this.model.rotation.x = this.maneuverPose.pitch
		} else {
			const pitch = MathUtils.clamp(
				this.actualVerticalSpeed / FLIGHT_LIMITS.maximumVerticalSpeed,
				-1,
				1,
			)
			this.model.rotation.x = MathUtils.lerp(this.model.rotation.x, -Math.PI * pitch * 0.08, dt * 5)
		}

		// The speed follows the effect once the intro has handed over.
		if (this.followCamera.active) this.updateSpeed(this.acceleration)
		this.followCamera.update(
			dt,
			visualSpeedEffect,
			turnInput,
			figure ? this.updateFraming(progress) : null,
		)

		this.speed = MathUtils.lerp(this.speed, this.baseSpeed, dt * 0.3)
		this.uniforms.uAcceleration.value = Math.max(visualSpeedEffect, 0)
		// A barrel roll holds a full boost, a loop or an Immelmann holds the
		// effect where it was; a wheel request is still spent.
		const wheelRequest = this.input.takeRequest(dt)
		if (!figure) {
			this.acceleration = getNextSpeedEffect(
				this.acceleration,
				this.isRolling ? 1 : wheelRequest,
				dt,
			)
			stepAltitudeCeiling(this.ceiling, dt)
		}
		this.wingTrails.updateLength(dt, figure)
		this.wingTrails.record(
			this,
			this.model,
			this.trailAnchor,
			turnInput,
			this.speed,
			this.baseSpeed,
			this.bank,
			figure ? getManeuverSmoke(progress) : 0,
		)
		this.wingTrails.refresh()
		// After its last pose has been drawn and recorded.
		if (this.maneuver && progress >= 1) this.endManeuver()
	}

	setInputEnabled(enabled) {
		this.input.enabled = enabled
		// A wheel or click request held when input stops must not apply on resume.
		if (!enabled) this.input.clearRequests()
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
			// The maneuver under way, or null. `roll.angle` is the model's
			// rotation.z (the bank plus the roll) and `pitch` its rotation.x, both
			// in [-PI, PI); `modelOffset` is the model's place on the rig.
			maneuver: this.maneuver
				? {
						type: this.maneuver.type,
						elapsed: this.maneuver.elapsed,
						duration: this.maneuver.settings.duration,
						radius: this.maneuver.radius,
						phase: this.maneuver.phase,
						framing: this.framing.weight,
					}
				: null,
			roll: {
				active: this.isRolling,
				angle: this.model.rotation.z,
				bank: this.bank,
			},
			pitch: this.model.rotation.x,
			heading: this.rotation.y,
			modelOffset: {
				y: this.model.position.y,
				z: this.model.position.z,
			},
			altitudeCeiling: this.ceiling.altitude,
			trailLength: this.wingTrails.length,
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
