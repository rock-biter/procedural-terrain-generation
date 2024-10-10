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
import gsap from 'gsap'
const V3 = new Vector3(0, 0, 0)
const isMobile = window.innerWidth < 768

export default class Plane extends Object3D {
	velocity = new Vector3(0, 0, 20)
	baseSpeed = 35
	speed = 0
	acceleration = new Vector3(1, 0, 0)
	cursor = new Vector2(0, 0)
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
				`
			)

			shader.vertexShader = shader.vertexShader.replace(
				'#include <project_vertex>',
				projectVertex +
					`
				vUV = vec3( uv, 1 ).xy; `
			)

			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <common>',
				common +
					`
				uniform vec4 uRotation;
				uniform float uAcceleration;
				varying vec2 vUV; 
				`
			)

			// console.log(shader.fragmentShader)

			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <color_fragment>',
				`
				float min = 1. - vUV.y * 0.15 - 0.85;
				float pct = 1. - step(min, vUV.x) + step(1. - min,vUV.x);
				diffuseColor.a = smoothstep(0.15,1.2,max(abs(uRotation.z),(uAcceleration - 0.4) * 1.5) ) * pct * smoothstep(0.7,1.,vUV.y);

				// diffuseColor.a *= pct;
				`
			)
		}
	}

	updateSpeedEffect(progress) {
		// console.log(progress)

		this.updateSpeed(progress)

		const newFov = MathUtils.lerp(this.initialFov, this.finalFov, progress)
		// const length = this.RATIO / Math.tan(MathUtils.degToRad(newFov / 2))

		// this.camera.position.normalize().multiplyScalar(length)
		this.camera.fov = newFov
		// this.camera.position.z = this.initialPosition.z - 5 * progress
		this.finalPosition.z = this.initialPosition.z - 5 * progress
		// this.camera.position.y = this.initialPosition.y - 3 * progress

		// this.camera.lookAt(new Vector3(0, 6.9, 0).add(this.position))
		this.camera.updateProjectionMatrix()
	}

	addEffect() {
		this.initialPosition = new Vector3(0, 7, -18)
		this.finalPosition = new Vector3(0, 7, -18)
		this.initialFov = this.camera.fov
		this.finalFov = this.camera.fov + 30
		this.intialTan = Math.tan(MathUtils.degToRad(this.initialFov / 2))
		this.RATIO = this.initialPosition.length() * this.intialTan
	}

	updateSpeed(progress) {
		this.speed = this.baseSpeed * (1 + progress * 2)
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
				dt * 5
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

			this.finalPosition.z = this.initialPosition.z - 7 * this.acceleration

			this.finalPosition.x = -this.cursor.x * 5
			this.camera.position.lerp(this.finalPosition, dt * 5)

			this.finalPosition.z = MathUtils.lerp(
				this.finalPosition.z,
				this.initialPosition.z,
				dt * 15
			)

			const desFov = MathUtils.lerp(
				this.initialFov,
				this.finalFov,
				this.acceleration
			)

			let fov = MathUtils.lerp(this.camera.fov, desFov, dt * 5)
			fov = MathUtils.lerp(fov, this.initialFov, dt * 0.6)

			this.camera.fov = fov
			this.camera.updateProjectionMatrix()
		}
		// this.position

		this.speed = MathUtils.lerp(this.speed, this.baseSpeed, dt * 0.3)
		this.uniforms.uAcceleration.value = this.acceleration
		this.acceleration = MathUtils.lerp(this.acceleration, 0, dt * 0.6)
	}

	addCamera(camera) {
		if (!camera) return

		this.camera = camera
		this.add(camera)
	}

	initCursor() {
		window.addEventListener('mousemove', (e) => {
			const x = (e.clientX / innerWidth) * 2 - 1
			const y = -(e.clientY / innerHeight) * 2 + 1

			this.cursor.set(x, y)
		})

		window.addEventListener('wheel', () => {
			gsap.to(this, { acceleration: 1, duration: 0.2 })
			// this.acceleration = MathUtils.clamp(0, 1, this.acceleration)

			// console.log(this.acceleration)
		})

		window.addEventListener('touchmove', (e) => {
			const touch = e.touches[0]
			const x = (touch.clientX / innerWidth) * 2 - 1
			const y = -(touch.clientY / innerHeight) * 2 + 1

			this.cursor.set(x / 1.5, y)
		})
	}
}
