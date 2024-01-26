import {
	Color,
	IcosahedronGeometry,
	InstancedMesh,
	MathUtils,
	Matrix4,
	MeshNormalMaterial,
	MeshStandardMaterial,
	Quaternion,
	SphereGeometry,
	Vector3,
} from 'three'
import projectVertex from './shaders/project-instanced-vertex.glsl'
import colorFragment from './shaders/color-instanced-fragment.glsl'
import common from './shaders/common.glsl'

const material = new MeshStandardMaterial({ color: '' })

export default class Trees extends InstancedMesh {
	constructor(position, uniforms, assets) {
		const count = position.count
		const geometry = new IcosahedronGeometry(1, 5)

		super(geometry, material, count)
		this.bufferPosition = position
		this.assets = assets
		material.normalMap = assets.normalMap

		this.init()
		this.uniforms = uniforms

		this.onBeforeCompile()
	}

	onBeforeCompile() {
		this.material.onBeforeCompile = (shader) => {
			shader.uniforms = {
				...shader.uniforms,
				...this.uniforms,
			}

			shader.vertexShader = shader.vertexShader.replace(
				'#include <common>',
				common +
					`
				attribute float height;
				`
			)
			shader.vertexShader = shader.vertexShader.replace(
				'#include <project_vertex>',
				projectVertex
			)

			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <common>',
				common
			)
			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <color_fragment>',
				colorFragment
			)
		}
	}

	init() {
		const matrix = new Matrix4()
		const position = new Vector3(0, 0, 0)
		const quaternion = new Quaternion()
		const scale = new Vector3(1, 1, 1)

		for (let i = 0; i < this.bufferPosition.count; i++) {
			const x = this.bufferPosition.getX(i) + MathUtils.randFloat(-1, 1)
			const y = this.bufferPosition.getY(i)
			const z = this.bufferPosition.getZ(i) + MathUtils.randFloat(-1, 1)

			position.set(x, y + 0.5, z)
			scale.setScalar(Math.random() * 1.8 + 0.3)
			scale.y += Math.random() * 2

			matrix.compose(position, quaternion, scale)

			this.setMatrixAt(i, matrix)
			this.setColorAt(
				i,
				new Color(0x557733).multiplyScalar(Math.random() * 0.8 + 0.4)
			)
		}
	}
}
