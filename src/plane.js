import {
	BufferAttribute,
	BufferGeometry,
	DoubleSide,
	DynamicDrawUsage,
	MathUtils,
	Mesh,
	MeshBasicMaterial,
	Object3D,
	Quaternion,
	Vector2,
	Vector3,
} from 'three'
import common from './shaders/common.glsl'
import projectVertex from './shaders/project-vertex-plane.glsl'
import TrailHistory, { getTrailWidths } from './trailHistory.js'
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
const TRAIL_LENGTH = 60
const TRAIL_SEGMENTS = 30

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
		this.trailHistory = new TrailHistory()
		this.trailCenter = new Vector3()
		this.trailForward = new Vector3()
		this.trailWing = new Vector3()
		this.trailQuaternion = new Quaternion()
		this.trailRow = new Float64Array(11)
		this.trailWidths = new Float32Array(2)
		this.trailUniforms = {
			uTrailRibbonWidth: { value: this.params.trails.ribbonWidth },
			uTrailLineWidth: { value: this.params.trails.lineWidth },
			uTrailBorderWidth: { value: this.params.trails.borderWidth },
			uTrailOuterFrequency: { value: this.params.trails.outerEdge.frequency },
			uTrailOuterAmplitude: { value: this.params.trails.outerEdge.amplitude },
			uTrailInnerFrequency: { value: this.params.trails.innerEdge.frequency },
			uTrailInnerAmplitude: { value: this.params.trails.innerEdge.amplitude },
		}

		const positions = new Float32Array((TRAIL_SEGMENTS + 1) * 2 * 3)
		const uv = new Float32Array((TRAIL_SEGMENTS + 1) * 2 * 2)
		const widths = new Float32Array((TRAIL_SEGMENTS + 1) * 2 * 2)
		const indices = new Uint16Array(TRAIL_SEGMENTS * 6)
		for (let row = 0; row <= TRAIL_SEGMENTS; row++) {
			const v = 1 - row / TRAIL_SEGMENTS
			uv[row * 4] = 0
			uv[row * 4 + 1] = v
			uv[row * 4 + 2] = 1
			uv[row * 4 + 3] = v
			if (row === TRAIL_SEGMENTS) continue
			const i = row * 6
			const vertex = row * 2
			indices.set([vertex, vertex + 2, vertex + 1, vertex + 1, vertex + 2, vertex + 3], i)
		}
		const geometry = new BufferGeometry()
		const positionAttribute = new BufferAttribute(positions, 3)
		positionAttribute.setUsage(DynamicDrawUsage)
		const widthAttribute = new BufferAttribute(widths, 2)
		widthAttribute.setUsage(DynamicDrawUsage)
		geometry.setAttribute('position', positionAttribute)
		geometry.setAttribute('uv', new BufferAttribute(uv, 2))
		geometry.setAttribute('trailWidths', widthAttribute)
		geometry.setIndex(new BufferAttribute(indices, 1))
		geometry.setDrawRange(0, 0)
		const material = new MeshBasicMaterial({
			color: 0xffffff,
			side: DoubleSide,
			transparent: false,
		})

		this.trails = new Mesh(geometry, material)
		this.trails.frustumCulled = false

		material.onBeforeCompile = (shader) => {
			Object.assign(shader.uniforms, this.trailUniforms)
			shader.vertexShader = shader.vertexShader.replace(
				'#include <common>',
				`#include <common>
				attribute vec2 trailWidths;
				varying vec2 vTrailWidths;
				varying vec2 vUV;
				varying vec3 vTrailWorldPosition;`,
			)

			shader.vertexShader = shader.vertexShader.replace(
				'#include <project_vertex>',
				projectVertex,
			)

			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <common>',
				common +
					`
				varying vec2 vTrailWidths;
				varying vec2 vUV;
				varying vec3 vTrailWorldPosition;
				uniform float uTrailRibbonWidth;
				uniform float uTrailLineWidth;
				uniform float uTrailBorderWidth;
				uniform float uTrailOuterFrequency;
				uniform float uTrailOuterAmplitude;
				uniform float uTrailInnerFrequency;
				uniform float uTrailInnerAmplitude;
				`,
			)

			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <color_fragment>',
				`
				#include <color_fragment>
				float side = step(0.5, vUV.x);
				float widthFactor = side > 0.5 ? vTrailWidths.y : vTrailWidths.x;
				vec2 noisePosition = vec2(
					vTrailWorldPosition.x * 0.35 + vTrailWorldPosition.z * 0.5 + side * 19.0,
					vTrailWorldPosition.z * 0.35 + vTrailWorldPosition.y * 0.5 + side * 31.0
				);
				float taper = max(0.0, sin(3.14159265 * vUV.y));
				float noiseFade = taper * taper;
				float halfWidth = 0.5 * uTrailLineWidth / uTrailRibbonWidth * taper * widthFactor;
				float outerNoise = snoise(noisePosition * uTrailOuterFrequency) * 0.7
					+ snoise(noisePosition * uTrailOuterFrequency * 2.4 + 17.0) * 0.3;
				float innerNoise = snoise(noisePosition * uTrailInnerFrequency * 1.27 + 13.0) * 0.7
					+ snoise(noisePosition * uTrailInnerFrequency * 3.1 + 41.0) * 0.3;
				float stripeCenter = max(0.07,
					(uTrailLineWidth * 0.5 + uTrailOuterAmplitude + uTrailBorderWidth)
					/ uTrailRibbonWidth + 0.005);
				float outerEdge = stripeCenter - halfWidth
					+ outerNoise * uTrailOuterAmplitude / uTrailRibbonWidth * noiseFade * widthFactor;
				float innerEdge = stripeCenter + halfWidth
					+ innerNoise * uTrailInnerAmplitude / uTrailRibbonWidth * noiseFade * widthFactor;
				float edge = side > 0.5 ? 1.0 - vUV.x : vUV.x;
				float outlineWidth = uTrailBorderWidth / uTrailRibbonWidth * taper * widthFactor;
				if (halfWidth <= 0.0001 || edge < outerEdge - outlineWidth
					|| edge > innerEdge + outlineWidth) discard;
				float core = step(outerEdge, edge) * step(edge, innerEdge);
				diffuseColor.rgb *= mix(vec3(0.03), vec3(1.0), core);
				`,
			)
		}
	}

	updateTrails() {
		this.trailUniforms.uTrailRibbonWidth.value = this.params.trails.ribbonWidth
		this.trailUniforms.uTrailLineWidth.value = this.params.trails.lineWidth
		this.trailUniforms.uTrailBorderWidth.value = this.params.trails.borderWidth
		this.trailUniforms.uTrailOuterFrequency.value = this.params.trails.outerEdge.frequency
		this.trailUniforms.uTrailOuterAmplitude.value = this.params.trails.outerEdge.amplitude
		this.trailUniforms.uTrailInnerFrequency.value = this.params.trails.innerEdge.frequency
		this.trailUniforms.uTrailInnerAmplitude.value = this.params.trails.innerEdge.amplitude
		this.updateWorldMatrix(true, false)
		this.model.getWorldQuaternion(this.trailQuaternion)
		this.trailForward.set(0, 0, 1).applyQuaternion(this.quaternion)
		this.trailWing.set(1, 0, 0).applyQuaternion(this.trailQuaternion)
		this.trailCenter.copy(this.position).addScaledVector(this.trailForward, -1.2)
		this.trailCenter.y -= 0.15

		getTrailWidths(
			this.cursor.x,
			this.speed,
			this.baseSpeed,
			this.trailWidths,
		)
		this.trailHistory.push(
			this.trailCenter,
			this.trailForward,
			this.trailWing,
			this.trailWidths[0],
			this.trailWidths[1],
			TRAIL_LENGTH,
		)

		const geometry = this.trails.geometry
		const positions = geometry.attributes.position.array
		const widths = geometry.attributes.trailWidths.array
		for (let row = 0; row <= TRAIL_SEGMENTS; row++) {
			this.trailHistory.sample(row * TRAIL_LENGTH / TRAIL_SEGMENTS, this.trailRow)
			const x = this.trailRow[0]
			const y = this.trailRow[1]
			const z = this.trailRow[2]
			const wingLength = Math.hypot(
				this.trailRow[6],
				this.trailRow[7],
				this.trailRow[8],
			)
			const wingScale = wingLength > 0
				? this.params.trails.ribbonWidth * 0.5 / wingLength
				: 0
			const wingX = this.trailRow[6] * wingScale
			const wingY = this.trailRow[7] * wingScale
			const wingZ = this.trailRow[8] * wingScale
			const i = row * 6
			positions[i] = x - wingX
			positions[i + 1] = y - wingY
			positions[i + 2] = z - wingZ
			positions[i + 3] = x + wingX
			positions[i + 4] = y + wingY
			positions[i + 5] = z + wingZ
			const widthOffset = row * 4
			widths[widthOffset] = this.trailRow[9]
			widths[widthOffset + 1] = this.trailRow[10]
			widths[widthOffset + 2] = this.trailRow[9]
			widths[widthOffset + 3] = this.trailRow[10]
		}
		geometry.setDrawRange(
			0,
			Math.min(TRAIL_SEGMENTS, Math.ceil(this.trailHistory.availableDistance / 2)) * 6,
		)
		geometry.attributes.position.needsUpdate = true
		geometry.attributes.trailWidths.needsUpdate = true
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
		this.updateTrails()
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
