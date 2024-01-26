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
import projectVertexClouds from './shaders/project-vertex-clouds.glsl'
import colorFragmentClouds from './shaders/color-instanced-fragment-clouds.glsl'
import normalFragmentMap from './shaders/normal-fragment-map.glsl'
import common from './shaders/common.glsl'

const material = new MeshStandardMaterial({ transparent: true, opacity: 0.95 })

export default class Clouds extends InstancedMesh {
	constructor(position, uniforms) {
		const count = position.count
		const geometry = new IcosahedronGeometry(2, 10)

		super(geometry, material, count)
		this.bufferPosition = position

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
				projectVertexClouds
			)

			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <common>',
				common
			)
			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <color_fragment>',
				colorFragmentClouds
			)

			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <normal_fragment_maps>',
				normalFragmentMap
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
			const y = this.bufferPosition.getY(i) + MathUtils.randFloat(-5, 5)
			const z = this.bufferPosition.getZ(i) + MathUtils.randFloat(-1, 1)

			position.set(x, y + 0.5, z)
			scale.setScalar(Math.random() * 4 + 0.6)

			matrix.compose(position, quaternion, scale)

			this.setMatrixAt(i, matrix)
			this.setColorAt(i, new Color(0x555555))
		}
	}
}
