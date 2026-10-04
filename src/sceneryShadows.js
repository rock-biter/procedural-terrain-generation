import {
	DepthFormat,
	DepthTexture,
	DoubleSide,
	LessEqualCompare,
	LinearFilter,
	Matrix4,
	Mesh,
	OrthographicCamera,
	RedFormat,
	Scene,
	ShaderMaterial,
	UnsignedShortType,
	Vector2,
	Vector3,
	Vector4,
	WebGLRenderTarget,
} from 'three'
import casterVertexShader from './shaders/scenery-shadow-caster-vertex.glsl'
import casterFragmentShader from './shaders/scenery-shadow-caster-fragment.glsl'
import {
	IMPOSTOR_ATLAS_COLUMNS,
	IMPOSTOR_ATLAS_ROWS,
	IMPOSTOR_TYPE_COUNT,
} from './impostors/impostorTypes'
import { getViewDefines } from './impostors/octahedral'
import { chunkIntersectsSelection } from './sceneryMeshPolicy'
import {
	SCENERY_SHADOW_CASCADE_COUNT,
	getCascadeDepthRange,
	getCascadeSphere,
	getShadowStrength,
	hasLightDirectionChanged,
	selectShadowLight,
	shouldRenderCascade,
	snapToTexel,
} from './shadowPolicy'

// Maps clip space [-1, 1] to shadow-map UV and depth [0, 1].
const CLIP_TO_TEXTURE = new Matrix4().set(
	0.5, 0, 0, 0.5,
	0, 0.5, 0, 0.5,
	0, 0, 0.5, 0.5,
	0, 0, 0, 1,
)
const WORLD_UP = new Vector3(0, 1, 0)
const WORLD_FORWARD = new Vector3(0, 0, 1)

// Receiver uniforms, shared with the terrain, impostor, and near-mesh
// materials through main.js's uniform object (scenery-shadow-pars-fragment.glsl).
export function createSceneryShadowUniforms(settings) {
	return {
		uSceneryShadowMaps: { value: new Array(SCENERY_SHADOW_CASCADE_COUNT).fill(null) },
		uSceneryShadowMatrices: {
			value: Array.from({ length: SCENERY_SHADOW_CASCADE_COUNT }, () => new Matrix4()),
		},
		uSceneryShadowCascades: {
			value: Array.from({ length: SCENERY_SHADOW_CASCADE_COUNT }, () => new Vector4()),
		},
		uSceneryShadowDepthScale: { value: new Array(SCENERY_SHADOW_CASCADE_COUNT).fill(0) },
		uSceneryShadowStrength: { value: 0 },
		uSceneryShadowLight: { value: new Vector3(0, 1, 0) },
		uSceneryShadowFade: { value: new Vector2(settings.fade.start, settings.fade.end) },
		uSceneryShadowSoftness: {
			value: new Vector2(settings.softness.near, settings.softness.far),
		},
		uSceneryShadowBias: { value: settings.bias },
	}
}

// Soft scenery shadows in two light-aligned cascades (rules in
// src/shadowPolicy.js). Every update it picks the shadowing light (sun or
// moon), syncs one caster proxy per live scenery chunk plus the airplane into
// its own scene, and renders the scheduled cascades' depth maps. Casters and
// receivers use flat world space; the curvature is visual only.
//
// Ownership: this object owns the cascade render targets, cameras, caster
// materials, and proxies. Proxies borrow the chunks' scenery geometries and
// the airplane geometry, and never dispose them. `uniforms` is main.js's
// shared uniform object, which must hold createSceneryShadowUniforms(); this
// object writes them. `impostorMaterial` (optional) provides the atlas
// uniforms and frame count, so a re-bake reaches the casters.
export default class SceneryShadows {
	constructor({ renderer, uniforms, settings, impostorMaterial = null }) {
		this.renderer = renderer
		this.uniforms = uniforms
		this.settings = settings
		this.frame = 0
		this.forceRender = true
		this.lastRenderMs = 0
		this.lastDrawCalls = 0
		this.light = null
		this.lightDirection = null
		this.lightVector = new Vector3()
		this.lightUp = new Vector3()
		this.basisCamera = new OrthographicCamera()
		this.right = new Vector3()
		this.up = new Vector3()
		this.forward = new Vector3()
		this.center = new Vector3()
		this.heading = new Vector3()
		this.sphere = {}

		this.scene = new Scene()
		this.scene.name = 'scenery-shadow-casters'
		this.proxies = []
		this.proxyCount = 0
		this.impostorCaster = impostorMaterial
			? this.createImpostorCaster(impostorMaterial)
			: null
		this.airplaneCaster = new ShaderMaterial({
			vertexShader:
				'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
			fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
			side: DoubleSide,
			colorWrite: false,
		})
		this.airplane = null

		// 16-bit depth: the far cascade spans about 1100 units of depth (2100 at
		// the GUI's largest radius), so a step of 0.017 to 0.032 units stays below
		// the default depth bias. Casters never write color, but a render target
		// needs a color attachment; one 8-bit channel keeps it small.
		this.cascades = settings.cascades.map((cascade, index) => {
			const depthTexture = new DepthTexture(cascade.mapSize, cascade.mapSize, UnsignedShortType)
			depthTexture.format = DepthFormat
			depthTexture.compareFunction = LessEqualCompare
			depthTexture.minFilter = LinearFilter
			depthTexture.magFilter = LinearFilter
			const target = new WebGLRenderTarget(cascade.mapSize, cascade.mapSize, {
				depthTexture,
				format: RedFormat,
				generateMipmaps: false,
			})
			target.texture.name = `scenery-shadow-${index}`
			uniforms.uSceneryShadowMaps.value[index] = depthTexture
			return {
				target,
				camera: new OrthographicCamera(),
				lastFrame: -1,
				drawCalls: 0,
			}
		})

		this.applySettings()
	}

	createImpostorCaster(impostorMaterial) {
		const { impostorUniforms } = impostorMaterial.userData
		const material = new ShaderMaterial({
			vertexShader: casterVertexShader,
			fragmentShader: casterFragmentShader,
			uniforms: {
				// Shared objects: setImpostorAtlas() updates them in place.
				uImpostorAlbedo: impostorUniforms.uImpostorAlbedo,
				uImpostorTypes: impostorUniforms.uImpostorTypes,
				uShadowCasterLight: { value: this.lightVector },
			},
			defines: {
				...getViewDefines(impostorMaterial.userData.atlas.views),
				IMPOSTOR_ATLAS_COLUMNS,
				IMPOSTOR_ATLAS_ROWS,
				IMPOSTOR_TYPE_COUNT,
			},
			side: DoubleSide,
			colorWrite: false,
		})
		if ('IMPOSTOR_SINGLE_FRAME' in impostorMaterial.defines) {
			material.defines.IMPOSTOR_SINGLE_FRAME = ''
		}
		return material
	}

	// Re-reads the live settings (strength is applied every update). Cascade
	// radii changes render every cascade on the next update.
	applySettings() {
		const { fade, softness, bias } = this.settings
		const start = Math.max(fade.start, 0)
		this.uniforms.uSceneryShadowFade.value.set(start, Math.max(fade.end, start + 1))
		this.uniforms.uSceneryShadowSoftness.value.set(
			Math.max(softness.near, 0),
			Math.max(softness.far, 0),
		)
		this.uniforms.uSceneryShadowBias.value = Math.max(bias, 0)
		this.forceRender = true
	}

	// Casts the airplane's shadow; `model` is the plane's mesh, and `geometry`
	// the simplified caster in the model's geometry space (the model's own
	// geometry when missing).
	setAirplane(model, geometry = model?.geometry) {
		if (!model) return
		this.airplane = new Mesh(geometry ?? model.geometry, this.airplaneCaster)
		this.airplane.name = 'airplane-shadow-caster'
		this.airplane.matrixAutoUpdate = false
		this.airplane.userData.model = model
		this.scene.add(this.airplane)
	}

	// Runs after the chunk manager committed this frame's scenery and before
	// rendering. `chunks` is the live chunk Map, `plane` the tracked Plane, and
	// `dayNightState` the latest DayNight state.
	update(chunks, chunkSize, plane, dayNightState) {
		const startTime = performance.now()
		this.frame++
		const { settings, uniforms } = this

		const light = selectShadowLight(
			dayNightState.sunDirection,
			dayNightState.moonDirection,
			settings,
		)
		this.light = light
		// Receivers dim only this light, for the cloud shadows too
		// (src/cloudShadows.js), so it stays current even without scenery
		// shadows.
		uniforms.uSceneryShadowLight.value.fromArray(light.direction).normalize()
		const strength = getShadowStrength(settings, light.strength)
		uniforms.uSceneryShadowStrength.value = strength
		if (strength <= 0) {
			this.lastDrawCalls = 0
			this.lastRenderMs = performance.now() - startTime
			return
		}

		let forced = this.forceRender
		if (hasLightDirectionChanged(this.lightDirection, light.direction, settings.lightThreshold)) {
			this.setLightBasis(light.direction)
			forced = true
		}
		this.forceRender = false

		plane.updateWorldMatrix(true, true)
		this.heading.set(0, 0, 1).applyQuaternion(plane.quaternion)
		this.syncCasters(chunks, chunkSize, plane)

		const { renderer } = this
		const previousTarget = renderer.getRenderTarget()
		let drawCalls = 0
		this.cascades.forEach((cascade, index) => {
			const config = settings.cascades[index]
			if (!shouldRenderCascade(this.frame, index, config.interval, forced)) {
				cascade.drawCalls = 0
				return
			}
			this.placeCascade(cascade, config, index, plane)
			// The airplane's shadow only matters near it; the far cascade skips
			// its dense mesh.
			if (this.airplane) this.airplane.visible = index === 0
			const before = renderer.info.render.calls
			renderer.setRenderTarget(cascade.target)
			renderer.clear(false, true, false)
			renderer.render(this.scene, cascade.camera)
			// With autoReset, render() restarts the counter.
			cascade.drawCalls = renderer.info.autoReset
				? renderer.info.render.calls
				: renderer.info.render.calls - before
			cascade.lastFrame = this.frame
			drawCalls += cascade.drawCalls
		})
		renderer.setRenderTarget(previousTarget)
		this.lastDrawCalls = drawCalls
		this.lastRenderMs = performance.now() - startTime
	}

	// Orients the cascade basis toward `direction` (unit, toward the light).
	setLightBasis(direction) {
		this.lightDirection = [...direction]
		this.lightVector.fromArray(direction).normalize()
		// Steep light would make world up degenerate as the camera's up.
		this.lightUp.copy(Math.abs(this.lightVector.y) > 0.999 ? WORLD_FORWARD : WORLD_UP)
		this.basisCamera.position.copy(this.lightVector)
		this.basisCamera.up.copy(this.lightUp)
		this.basisCamera.lookAt(0, 0, 0)
		this.basisCamera.updateMatrixWorld()
		this.basisCamera.matrixWorld.extractBasis(this.right, this.up, this.forward)
	}

	// Pools one proxy per scenery chunk that can reach the far cascade, and
	// copies the airplane transform.
	syncCasters(chunks, chunkSize, plane) {
		const { settings } = this
		const outer = settings.cascades[settings.cascades.length - 1]
		const sphere = getCascadeSphere(
			plane.position.x,
			plane.position.z,
			this.heading.x,
			this.heading.z,
			outer,
			settings,
			this.sphere,
		)
		let count = 0
		if (this.impostorCaster) {
			const halfSize = chunkSize / 2
			for (const chunk of chunks.values()) {
				if (!chunk.scenery) continue
				const { x, z } = chunk.position
				if (!chunkIntersectsSelection(x, z, halfSize, sphere.x, sphere.z, sphere.sphereRadius)) {
					continue
				}
				let proxy = this.proxies[count]
				if (!proxy) {
					proxy = new Mesh(chunk.scenery.geometry, this.impostorCaster)
					proxy.name = 'scenery-shadow-caster'
					this.proxies.push(proxy)
					this.scene.add(proxy)
				}
				proxy.geometry = chunk.scenery.geometry
				proxy.position.copy(chunk.position)
				proxy.visible = true
				count++
			}
		}
		for (let index = count; index < this.proxies.length; index++) {
			this.proxies[index].visible = false
		}
		this.proxyCount = count

		if (this.airplane) {
			this.airplane.matrix.copy(this.airplane.userData.model.matrixWorld)
			this.airplane.matrixWorldNeedsUpdate = true
		}
	}

	// Centers a cascade camera on its sphere, snapped to whole texels in light
	// space so shadows do not shimmer as the plane moves, and publishes the
	// matrix the receivers sample with.
	placeCascade(cascade, config, index, plane) {
		const { settings, uniforms } = this
		const sphere = getCascadeSphere(
			plane.position.x,
			plane.position.z,
			this.heading.x,
			this.heading.z,
			config,
			settings,
			this.sphere,
		)
		const radius = sphere.sphereRadius
		const texel = (radius * 2) / config.mapSize
		this.center.set(sphere.x, sphere.y, sphere.z)
		const x = snapToTexel(this.center.dot(this.right), texel)
		const y = snapToTexel(this.center.dot(this.up), texel)
		const z = this.center.dot(this.forward)
		this.center
			.copy(this.right)
			.multiplyScalar(x)
			.addScaledVector(this.up, y)
			.addScaledVector(this.forward, z)

		const { near, far } = getCascadeDepthRange(radius, settings.casterMargin)
		const { camera } = cascade
		camera.left = -radius
		camera.right = radius
		camera.top = radius
		camera.bottom = -radius
		camera.near = near
		camera.far = far
		camera.updateProjectionMatrix()
		camera.position.copy(this.center).addScaledVector(this.lightVector, radius + settings.casterMargin)
		camera.quaternion.copy(this.basisCamera.quaternion)
		camera.updateMatrixWorld()
		camera.matrixWorldInverse.copy(camera.matrixWorld).invert()

		uniforms.uSceneryShadowMatrices.value[index]
			.copy(CLIP_TO_TEXTURE)
			.multiply(camera.projectionMatrix)
			.multiply(camera.matrixWorldInverse)
		uniforms.uSceneryShadowCascades.value[index].set(
			this.center.x,
			this.center.z,
			sphere.diskRadius,
			1 / (radius * 2),
		)
		uniforms.uSceneryShadowDepthScale.value[index] = 1 / (far - near)
	}

	getStats() {
		return {
			enabled: this.settings.enabled,
			light: this.light?.light ?? null,
			lightElevation: this.light?.elevation ?? null,
			strength: this.uniforms.uSceneryShadowStrength.value,
			casters: this.proxyCount,
			airplane: Boolean(this.airplane),
			airplaneTriangles: this.airplane ? getTriangleCount(this.airplane.geometry) : 0,
			drawCalls: this.lastDrawCalls,
			updateMs: this.lastRenderMs,
			cascades: this.cascades.map((cascade, index) => ({
				radius: this.settings.cascades[index].radius,
				mapSize: this.settings.cascades[index].mapSize,
				interval: this.settings.cascades[index].interval,
				center: this.uniforms.uSceneryShadowCascades.value[index].toArray().slice(0, 2),
				lastFrame: cascade.lastFrame,
				drawCalls: cascade.drawCalls,
			})),
		}
	}

	dispose() {
		for (const cascade of this.cascades) {
			cascade.target.depthTexture.dispose()
			cascade.target.dispose()
		}
		this.impostorCaster?.dispose()
		this.airplaneCaster.dispose()
		this.scene.clear()
	}
}

function getTriangleCount(geometry) {
	return (geometry.index ?? geometry.attributes.position).count / 3
}
