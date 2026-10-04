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
import { LightBasis, createImpostorCasterMaterial, writeShadowMatrix } from './lightSpace'
import { chunkIntersectsSelection } from './sceneryMeshPolicy'
import {
	SCENERY_SHADOW_CASCADE_COUNT,
	getCascadeDepthRange,
	getCascadeSphere,
	getShadowStrength,
	hasLightDirectionChanged,
	selectShadowLight,
	shouldRenderCascade,
} from './shadowPolicy'

// Receiver uniforms, shared with the terrain, impostor, and near-mesh
// materials through the shared uniform object (scenery-shadow-pars-fragment.glsl).
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
// the airplane geometry, and never dispose them. `uniforms` is the
// shared uniform object (src/sharedUniforms.js), which must hold createSceneryShadowUniforms(); this
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
		this.basis = new LightBasis()
		this.center = new Vector3()
		this.heading = new Vector3()
		this.sphere = {}

		this.scene = new Scene()
		this.scene.name = 'scenery-shadow-casters'
		this.proxies = []
		this.proxyCount = 0
		this.impostorCaster = impostorMaterial ? this.createImpostorCaster(impostorMaterial) : null
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
		const { atlas, impostorUniforms } = impostorMaterial.userData
		return createImpostorCasterMaterial({
			catalog: atlas.catalog,
			views: atlas.views,
			// Shared objects: setImpostorAtlas() updates them in place.
			albedo: impostorUniforms.uImpostorAlbedo,
			types: impostorUniforms.uImpostorTypes,
			light: this.basis.vector,
			singleFrame: 'IMPOSTOR_SINGLE_FRAME' in impostorMaterial.defines,
			colorWrite: false,
		})
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

		// Filled in place after the first frame.
		const light = selectShadowLight(
			dayNightState.sunDirection,
			dayNightState.moonDirection,
			settings,
			this.light ?? undefined,
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
		if (hasLightDirectionChanged(this.basis.direction, light.direction, settings.lightThreshold)) {
			this.basis.setDirection(light.direction)
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
		const { near, far } = getCascadeDepthRange(radius, settings.casterMargin)
		// The camera sits beyond the sphere toward the light.
		this.basis.fit(
			cascade.camera,
			this.center,
			radius,
			texel,
			near,
			far,
			radius + settings.casterMargin,
		)
		writeShadowMatrix(uniforms.uSceneryShadowMatrices.value[index], cascade.camera)
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
