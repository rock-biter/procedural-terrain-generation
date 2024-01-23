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
import Trees from './trees'
import Clouds from './clouds'

const isMobile = window.innerWidth < 768
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
	treesPositionArray = []
	treesCount = 0
	cloudsPositionArray = []
	cloudsCount = 0

	constructor(
		size,
		noise,
		params = {},
		LOD = 0,
		position = new Vector3(0, 0, 0),
		uniforms
	) {
		const density = isMobile ? 4 : 2
		const segments = Math.max(Math.floor(size * 0.5 ** LOD), density) / density
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
		this.uniforms.uCurvature = { value: CURVATURE }

		sea.scale.setScalar(size)

		this.updateGeometry()
		this.onBeforeCompile()
		// this.add(sea.clone())

		// console.log('chunk created LOD:', LOD)
	}

	dispose() {
		// console.log(this)
		this.parent.remove(this)
		this.geometry.dispose()
		this.trees && this.trees.dispose()
	}

	onBeforeCompile() {
		this.material.onBeforeCompile = (shader) => {
			// const { fragmentShader, vertexShader } = shader
			// console.log(fragmentShader)

			if (this.uniforms) {
				shader.uniforms = {
					...shader.uniforms,
					...this.uniforms,
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
		// console.log('LOD updated', LOD, 'vs', this.LOD)
		if (LOD === this.LOD) return

		this.LOD = LOD
		const density = isMobile ? 4 : 2
		const segments =
			Math.max(Math.floor(this.size * 0.5 ** LOD), density) / density
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
		this.treesPositionArray = []
		const posAttr = this.geometry.getAttribute('position')
		const heightAttr = this.createHeightAttribute()

		for (let i = 0; i < posAttr.count; i++) {
			const x = posAttr.getX(i) + this.position.x
			const z = posAttr.getZ(i) + this.position.z

			let h = getHeight(x, z, this.noise, this.params)

			heightAttr.setX(i, h)
			posAttr.setY(i, Math.max(h, -1))
		}

		posAttr.needsUpdate = true

		// TODO calcolare a mano le normali con prodotto vettoriale
		this.geometry.computeVertexNormals()

		// this.createTreesMesh()
		if (!this.trees && this.LOD <= 2) this.generateTrees()
		if (!this.clouds) this.generateClouds()
	}

	createTreesMesh() {
		// console.log(this.treesPositionArray, this.treesCount)

		const position = new BufferAttribute(
			new Float32Array(this.treesPositionArray),
			3
		)

		this.trees = new Trees(position, this.uniforms)
		// console.log(this.trees)
		if (this.trees) {
			this.remove(this.trees)
			this.trees.dispose()
		}
		this.add(this.trees)
	}

	generateTrees() {
		const density = isMobile ? 8 : 5
		const half = this.size
		for (let i = 0; i < this.size; i += density) {
			for (let j = 0; j < this.size; j += density) {
				const x = i + this.position.x - half
				const z = j + this.position.z - half
				let h = getHeight(x, z, this.noise, this.params)

				this.addTree(x, h, z)
			}
		}

		this.createTreesMesh()
	}

	addTree(x, y, z) {
		const n =
			this.noise[0](x * 0.005, z * 0.005) + this.noise[1](x * 0.05, z * 0.05)

		if (n > -0.5 && y > 4 && y < 42 && Math.random() < n + 0.3) {
			this.treesPositionArray.push(
				x - this.position.x,
				y + 1,
				z - this.position.z
			)
			this.treesCount++
		}
	}

	generateClouds() {
		const density = isMobile ? 4 : 2

		const half = this.size
		for (let i = 0; i < this.size; i += 1) {
			for (let j = 0; j < this.size; j += 1) {
				const x = i + this.position.x - half
				const z = j + this.position.z - half

				this.addCloud(x, z)
			}
		}

		this.createCloudsMesh()
	}

	createCloudsMesh() {
		const position = new BufferAttribute(
			new Float32Array(this.cloudsPositionArray),
			3
		)

		this.clouds = new Clouds(position, this.uniforms)
		// console.log(this.trees)
		if (this.clouds) {
			this.remove(this.clouds)
			this.clouds.dispose()
		}
		this.add(this.clouds)
		this.clouds.material.normalMap = normalMap
	}

	addCloud(x, z) {
		let n = this.noise[0](x * 0.005, z * 0.005) + this.noise[1](x * 10, z * 10)

		n *= n

		if (n > 3.3 && Math.random() > 0.1) {
			this.cloudsPositionArray.push(
				x - this.position.x,
				100,
				z - this.position.z
			)
			this.cloudsCount++
		}
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
	const fx = params.frequency.x
	const fz = params.frequency.z

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
	let n = l
	l *= params.amplitude * 3.5
	let pct = noises[1](x * 0.0005, z * 0.0005) - 0.5
	pct
	l = MathUtils.lerp(
		l,
		(MathUtils.smoothstep(pct, 0.5, 1) - 0.5) * params.amplitude * 2,
		1 - MathUtils.smoothstep(n, -1, -0.3)
	)

	h += l

	return h
}
