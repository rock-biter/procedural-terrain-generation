import {
	BoxGeometry,
	BufferAttribute,
	MathUtils,
	Mesh,
	MeshBasicMaterial,
	MeshNormalMaterial,
	MeshStandardMaterial,
	MultiplyBlending,
	RepeatWrapping,
	Scene,
	TextureLoader,
	Vector2,
	Vector3,
} from 'three'
import fabricSrc from './textures/normal.jpg'
import projectVertex from './shaders/project-vertex.glsl'
import projectVertexBoat from './shaders/project-vertex-boat.glsl'
import common from './shaders/common.glsl'
import colorFragment from './shaders/color-fragment.glsl'
import normalFragmentMap from './shaders/normal-fragment-map.glsl'
import Trees from './trees'
import Clouds from './clouds'
import { getHeight } from './chunkGeometry'

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
	// transparent: true,
	// opacity: 0.8,
	// flatShading: true,
})

// Shared with GLSL through the `uCurvature` uniform created in main.js.
export const CURVATURE = 3000
const V2 = new Vector2(0, 0)
const DEFAULT_FEATURES = Object.freeze({
	trees: true,
	clouds: true,
	boats: true,
})

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
		uniforms,
		assets,
		features = DEFAULT_FEATURES,
		geometry,
	) {
		super(geometry, material)
		if (!geometry) throw new Error('Chunk geometry is required')

		this.position.copy(position)
		this.noise = noise
		this.size = size
		this.LOD = LOD
		this.params = params
		this.uniforms = uniforms
		this.boat = assets.boatModel
		this.assets = assets
		this.features = features

		// sea.scale.setScalar(size)

		this.updateScenery()
		this.onBeforeCompile()
		// this.add(sea.clone())

		// console.log('chunk created LOD:', LOD)
	}

	dispose() {
		// console.log(this)
		this.parent.remove(this)
		this.geometry.dispose()
		this.trees && this.trees.dispose()
		if (this.boats) {
			this.boats.forEach((el) => this.remove(el))
		}
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
				`,
			)
			shader.vertexShader = shader.vertexShader.replace(
				'#include <project_vertex>',
				projectVertex,
			)
			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <common>',
				common,
			)
			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <color_fragment>',
				colorFragment,
			)
			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <normal_fragment_maps>',
				normalFragmentMap,
			)
		}
	}

	replaceGeometry(geometry, LOD) {
		if (!geometry) return

		this.geometry.dispose()
		this.geometry = geometry
		this.LOD = LOD
		this.updateScenery()
	}

	updateScenery() {
		this.treesPositionArray = []
		if (this.features.trees && !this.trees && this.LOD <= 2) {
			this.generateTrees()
		}
		if (this.features.clouds && !this.clouds) this.generateClouds()
		if (this.features.boats && !this.boats) this.addBoats()
	}

	addBoats() {
		// if (!BOAT) return
		const boats = []
		const n = MathUtils.randInt(0, 3)

		for (let i = 0; i < n; i++) {
			let x = 0
			let z = 0
			let h = 0

			let attempt = 0

			do {
				x = MathUtils.randFloat(-this.size / 2, this.size / 2) + this.position.x
				z = MathUtils.randFloat(-this.size / 2, this.size / 2) + this.position.z
				h = getHeight(x, z, this.noise, this.params)
				attempt++
			} while ((h > -2 || h < -10) && attempt < 20)

			// console.log(attempt)
			if (attempt === 20) {
				continue
			}

			const boat = this.createBoat(x, z)

			boats.push(boat)
		}
		// console.log(boats)
		this.boats = boats
	}

	createBoat(x, z) {
		// const model = this.scene.children[0].children[0]
		// model.scale.setScalar(1.3)
		// // model.scale.setScalar(0.1)
		// model.rotation.x = 0

		const m = this.boat.clone()
		m.rotation.y = Math.random() * Math.PI * 2
		m.position.set(x, 0.8, z)

		// console.log(m)

		m.traverse((el) => {
			if (el instanceof Mesh) {
				el.material.onBeforeCompile = (shader) => {
					shader.uniforms = {
						...shader.uniforms,
						...this.uniforms,
					}

					shader.vertexShader = shader.vertexShader.replace(
						'#include <common>',
						common +
							`
				attribute float height;
				`,
					)
					shader.vertexShader = shader.vertexShader.replace(
						'#include <project_vertex>',
						projectVertexBoat,
					)
				}
			}
		})

		this.add(m)

		return m
	}

	createTreesMesh() {
		// console.log(this.treesPositionArray, this.treesCount)

		const position = new BufferAttribute(
			new Float32Array(this.treesPositionArray),
			3,
		)

		// console.log(this.trees)
		if (this.trees) {
			this.remove(this.trees)
			this.trees.dispose()
		}

		this.trees = new Trees(position, this.uniforms, this.assets)

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
				z - this.position.z,
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
			3,
		)

		if (this.clouds) {
			this.remove(this.clouds)
			this.clouds.dispose()
		}

		this.clouds = new Clouds(position, this.uniforms)
		// console.log(this.trees)

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
				z - this.position.z,
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
