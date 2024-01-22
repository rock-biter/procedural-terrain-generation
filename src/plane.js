import {
	BoxGeometry,
	MathUtils,
	Mesh,
	MeshNormalMaterial,
	Object3D,
	Vector2,
	Vector3,
} from 'three'
const V3 = new Vector3(0, 0, 0)

export default class Plane extends Object3D {
	velocity = new Vector3(0, 0, 20)
	speed = 40
	acceleration = new Vector3(1, 0, 0)
	cursor = new Vector2(0, 0)

	constructor(noise, params) {
		// const geometry = new BoxGeometry(1, 1, 1)
		// const material = new MeshNormalMaterial()

		// super(geometry, material)
		super()

		this.noise = noise
		this.params = params

		this.initCursor()
	}

	update(dt) {
		const nextPos = this.position.clone()
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
				Math.PI * this.cursor.x * 0.2,
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

			this.cursor.set(x / 2, y)
		})
	}
}
