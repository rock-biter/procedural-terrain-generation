import {
	InstancedMesh,
	MathUtils,
	Matrix4,
	MeshNormalMaterial,
	MeshStandardMaterial,
	Quaternion,
	SphereGeometry,
	Vector3,
} from 'three'

const material = new MeshNormalMaterial({ color: 'salmon' })

export default class Trees extends InstancedMesh {
	constructor(position) {
		const count = position.count
		console.log(position)
		const geometry = new SphereGeometry(1, 10, 10)

		super(geometry, material, count)
		this.bufferPosition = position

		this.init()
	}

	init() {
		const matrix = new Matrix4()
		const position = new Vector3(0, 0, 0)
		const quaternion = new Quaternion()
		const scale = new Vector3(1, 1, 1)

		for (let i = 0; i < this.bufferPosition.count; i++) {
			const x = this.bufferPosition.getX(i)
			const y = this.bufferPosition.getY(i)
			const z = this.bufferPosition.getZ(i)

			position.set(x, y, z)

			matrix.compose(position, quaternion, scale)

			this.setMatrixAt(i, matrix)
		}
	}
}
