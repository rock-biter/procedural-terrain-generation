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
import { createImpostorSource } from './impostorArchetypes'
import { IMPOSTOR_INSTANCE_STRIDE, IMPOSTOR_TYPE_COUNT } from './impostorTypes'
import {
	appendNearSceneryInstances,
	chunkIntersectsSelection,
	createSceneryBuckets,
	getSceneryMeshRange,
	getSceneryMeshSelectionRadius,
	resetSceneryBuckets,
} from '../sceneryMeshPolicy'

// Culling spheres grow by this factor and offset (units) to cover the
// rigid bend, which tilts an instance slightly away from its local up axis.
const CULL_RADIUS_SCALE = 1.05
const CULL_RADIUS_OFFSET = 0.5

// Real meshes for the scenery instances near the eye. Every frame it selects
// the instances within the hand-over band from the live scenery chunks,
// frustum-culls them, and draws them with one instanced mesh per type. The
// impostor and mesh shaders share the fade and the dither, so in the band each
// pixel shows exactly one of the two.
//
// Ownership: this object owns its source geometries, instance buffers, and
// material. `uniforms` (shared with the terrain and impostors) must include
// uCamera, uCurvature, uAtmosphere, and uSceneryMeshRange; this object writes
// uSceneryMeshRange. `variation` and `detail` are uniform objects owned by
// main.js and shared with the impostor material and bake settings.
export default class SceneryMeshes extends Group {
	constructor({ uniforms, variation, detail, settings }) {
		super()
		this.name = 'scenery-meshes'
		this.uniforms = uniforms
		this.settings = settings
		this.selectionRadius = 0
		this.buckets = createSceneryBuckets()
		this.types = []
		this.lastUpdateMs = 0

		this.eye = new Vector3()
		this.frustum = new Frustum()
		this.viewProjection = new Matrix4()
		this.cullSphere = new Sphere()
		// Created once so the per-instance callback allocates nothing.
		this.isVisible = (type, x, y, z, scale, stretch) =>
			this.isInstanceVisible(type, x, y, z, scale, stretch)

		this.material = this.createMaterial(variation, detail)

		for (let type = 0; type < IMPOSTOR_TYPE_COUNT; type++) {
			const source = createImpostorSource(type)
			const { center, radius } = source.boundingSphere
			const geometry = new InstancedBufferGeometry()
			geometry.setIndex(source.index)
			for (const name of ['position', 'normal', 'color']) {
				geometry.setAttribute(name, source.getAttribute(name))
			}
			const mesh = new Mesh(geometry, this.material)
			mesh.name = `scenery-mesh-${type}`
			// Instances are placed in the shader; selection already culls them.
			mesh.frustumCulled = false
			mesh.visible = false
			this.add(mesh)

			const info = {
				geometry,
				mesh,
				buffer: null,
				centerY: center.y,
				radius,
				triangles: (source.index?.count ?? source.attributes.position.count) / 3,
			}
			this.types.push(info)
			this.attachBuffer(info, this.buckets[type].array)
		}

		this.applySettings()
	}

	createMaterial(variation, detail) {
		const material = new MeshStandardMaterial({
			vertexColors: true,
			roughness: 0.9,
			metalness: 0,
		})
		material.defines = { IMPOSTOR_TYPE_COUNT }
		material.onBeforeCompile = (shader) => {
			shader.uniforms = {
				...shader.uniforms,
				...this.uniforms,
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

	// Points a type's instanced attributes at `array`. A new array means a new
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

	// Re-reads `settings` ({ enabled, start, end }) into the shared uniform.
	applySettings() {
		const [start, end] = getSceneryMeshRange(this.settings)
		this.uniforms.uSceneryMeshRange.value.set(start, end)
		this.selectionRadius = getSceneryMeshSelectionRadius(this.settings)
	}

	// Runs after the chunk manager committed this frame's scenery and before
	// rendering, with the camera that will render. `chunks` is the live chunk
	// Map; `chunkSize` its world size.
	update(chunks, chunkSize, camera) {
		const startTime = performance.now()
		resetSceneryBuckets(this.buckets)

		if (this.selectionRadius > 0) {
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
						this.selectionRadius,
					)
				) {
					continue
				}
				appendNearSceneryInstances(
					this.buckets,
					chunk.scenery.geometry.attributes.aInstanceA.data.array,
					x,
					y,
					z,
					eyeX,
					eyeY,
					eyeZ,
					this.selectionRadius,
					this.isVisible,
				)
			}
		}

		for (let type = 0; type < IMPOSTOR_TYPE_COUNT; type++) {
			const bucket = this.buckets[type]
			const info = this.types[type]
			if (info.buffer.array !== bucket.array) this.attachBuffer(info, bucket.array)
			info.geometry.instanceCount = bucket.count
			info.mesh.visible = bucket.count > 0
			if (bucket.count > 0) {
				info.buffer.clearUpdateRanges()
				info.buffer.addUpdateRange(0, bucket.count * IMPOSTOR_INSTANCE_STRIDE)
				info.buffer.needsUpdate = true
			}
		}
		this.lastUpdateMs = performance.now() - startTime
	}

	// Bounding sphere of the instance on the curved world, against the frustum.
	isInstanceVisible(type, x, y, z, scale, stretch) {
		const info = this.types[type]
		const { uCamera, uCurvature } = this.uniforms
		const curvature = uCurvature.value
		const planeDistance = Math.hypot(
			x - uCamera.value.x,
			y - uCamera.value.y,
			z - uCamera.value.z,
		)
		const drop = curvature * (1 - Math.cos(planeDistance / curvature))
		this.cullSphere.center.set(x, y - drop + info.centerY * scale * stretch, z)
		this.cullSphere.radius =
			info.radius * scale * Math.max(stretch, 1) * CULL_RADIUS_SCALE +
			CULL_RADIUS_OFFSET
		return this.frustum.intersectsSphere(this.cullSphere)
	}

	getStats() {
		let instances = 0
		let triangles = 0
		const perType = []
		for (let type = 0; type < IMPOSTOR_TYPE_COUNT; type++) {
			const { count, array, reallocations } = this.buckets[type]
			const info = this.types[type]
			instances += count
			triangles += count * info.triangles
			perType.push({
				instances: count,
				capacity: array.length / IMPOSTOR_INSTANCE_STRIDE,
				reallocations,
				sourceTriangles: info.triangles,
			})
		}
		return {
			enabled: this.settings.enabled,
			range: this.uniforms.uSceneryMeshRange.value.toArray(),
			selectionRadius: this.selectionRadius,
			instances,
			triangles,
			drawCalls: perType.filter((type) => type.instances > 0).length,
			updateMs: this.lastUpdateMs,
			perType,
		}
	}

	dispose() {
		this.removeFromParent()
		for (const info of this.types) info.geometry.dispose()
		this.material.dispose()
	}
}
