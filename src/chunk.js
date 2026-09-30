import {
	BoxGeometry,
	BufferAttribute,
	MathUtils,
	Mesh,
	MeshBasicMaterial,
	MeshNormalMaterial,
	MeshStandardMaterial,
	MultiplyBlending,
	Scene,
	Vector2,
	Vector3,
} from 'three'
import projectVertex from './shaders/project-vertex.glsl'
import projectVertexBoat from './shaders/project-vertex-boat.glsl'
import common from './shaders/common.glsl'
import colorFragment from './shaders/color-fragment.glsl'
import normalFragmentMap from './shaders/normal-fragment-map.glsl'
import terrainNormalPars from './shaders/terrain-normal-pars.glsl'
import { getTerrainNormalTexture, TERRAIN_NORMAL_LAYERS } from './terrainNormals'
import { curvedLightsFragment } from './curvedLights'
import { createImpostorMesh } from './impostors/impostorMaterial'
import Clouds from './clouds'
import { getHeight } from './chunkGeometry'

const isMobile = window.innerWidth < 768
// The terrain samples its per-layer maps from uTerrainNormalMaps
// (terrain-normal-pars.glsl). normalMap only enables Three's tangent-space
// path, whose tangent frame comes from the chunk uv.
const normalMap = getTerrainNormalTexture(TERRAIN_NORMAL_LAYERS.sea.texture)
const material = new MeshStandardMaterial({
	// wireframe: true,
	color: 'lightblue',
	normalMap,
	// transparent: true,
	// opacity: 0.8,
	// flatShading: true,
})

// Shared with GLSL through the `uCurvature` uniform created in main.js.
export const CURVATURE = 3000

const V2 = new Vector2(0, 0)
const DEFAULT_FEATURES = Object.freeze({
	scenery: true,
	clouds: true,
	boats: true,
})

export default class Chunk extends Mesh {
	scenery = null
	hasScenery = false
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
		this.clearScenery()
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
				varying vec3 vSphereNormal;
				`,
			)
			shader.vertexShader = shader.vertexShader.replace(
				'#include <project_vertex>',
				projectVertex,
			)
			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <common>',
				common +
					'\n' +
					terrainNormalPars +
					`
				varying vec3 vSphereNormal;
				`,
			)
			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <color_fragment>',
				colorFragment,
			)
			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <lights_fragment_begin>',
				curvedLightsFragment,
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

	// Instances come from the chunk worker (src/sceneryPlacement.js). The mesh
	// geometry is owned by this chunk; the impostor material is shared.
	setScenery(instances) {
		this.clearScenery()
		this.hasScenery = true
		if (instances.length === 0) return

		this.scenery = createImpostorMesh(
			instances,
			this.assets.impostorMaterial,
			this.size * 0.75 + 40,
		)
		this.add(this.scenery)
	}

	clearScenery() {
		this.hasScenery = false
		if (!this.scenery) return

		this.remove(this.scenery)
		this.scenery.geometry.dispose()
		this.scenery = null
	}

	updateScenery() {
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
