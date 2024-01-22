import {
	BufferAttribute,
	MathUtils,
	Mesh,
	MeshStandardMaterial,
	MultiplyBlending,
	PlaneGeometry,
	RepeatWrapping,
	Scene,
	TextureLoader,
	Vector2,
	Vector3,
} from 'three'
import fabricSrc from './textures/normal.jpg'
import projectVertex from './shaders/project-vertex.glsl'
import common from './shaders/common.glsl'
import colorFragment from './shaders/color-fragment.glsl'
import normalFragmentMap from './shaders/normal-fragment-map.glsl'

const loader = new TextureLoader()
const normalMap = loader.load(fabricSrc)
normalMap.repeat.set(6, 6)
normalMap.wrapS = RepeatWrapping
normalMap.wrapT = RepeatWrapping
const material = new MeshStandardMaterial({
	// wireframe: true,
	color: 'lightblue',
	normalMap,
	normalScale: new Vector2(2, -2),
	// flatShading: true,
})

const sea = new Mesh(
	new PlaneGeometry(1, 1),
	new MeshStandardMaterial({
		color: 0x053399,
		transparent: true,
		opacity: 0.5,
		// blending: MultiplyBlending,
	})
)
sea.geometry.rotateX(-Math.PI * 0.5)
// sea.geometry.translate(0.5, 0, 0.5)

const CURVATURE = 3000
const V2 = new Vector2(0, 0)

export default class Chunk extends Mesh {
	constructor(
		size,
		noise,
		params = {},
		LOD = 0,
		position = new Vector3(0, 0, 0),
		uniforms
	) {
		const segments = Math.max(Math.floor(size * 0.5 ** LOD), 2) / 2
		const geometry = new PlaneGeometry(size, size, segments, segments)
		geometry.rotateX(-Math.PI * 0.5)
		// geometry.translate(size / 2, 0, size / 2)

		super(geometry, material)

		this.position.copy(position)
		this.noise = noise
		this.size = size
		this.LOD = LOD
		this.params = params
		this.uniforms = uniforms

		sea.scale.setScalar(size)

		this.updateGeometry()
		this.onBeforeCompile()
		// this.add(sea.clone())
	}

	dispose() {
		// console.log(this)
		this.parent.remove(this)
		this.geometry.dispose()
	}

	onBeforeCompile() {
		this.material.onBeforeCompile = (shader) => {
			const { fragmentShader, vertexShader } = shader
			console.log(fragmentShader)

			if (this.uniforms) {
				shader.uniforms = {
					...shader.uniforms,
					...this.uniforms,
					uCurvature: { value: CURVATURE },
				}
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

			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <normal_fragment_maps>',
				normalFragmentMap
			)
		}
	}

	updateLOD(LOD) {
		if (LOD === this.LOD) return

		this.LOD = LOD
		const segments = Math.max(Math.floor(this.size * 0.5 ** LOD), 2) / 2
		const geometry = new PlaneGeometry(this.size, this.size, segments, segments)
		geometry.rotateX(-Math.PI * 0.5)
		// geometry.translate(this.size / 2, 0, this.size / 2)
		// this.needsUpdate = true
		this.geometry.dispose()
		this.geometry = geometry
		this.updateGeometry()
		// this.geometry.needsUpdate = true
	}

	createHeightAttribute() {
		const posAttr = this.geometry.getAttribute('position')
		const heightAttr = this.geometry.getAttribute('height')

		if (!heightAttr) {
			this.geometry.setAttribute(
				'height',
				new BufferAttribute(new Float32Array(posAttr.count), 1)
			)
		}

		return this.geometry.getAttribute('height')
	}

	updateGeometry() {
		const posAttr = this.geometry.getAttribute('position')
		const heightAttr = this.createHeightAttribute()

		const { x: fx, z: fz } = this.params.frequency

		for (let i = 0; i < posAttr.count; i++) {
			const x = posAttr.getX(i) + this.position.x
			const z = posAttr.getZ(i) + this.position.z

			let h = getHeight(x, z, this.noise, this.params)

			// for (let j = 0; j < this.params.octaves; j++) {
			// 	const octave = j
			// 	const amplitude =
			// 		this.params.amplitude * this.params.persistance ** octave
			// 	const lacunarity = this.params.lacunarity ** octave

			// 	let increment = this.noise[j](
			// 		x * 0.01 * fx * lacunarity,
			// 		z * 0.01 * fz * lacunarity
			// 	)

			// 	increment *= increment
			// 	h += increment * amplitude
			// }

			// let l = this.noise[0](x * 0.001, z * 0.001)
			// // l *= l
			// l -= 0.5
			// l *= this.params.amplitude * 3
			// // const pct = MathUtils.smoothstep(l, 0, 1)
			// // h = MathUtils.lerp(l, h, pct)

			// h += l

			// if (isNaN(h)) {
			// 	console.log('h is NaN')
			// }

			// if (h <= 0) {
			// 	h /= 3 - h / 2
			// }

			heightAttr.setX(i, h)
			posAttr.setY(i, Math.max(h, -1))
		}

		posAttr.needsUpdate = true

		// TODO calcolare a mano le normali con prodotto vettoriale
		this.geometry.computeVertexNormals()
	}

	applyCurvature(x, y) {
		// da applciare con vertex shader
		const l = V2.set(x, y).length()

		const diff = -CURVATURE * (1 - Math.cos(l / CURVATURE))

		// return diff
		return 0
	}
}

export function getHeight(x, z, noises, params) {
	let h = 0
	const { x: fx, z: fz } = params.frequency

	for (let j = 0; j < params.octaves; j++) {
		const octave = j
		const amplitude = params.amplitude * params.persistance ** octave
		const lacunarity = params.lacunarity ** octave

		let increment = noises[j](
			x * 0.01 * fx * lacunarity,
			z * 0.01 * fz * lacunarity
		)

		increment *= increment
		h += increment * amplitude
	}

	let l = noises[0](x * 0.001, z * 0.001)
	// l *= l
	l -= 0.5
	l *= params.amplitude * 3
	// const pct = MathUtils.smoothstep(l, 0, 1)
	// h = MathUtils.lerp(l, h, pct)

	h += l

	return h
}
