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
const V3 = new Vector3(0, 0, 0)
const isMobile = window.innerWidth < 768

export default class Plane extends Object3D {
	velocity = new Vector3(0, 0, 20)
	baseSpeed = 20
	speed = 0
	acceleration = new Vector3(1, 0, 0)
	cursor = new Vector2(0, 0)

	constructor(airplane, noise, params) {
		// const geometry = new BoxGeometry(1, 1, 1)
		// const material = new MeshNormalMaterial()

		// super(geometry, material)
		super()

		this.noise = noise
		this.params = params
		this.model = airplane
		this.add(airplane)
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
		console.log(this.trails)
		this.add(this.trails)

		material.onBeforeCompile = (shader) => {
			shader.uniforms = {
				...shader.uniforms,
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
				varying vec2 vUV; 
				`
			)

			console.log(shader.fragmentShader)

			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <color_fragment>',
				`
				float min = 1. - vUV.y * 0.15 - 0.85;
				float pct = 1. - step(min, vUV.x) + step(1. - min,vUV.x);
				diffuseColor.a = smoothstep(0.15,1.2,abs(uRotation.z) ) * pct * smoothstep(0.7,1.,vUV.y);

				// diffuseColor.a *= pct;
				`
			)
		}
	}

	update(dt) {
		// const nextPos = this.position.clone()
		const speedVar = isMobile
			? 0
			: (this.cursor.y + 0.5) * this.baseSpeed * 0.75

		this.speed = MathUtils.lerp(this.speed, this.baseSpeed + speedVar, dt * 3)

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
				Math.PI * this.cursor.x * 0.25,
				dt * 5
			)
		}

		if (this.camera) {
			this.camera.position.x = MathUtils.lerp(
				this.camera.position.x,
				-this.cursor.x * 5,
				dt * 1
			)
		}
		// this.position
	}

	initCursor() {
		window.addEventListener('mousemove', (e) => {
			const x = (e.clientX / innerWidth) * 2 - 1
			const y = -(e.clientY / innerHeight) * 2 + 1

			this.cursor.set(x, y)
		})

		window.addEventListener('touchmove', (e) => {
			const touch = e.touches[0]
			const x = (touch.clientX / innerWidth) * 2 - 1
			const y = -(touch.clientY / innerHeight) * 2 + 1

			this.cursor.set(x / 1.5, y)
		})
	}
}
