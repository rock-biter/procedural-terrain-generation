import { MathUtils, Mesh, MeshStandardMaterial, Sphere, Vector3 } from 'three'
import projectVertex from './shaders/project-vertex.glsl'
import projectVertexBoat from './shaders/project-vertex-boat.glsl'
import common from './shaders/common.glsl'
import colorFragment from './shaders/color-fragment.glsl'
import normalFragmentMap from './shaders/normal-fragment-map.glsl'
import terrainNormalPars from './shaders/terrain-normal-pars.glsl'
import terrainBandsPars from './shaders/terrain-bands-pars.glsl'
import terrainColorNoisePars from './shaders/terrain-color-noise-pars.glsl'
import seaRipplePars from './shaders/sea-ripple-pars-fragment.glsl'
import { FLAT_TERRAIN_NORMAL } from './terrainNormals'
import { TERRAIN_SHADER_DEFINES } from './terrainBands'
import { createSceneryLighting } from './curvedLights'
import { getCurvedBoxSphere } from './chunkPolicy'
import { replaceChunks } from './shaderChunks'
import { createImpostorMesh } from './impostors/impostorMaterial'
import { getHeight } from './chunkGeometry'
import { disposeChunkGeometry } from './chunkTopology'

// The terrain samples its per-layer maps from uTerrainNormalMaps
// (terrain-normal-pars.glsl). normalMap only enables Three's tangent-space
// path, whose tangent frame comes from the chunk uv, so any texture works.
const normalMap = FLAT_TERRAIN_NORMAL
const material = new MeshStandardMaterial({
	color: 'lightblue',
	normalMap,
})

// Largest sea wave displacement in project-vertex.glsl.
const WAVE_AMPLITUDE = 0.5
// Reach of the scenery beyond the terrain's box: instance sizes and their
// eye-facing quads (createImpostorMesh() pads its flat sphere by as much).
const SCENERY_MARGIN = 40

const DEFAULT_FEATURES = Object.freeze({
	scenery: true,
	boats: false,
})

export default class Chunk extends Mesh {
	scenery = null
	hasScenery = false

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
		// Frustum culling reads this mesh-level sphere instead of the
		// geometry's: updateCurvedBounds() moves it onto the curved world, while
		// the geometry keeps its flat sphere.
		this.boundingSphere = new Sphere()
		this.resetBounds()

		this.position.copy(position)
		this.noise = noise
		this.size = size
		this.LOD = LOD
		this.params = params
		this.uniforms = uniforms
		this.boat = assets.boatModel
		this.assets = assets
		this.features = features

		this.updateScenery()
		this.onBeforeCompile()
	}

	dispose() {
		this.parent.remove(this)
		disposeChunkGeometry(this.geometry)
		this.clearScenery()
		if (this.boats) {
			this.boats.forEach((el) => this.remove(el))
		}
	}

	onBeforeCompile() {
		// Every chunk shares the material and the same tap counts. Terrain casts
		// no shadows, so it needs no self-shadow bias.
		const lighting = createSceneryLighting({
			shadows: {
				taps: this.params.shadows.taps.terrain,
				position: 'vShadowPosition',
				selfBias: '0.0',
			},
		})
		// The band and biome constants shared with the CPU (src/terrainBands.js).
		this.material.defines = { ...lighting.defines, ...TERRAIN_SHADER_DEFINES }
		this.material.onBeforeCompile = (shader) => {
			if (this.uniforms) {
				shader.uniforms = {
					...shader.uniforms,
					...this.uniforms,
				}
			}

			shader.vertexShader = replaceChunks(shader.vertexShader, {
				common:
					common +
					`
				attribute float height;
				varying vec3 vSphereNormal;
				varying vec3 vShadowPosition;
				`,
				project_vertex: projectVertex,
			})
			shader.fragmentShader = replaceChunks(shader.fragmentShader, {
				common:
					common +
					'\n' +
					terrainBandsPars +
					'\n' +
					terrainNormalPars +
					'\n' +
					terrainColorNoisePars +
					'\n' +
					seaRipplePars +
					'\n' +
					lighting.parsFragment +
					`
				varying vec3 vSphereNormal;
				`,
				color_fragment: colorFragment,
				lights_fragment_begin: lighting.lightsFragment,
				normal_fragment_maps: normalFragmentMap,
			})
		}
	}

	resetBounds() {
		if (!this.geometry.boundingSphere) this.geometry.computeBoundingSphere()
		this.boundingSphere.copy(this.geometry.boundingSphere)
	}

	// The terrain and its scenery are drawn lower the farther they are from the
	// eye (the airplane), so their culling spheres follow every frame; with flat
	// ones a camera pitched down culls distant chunks it can see. The worker's
	// flat sphere encloses the box of the footprint and height range, which
	// gives the box's half height.
	updateCurvedBounds(eye, curvature) {
		const flat = this.geometry.boundingSphere
		const horizontal = this.size * Math.SQRT1_2
		const halfHeight = Math.sqrt(Math.max(flat.radius ** 2 - horizontal ** 2, 0))
		const distance = Math.hypot(
			this.position.x + flat.center.x - eye.x,
			this.position.y + flat.center.y - eye.y,
			this.position.z + flat.center.z - eye.z,
		)
		const terrain = getCurvedBoxSphere(distance, horizontal, halfHeight + WAVE_AMPLITUDE, curvature)
		this.boundingSphere.center.set(flat.center.x, flat.center.y - terrain.drop, flat.center.z)
		this.boundingSphere.radius = terrain.radius
		if (!this.scenery) return
		const scenery = getCurvedBoxSphere(
			distance,
			horizontal + SCENERY_MARGIN,
			halfHeight + SCENERY_MARGIN,
			curvature,
		)
		this.scenery.boundingSphere.center.set(
			flat.center.x,
			flat.center.y - scenery.drop,
			flat.center.z,
		)
		this.scenery.boundingSphere.radius = scenery.radius
	}

	replaceGeometry(geometry, LOD) {
		if (!geometry) return

		disposeChunkGeometry(this.geometry)
		this.geometry = geometry
		this.resetBounds()
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
			this.assets.impostorWireframeMaterial,
		)
		// Mesh-level culling sphere for updateCurvedBounds(); the shadow casters
		// reuse the geometry with its flat sphere, since they render the flat
		// world. The hidden wireframe twin culls with the same sphere.
		this.scenery.boundingSphere = this.scenery.geometry.boundingSphere.clone()
		for (const child of this.scenery.children) child.boundingSphere = this.scenery.boundingSphere
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
		if (this.features.boats && !this.boats) this.addBoats()
	}

	addBoats() {
		const boats = []
		const n = MathUtils.randInt(0, 3)

		for (let i = 0; i < n; i++) {
			let x, z, h

			let attempt = 0

			do {
				x = MathUtils.randFloat(-this.size / 2, this.size / 2) + this.position.x
				z = MathUtils.randFloat(-this.size / 2, this.size / 2) + this.position.z
				h = getHeight(x, z, this.noise, this.params, this.uniforms.uBiomeOffset.value.toArray())
				attempt++
			} while ((h > -2 || h < -10) && attempt < 20)

			if (attempt === 20) {
				continue
			}

			const boat = this.createBoat(x, z)

			boats.push(boat)
		}
		this.boats = boats
	}

	createBoat(x, z) {
		const m = this.boat.clone()
		m.rotation.y = Math.random() * Math.PI * 2
		m.position.set(x, 0.8, z)

		m.traverse((el) => {
			if (el instanceof Mesh) {
				el.material.onBeforeCompile = (shader) => {
					shader.uniforms = {
						...shader.uniforms,
						...this.uniforms,
					}

					shader.vertexShader = replaceChunks(shader.vertexShader, {
						common:
							common +
							`
				attribute float height;
				`,
						project_vertex: projectVertexBoat,
					})
				}
			}
		})

		this.add(m)

		return m
	}
}
