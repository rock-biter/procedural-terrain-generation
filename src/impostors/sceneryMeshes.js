import {
	DynamicDrawUsage,
	Frustum,
	Group,
	InstancedBufferGeometry,
	InstancedInterleavedBuffer,
	InterleavedBufferAttribute,
	Matrix4,
	Mesh,
	MeshStandardMaterial,
	Sphere,
	Vector2,
	Vector3,
} from 'three'
import common from '../shaders/common.glsl'
import sceneryInstanceParsVertex from '../shaders/scenery-instance-pars-vertex.glsl'
import sceneryMeshParsVertex from '../shaders/scenery-mesh-pars-vertex.glsl'
import sceneryMeshNormalVertex from '../shaders/scenery-mesh-normal-vertex.glsl'
import sceneryMeshVertex from '../shaders/scenery-mesh-vertex.glsl'
import sceneryDitherParsFragment from '../shaders/scenery-dither-pars-fragment.glsl'
import sceneryDetailParsFragment from '../shaders/scenery-detail-pars-fragment.glsl'
import sceneryMeshParsFragment from '../shaders/scenery-mesh-pars-fragment.glsl'
import sceneryMeshColorFragment from '../shaders/scenery-mesh-color-fragment.glsl'
import { curvedLightsFragment } from '../curvedLights'
import { createScenerySources } from './impostorArchetypes'
import { IMPOSTOR_INSTANCE_STRIDE, IMPOSTOR_TYPE_COUNT } from './impostorTypes'
import {
	SCENERY_MESH_LOD_COUNT,
	appendNearSceneryInstances,
	chunkIntersectsSelection,
	createSceneryBuckets,
	getSceneryMeshLodRange,
	getSceneryMeshRange,
	getSceneryMeshSelection,
	resetSceneryBuckets,
} from '../sceneryMeshPolicy'

// Culling spheres grow by this factor and offset (units) to cover the
// rigid bend, which tilts an instance slightly away from its local up axis.
const CULL_RADIUS_SCALE = 1.05
const CULL_RADIUS_OFFSET = 0.5

// Real meshes for the scenery instances near the eye, in two levels of detail:
// LOD 0 (the baked source geometry) closest and LOD 1 (reduced geometry)
// farther out. Every frame it selects, per level, the instances within that
// level's distance window from the live scenery chunks, frustum-culls them,
// and draws them with one instanced mesh per type and level. The impostor and
// mesh shaders share the fades and the dither, so each pixel shows exactly
// one of LOD 0, LOD 1, or the impostor.
//
// Ownership: this object owns its source geometries, instance buffers,
// materials, and the LOD range uniform. `uniforms` (shared with the terrain and
// impostors) must include uCamera, uCurvature, uAtmosphere, and
// uSceneryMeshRange; this object writes uSceneryMeshRange. `variation` and
// `detail` are uniform objects owned by main.js and shared with the impostor
// material and bake settings.
export default class SceneryMeshes extends Group {
	constructor({ uniforms, variation, detail, settings }) {
		super()
		this.name = 'scenery-meshes'
		this.uniforms = uniforms
		this.settings = settings
		this.lodRange = { value: new Vector2() }
		this.outerRadius = 0
		this.lastUpdateMs = 0

		this.eye = new Vector3()
		this.frustum = new Frustum()
		this.viewProjection = new Matrix4()
		this.cullSphere = new Sphere()
		// Created once so the per-instance callback allocates nothing.
		this.isVisible = (type, x, y, z, scale, stretch) =>
			this.isInstanceVisible(type, x, y, z, scale, stretch)

		// Culling bounds come from LOD 0, the geometry the impostor was baked
		// from; LOD 1 shares its local frame.
		this.bounds = []
		// levels[lod]: { minRadius, maxRadius, buckets, material, types[type] }.
		this.levels = Array.from({ length: SCENERY_MESH_LOD_COUNT }, (_, lod) => ({
			minRadius: 0,
			maxRadius: 0,
			buckets: createSceneryBuckets(),
			material: this.createMaterial(lod, variation, detail),
			types: [],
		}))

		for (let type = 0; type < IMPOSTOR_TYPE_COUNT; type++) {
			const sources = createScenerySources(type, SCENERY_MESH_LOD_COUNT)
			const { center, radius } = sources[0].boundingSphere
			this.bounds.push({ centerY: center.y, radius })

			sources.forEach((source, lod) => {
				const level = this.levels[lod]
				const geometry = new InstancedBufferGeometry()
				geometry.setIndex(source.index)
				for (const name of ['position', 'normal', 'color']) {
					geometry.setAttribute(name, source.getAttribute(name))
				}
				const mesh = new Mesh(geometry, level.material)
				mesh.name = `scenery-mesh-${type}-lod${lod}`
				// Instances are placed in the shader; selection already culls them.
				mesh.frustumCulled = false
				mesh.visible = false
				this.add(mesh)

				const info = {
					geometry,
					mesh,
					buffer: null,
					triangles: source.index.count / 3,
				}
				level.types.push(info)
				this.attachBuffer(info, level.buckets[type].array)
			})
		}

		this.applySettings()
	}

	createMaterial(lod, variation, detail) {
		const material = new MeshStandardMaterial({
			vertexColors: true,
			roughness: 0.9,
			metalness: 0,
		})
		material.defines = { IMPOSTOR_TYPE_COUNT, SCENERY_MESH_LOD: lod }
		material.onBeforeCompile = (shader) => {
			shader.uniforms = {
				...shader.uniforms,
				...this.uniforms,
				uSceneryMeshLodRange: this.lodRange,
				uImpostorVariationAmount: variation.amount,
				uImpostorVariationFrequency: variation.frequency,
				...detail,
			}

			shader.vertexShader = shader.vertexShader
				.replace(
					'#include <common>',
					`${common}\n${sceneryInstanceParsVertex}\n${sceneryMeshParsVertex}`,
				)
				.replace('#include <beginnormal_vertex>', sceneryMeshNormalVertex)
				.replace('#include <project_vertex>', sceneryMeshVertex)
			shader.fragmentShader = shader.fragmentShader
				.replace(
					'#include <common>',
					`${common}\n${sceneryDitherParsFragment}\n${sceneryDetailParsFragment}\n${sceneryMeshParsFragment}`,
				)
				.replace('#include <color_fragment>', sceneryMeshColorFragment)
				.replace('#include <lights_fragment_begin>', curvedLightsFragment)
		}
		return material
	}

	// Points a mesh's instanced attributes at `array`. A new array means a new
	// GPU buffer, so the geometry releases the old one first.
	attachBuffer(info, array) {
		if (info.buffer) info.geometry.dispose()
		const buffer = new InstancedInterleavedBuffer(array, IMPOSTOR_INSTANCE_STRIDE)
		buffer.setUsage(DynamicDrawUsage)
		info.geometry.setAttribute(
			'aInstanceA',
			new InterleavedBufferAttribute(buffer, 4, 0),
		)
		info.geometry.setAttribute(
			'aInstanceB',
			new InterleavedBufferAttribute(buffer, 4, 4),
		)
		info.buffer = buffer
	}

	// Re-reads `settings` ({ enabled, start, end, lodStart, lodEnd }) into the
	// shader ranges and the per-level selection windows.
	applySettings() {
		const [start, end] = getSceneryMeshRange(this.settings)
		this.uniforms.uSceneryMeshRange.value.set(start, end)
		this.lodRange.value.fromArray(getSceneryMeshLodRange(this.settings))
		this.outerRadius = 0
		getSceneryMeshSelection(this.settings).forEach(({ minRadius, maxRadius }, lod) => {
			this.levels[lod].minRadius = minRadius
			this.levels[lod].maxRadius = maxRadius
			this.outerRadius = Math.max(this.outerRadius, maxRadius)
		})
	}

	// Runs after the chunk manager committed this frame's scenery and before
	// rendering, with the camera that will render. `chunks` is the live chunk
	// Map; `chunkSize` its world size.
	update(chunks, chunkSize, camera) {
		const startTime = performance.now()
		for (const level of this.levels) resetSceneryBuckets(level.buckets)

		if (this.outerRadius > 0) {
			camera.updateWorldMatrix(true, false)
			this.eye.setFromMatrixPosition(camera.matrixWorld)
			this.viewProjection.multiplyMatrices(
				camera.projectionMatrix,
				camera.matrixWorldInverse,
			)
			this.frustum.setFromProjectionMatrix(this.viewProjection)

			const { x: eyeX, y: eyeY, z: eyeZ } = this.eye
			const halfSize = chunkSize / 2
			for (const chunk of chunks.values()) {
				if (!chunk.scenery) continue
				const { x, y, z } = chunk.position
				if (
					!chunkIntersectsSelection(
						x,
						z,
						halfSize,
						eyeX,
						eyeZ,
						this.outerRadius,
					)
				) {
					continue
				}
				appendNearSceneryInstances(
					this.levels,
					chunk.scenery.geometry.attributes.aInstanceA.data.array,
					x,
					y,
					z,
					eyeX,
					eyeY,
					eyeZ,
					this.isVisible,
				)
			}
		}

		for (const level of this.levels) {
			for (let type = 0; type < IMPOSTOR_TYPE_COUNT; type++) {
				const bucket = level.buckets[type]
				const info = level.types[type]
				if (info.buffer.array !== bucket.array) this.attachBuffer(info, bucket.array)
				info.geometry.instanceCount = bucket.count
				info.mesh.visible = bucket.count > 0
				if (bucket.count > 0) {
					info.buffer.clearUpdateRanges()
					info.buffer.addUpdateRange(0, bucket.count * IMPOSTOR_INSTANCE_STRIDE)
					info.buffer.needsUpdate = true
				}
			}
		}
		this.lastUpdateMs = performance.now() - startTime
	}

	// Bounding sphere of the instance on the curved world, against the frustum.
	isInstanceVisible(type, x, y, z, scale, stretch) {
		const bounds = this.bounds[type]
		const { uCamera, uCurvature } = this.uniforms
		const curvature = uCurvature.value
		const planeDistance = Math.hypot(
			x - uCamera.value.x,
			y - uCamera.value.y,
			z - uCamera.value.z,
		)
		const drop = curvature * (1 - Math.cos(planeDistance / curvature))
		this.cullSphere.center.set(x, y - drop + bounds.centerY * scale * stretch, z)
		this.cullSphere.radius =
			bounds.radius * scale * Math.max(stretch, 1) * CULL_RADIUS_SCALE +
			CULL_RADIUS_OFFSET
		return this.frustum.intersectsSphere(this.cullSphere)
	}

	getStats() {
		let instances = 0
		let triangles = 0
		let drawCalls = 0
		const levels = this.levels.map((level) => {
			let levelInstances = 0
			let levelTriangles = 0
			const perType = level.types.map((info, type) => {
				const { count, array, reallocations } = level.buckets[type]
				levelInstances += count
				levelTriangles += count * info.triangles
				if (count > 0) drawCalls++
				return {
					instances: count,
					capacity: array.length / IMPOSTOR_INSTANCE_STRIDE,
					reallocations,
					sourceTriangles: info.triangles,
				}
			})
			instances += levelInstances
			triangles += levelTriangles
			return {
				window: [level.minRadius, level.maxRadius],
				instances: levelInstances,
				triangles: levelTriangles,
				perType,
			}
		})
		return {
			enabled: this.settings.enabled,
			range: this.uniforms.uSceneryMeshRange.value.toArray(),
			lodRange: this.lodRange.value.toArray(),
			instances,
			triangles,
			drawCalls,
			updateMs: this.lastUpdateMs,
			levels,
		}
	}

	dispose() {
		this.removeFromParent()
		for (const level of this.levels) {
			for (const info of level.types) info.geometry.dispose()
			level.material.dispose()
		}
	}
}
