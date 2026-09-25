import {
	BoxGeometry,
	DoubleSide,
	MathUtils,
	Mesh,
	MeshBasicMaterial,
	MeshNormalMaterial,
	Object3D,
	PlaneGeometry,
	Vector2,
	Vector3,
} from 'three'
import common from './shaders/common.glsl'
import projectVertex from './shaders/project-vertex-plane.glsl'
import {
	constrainDescentToMinimum,
	FLIGHT_LIMITS,
	getFlightCorridor,
	getSafetyClimbSpeed,
	getSpeedForEffect,
	getTerrainAdjustedSpeed,
	getTerrainBrakeImpulse,
	getTerrainSlowdown,
	getVerticalInput,
	smoothMinimumAltitude,
} from './flightPolicy'
import gsap from 'gsap'
const V3 = new Vector3(0, 0, 0)
const isMobile = window.innerWidth < 768

export default class Plane extends Object3D {
	velocity = new Vector3(0, 0, 35)
	baseSpeed = 35
	speed = 0
	cursor = new Vector2(0, 0)
	pointerYRatio =
		(FLIGHT_LIMITS.verticalHoldTop + FLIGHT_LIMITS.verticalHoldBottom) / 2
	verticalVelocity = 0
	actualVerticalSpeed = 0
	terrainSampler = null
	flightCorridor = null
	smoothedMinimumAltitude = null
	terrainSlowdown = 0
	terrainBrakeEffect = 0
	initialFov
	finalFov
	initialPosition
	finalPosition
	intialTan
	RATIO
	acceleration = 0
	uniforms = {
		uAcceleration: { value: 0 },
	}

	constructor(airplane, noise, params, camera) {
		// const geometry = new BoxGeometry(1, 1, 1)
		// const material = new MeshNormalMaterial()

		// super(geometry, material)
		super()

		this.noise = noise
		this.params = params
		this.model = airplane
		this.add(airplane)
		camera && this.addCamera(camera)
		this.addTrails()

		this.initCursor()
	}

	addTrails() {
		const l = 60
		const plane = new PlaneGeometry(7.3, l, 1, l * 2)
		plane.rotateX(Math.PI * 0.5)
		plane.translate(0, -0.15, -l * 0.5 - 1.2)
		const material = new MeshBasicMaterial({
			color: 0xffffff,
			side: DoubleSide,
			transparent: true,
			// opacity: 0.8,
			// wireframe: true,
		})

		this.trails = new Mesh(plane, material)
		// console.log(this.trails)
		this.add(this.trails)

		material.onBeforeCompile = (shader) => {
			shader.uniforms = {
				...shader.uniforms,
				...this.uniforms,
				uRotation: { value: this.model.rotation },
			}

			shader.vertexShader = shader.vertexShader.replace(
				'#include <common>',
				common +
					`
				uniform vec4 uRotation;
				varying vec2 vUV; 
				`,
			)

			shader.vertexShader = shader.vertexShader.replace(
				'#include <project_vertex>',
				projectVertex +
					`
				vUV = vec3( uv, 1 ).xy; `,
			)

			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <common>',
				common +
					`
				uniform vec4 uRotation;
				uniform float uAcceleration;
				varying vec2 vUV; 
				`,
			)

			// console.log(shader.fragmentShader)

			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <color_fragment>',
				`
				float min = 1. - vUV.y * 0.15 - 0.85;
				float pct = 1. - step(min, vUV.x) + step(1. - min,vUV.x);
				diffuseColor.a = smoothstep(0.15,1.2,max(abs(uRotation.z),(uAcceleration - 0.4) * 1.5) ) * pct * smoothstep(0.7,1.,vUV.y);

				// diffuseColor.a *= pct;
				`,
			)
		}
	}

	updateSpeedEffect(progress) {
		// console.log(progress)

		this.updateSpeed(progress)

		const newFov = this.getEffectFov(progress)
		// const length = this.RATIO / Math.tan(MathUtils.degToRad(newFov / 2))

		// this.camera.position.normalize().multiplyScalar(length)
		this.camera.fov = newFov
		// this.camera.position.z = this.initialPosition.z - 5 * progress
		this.finalPosition.z =
			this.initialPosition.z - FLIGHT_LIMITS.cameraEffectDistance * progress
		// this.camera.position.y = this.initialPosition.y - 3 * progress

		// this.camera.lookAt(new Vector3(0, 6.9, 0).add(this.position))
		this.camera.updateProjectionMatrix()
	}

	addEffect() {
		this.initialPosition = new Vector3(0, 7, -18)
		this.finalPosition = new Vector3(0, 7, -18)
		this.initialFov = this.camera.fov
		this.finalFov = this.camera.fov + FLIGHT_LIMITS.boostFovOffset
		this.intialTan = Math.tan(MathUtils.degToRad(this.initialFov / 2))
		this.RATIO = this.initialPosition.length() * this.intialTan
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

	getEffectFov(effect) {
		const offset =
			effect >= 0
				? FLIGHT_LIMITS.boostFovOffset * effect
				: FLIGHT_LIMITS.brakeFovOffset * effect

		return this.initialFov + offset
	}

	setTerrainSampler(sampleHeight) {
		this.terrainSampler = sampleHeight
	}

	updateAltitude(dt) {
		if (!this.terrainSampler) return

		V3.set(0, 0, 1).applyQuaternion(this.quaternion)
		this.flightCorridor = getFlightCorridor({
			x: this.position.x,
			z: this.position.z,
			forwardX: V3.x,
			forwardZ: V3.z,
			speed: this.speed,
			baseSpeed: this.baseSpeed,
			sampleHeight: this.terrainSampler,
		})
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
					MathUtils.damp(
						this.terrainBrakeEffect,
						0,
						FLIGHT_LIMITS.terrainBrakeReleaseResponse,
						dt,
					),
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
		const desiredVerticalSpeed =
			verticalInput * FLIGHT_LIMITS.maximumVerticalSpeed
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
			nextAltitude = Math.min(
				safetyAltitude,
				previousAltitude + safetyClimbSpeed * dt,
			)
		}

		this.position.y = MathUtils.clamp(
			nextAltitude,
			this.flightCorridor.collisionAltitude,
			this.flightCorridor.maximumAltitude,
		)
		this.actualVerticalSpeed = (this.position.y - previousAltitude) / dt

		if (
			(this.position.y === this.flightCorridor.maximumAltitude &&
				this.verticalVelocity > 0) ||
			(this.position.y === this.flightCorridor.collisionAltitude &&
				this.verticalVelocity < 0)
		) {
			this.verticalVelocity = 0
		}
	}

	update(dt) {
		// const nextPos = this.position.clone()

		V3.set(0, 0, 1).multiplyScalar(this.speed * dt)
		this.translateZ(V3.length())
		// this.rotation.z = 0
		// V3.set(-1, 0, 0)
		// 	.multiplyScalar(this.cursor.x * 0.2)
		// 	.applyQuaternion(this.quaternion)
		// nextPos.addScaledVector(V3, dt)

		this.rotation.y += Math.PI * -this.cursor.x * dt * 0.2
		this.updateAltitude(dt)
		const visualSpeedEffect = this.getVisualSpeedEffect()
		// V3.set(0, 1, 0)
		// 	.multiplyScalar(this.cursor.y * 0.2)
		// 	.applyQuaternion(this.quaternion)
		// nextPos.addScaledVector(V3, dt)

		// this.lookAt(nextPos)
		// this.position.copy(nextPos)

		if (this.model) {
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
			this.model.rotation.x = MathUtils.lerp(
				this.model.rotation.x,
				-Math.PI * pitch * 0.08,
				dt * 5,
			)
		}

		if (this.camera && this.finalPosition && this.initialPosition) {
			// 	this.camera.position.x = MathUtils.lerp(
			// 		this.camera.position.x,
			// 		-this.cursor.x * 5,
			// 		dt * 1
			// 	)
			// this.updateSpeedEffect(this.acceleration)
			this.updateSpeed(this.acceleration)

			this.finalPosition.z =
				this.initialPosition.z -
				FLIGHT_LIMITS.cameraEffectDistance * visualSpeedEffect
			this.finalPosition.x = -this.cursor.x * 5
			this.camera.position.lerp(this.finalPosition, dt * 5)

			const desFov = this.getEffectFov(visualSpeedEffect)

			let fov = MathUtils.lerp(this.camera.fov, desFov, dt * 5)

			this.camera.fov = fov
			this.camera.updateProjectionMatrix()
		}
		// this.position

		this.speed = MathUtils.lerp(this.speed, this.baseSpeed, dt * 0.3)
		this.uniforms.uAcceleration.value = Math.max(visualSpeedEffect, 0)
		this.acceleration = MathUtils.lerp(this.acceleration, 0, dt * 0.6)
	}

	addCamera(camera) {
		if (!camera) return

		this.camera = camera
		this.add(camera)
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
			corridor: this.flightCorridor ? { ...this.flightCorridor } : null,
		}
	}

	initCursor() {
		window.addEventListener('mousemove', (e) => {
			const x = (e.clientX / innerWidth) * 2 - 1
			this.pointerYRatio = e.clientY / innerHeight
			const y = 1 - this.pointerYRatio * 2

			this.cursor.set(x, y)
		})

		window.addEventListener('wheel', (e) => {
			if (e.deltaY === 0) return
			gsap.to(this, {
				acceleration: e.deltaY > 0 ? 1 : -1,
				duration: 0.2,
				overwrite: 'auto',
			})
			// this.acceleration = MathUtils.clamp(0, 1, this.acceleration)

			// console.log(this.acceleration)
		})

		window.addEventListener('touchmove', (e) => {
			const touch = e.touches[0]
			const x = (touch.clientX / innerWidth) * 2 - 1
			this.pointerYRatio = touch.clientY / innerHeight
			const y = 1 - this.pointerYRatio * 2

			this.cursor.set(x / 1.5, y)
		})
	}
}
