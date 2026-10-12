import {
	Camera,
	Color,
	CustomBlending,
	DoubleSide,
	HalfFloatType,
	LinearFilter,
	MaxEquation,
	Mesh,
	OneFactor,
	PlaneGeometry,
	RedFormat,
	Scene,
	ShaderMaterial,
	Vector2,
	Vector3,
	Vector4,
	WebGLRenderTarget,
} from 'three'
import casterVertexShader from './shaders/sun-occlusion-caster-vertex.glsl'
import casterFragmentShader from './shaders/sun-occlusion-caster-fragment.glsl'
import { getFlatBoxHalfHeight } from './chunkPolicy'
import { getChunkShadowIndex, getChunkShadowView } from './chunkTopology'
import {
	SUN_OCCLUSION_HEIGHT_DEFINES,
	chunkIntersectsSunOcclusionWindow,
	chunkRisesAboveSea,
	getSunOcclusionSegments,
	getSunOcclusionStrength,
	getSunOcclusionWindow,
	shouldRenderSunOcclusion,
} from './sunOcclusionPolicy'

const BLACK = new Color(0x000000)
// Shadow view slot of each chunk geometry the map draws (getChunkShadowView());
// the scenery shadow cascades use 0 and 1.
const SUN_OCCLUSION_VIEW = 2

// Receiver uniforms, shared with the terrain material through the shared
// uniform object (sun-occlusion-pars-fragment.glsl).
export function createSunOcclusionUniforms() {
	return {
		uSunOcclusionMap: { value: null },
		uSunOcclusionWindow: { value: new Vector3(0, 0, 1) },
		uSunOcclusionStrength: { value: new Vector2() },
		uSunOcclusionShape: { value: new Vector4() },
	}
}

// The relief hiding a low sun from the terrain (rules in
// src/sunOcclusionPolicy.js). While the sun is low, it renders the heights of
// the terrain chunks around the airplane into a top-down map, which every
// terrain pixel marches over toward the sun (getSunOcclusion()). The map is
// world-locked: it renders again when the window moves far enough, the drawn
// chunks change (at most every `minFrames`), or the settings change, and not
// at all while the sun is high or down. Casters and receivers use flat world
// space; the receivers apply the curvature.
//
// Ownership: this object owns the render target and the caster material. Its
// pooled proxies draw the chunks' shadow views in their own slot (owned by
// src/chunkTopology.js and disposed with their chunk geometry) and never
// dispose them. `uniforms` is the shared uniform object, which must hold
// createSunOcclusionUniforms(); `settings` is params.sunOcclusion
// (createSunOcclusionSettings()).
export default class SunOcclusion {
	constructor({ renderer, uniforms, settings }) {
		this.renderer = renderer
		this.uniforms = uniforms
		this.settings = settings
		// [x, z] of the last rendered window, or null before the first render.
		this.center = null
		this.forceRender = true
		// Set when the listed chunks differ from the drawn ones, until a render.
		this.castersChanged = false
		this.framesSinceRender = Infinity
		this.renders = 0
		this.lastRenderMs = 0
		this.triangles = 0
		this.skippedSeaChunks = 0
		this.window = {}
		this.strength = { specular: 0, diffuse: 0 }
		this.previousClearColor = new Color()
		// Chunks listed for the map, and the geometries the last render drew.
		this.casters = []
		this.drawn = []

		this.material = new ShaderMaterial({
			vertexShader: casterVertexShader,
			fragmentShader: casterFragmentShader,
			defines: { ...SUN_OCCLUSION_HEIGHT_DEFINES },
			uniforms: { uSunOcclusionWindow: { value: new Vector3(0, 0, 1) } },
			// Seen from below, half the chunk triangles wind backward.
			side: DoubleSide,
			depthTest: false,
			depthWrite: false,
			// Overlapping chunks (a LOD swap in progress) keep the highest surface.
			blending: CustomBlending,
			blendEquation: MaxEquation,
			blendSrc: OneFactor,
			blendDst: OneFactor,
		})
		this.scene = new Scene()
		this.scene.name = 'sun-occlusion-casters'
		this.proxies = []
		// Compiles the program before the first low sun (compileAsync()); hidden
		// from the first render on.
		this.placeholder = new Mesh(new PlaneGeometry(2, 2), this.material)
		this.placeholder.frustumCulled = false
		this.scene.add(this.placeholder)
		// The caster shader writes clip coordinates itself.
		this.camera = new Camera()

		this.target = null
		this.createTarget()
	}

	// Half float: heights reach about 200 units above the sea, kept to about a
	// tenth of a unit.
	createTarget() {
		this.target?.dispose()
		const { mapSize } = this.settings
		this.mapSize = mapSize
		this.target = new WebGLRenderTarget(mapSize, mapSize, {
			format: RedFormat,
			type: HalfFloatType,
			depthBuffer: false,
			minFilter: LinearFilter,
			magFilter: LinearFilter,
			generateMipmaps: false,
		})
		this.target.texture.name = 'sun-occlusion'
		this.uniforms.uSunOcclusionMap.value = this.target.texture
	}

	// Compiles the caster program before the sun first gets low
	// (World.precompileShaders()), through the placeholder mesh.
	compileAsync() {
		return this.renderer.compileAsync(this.scene, this.camera)
	}

	// Re-reads the settings the map depends on; the next update renders it
	// again. The march's shape and strength are read every update.
	applySettings() {
		if (this.settings.mapSize !== this.mapSize) this.createTarget()
		this.forceRender = true
	}

	// Runs after this frame's chunk commits, before the main pass. `chunks` is
	// the live chunk Map, `plane` the tracked Plane, and `dayNightState` the
	// latest DayNight state.
	update(chunks, chunkSize, plane, dayNightState) {
		const startTime = performance.now()
		this.framesSinceRender++
		const { settings, uniforms } = this
		const { sunDirection } = dayNightState
		const strength = getSunOcclusionStrength(
			settings,
			sunDirection,
			dayNightState.sunIntensity,
			this.strength,
		)
		const firstStep = Math.max(settings.firstStep, 0.1)
		uniforms.uSunOcclusionShape.value.set(
			firstStep,
			Math.max(settings.reach, firstStep + 1),
			Math.max(settings.penumbra, 1e-4),
			settings.cone,
		)
		if (strength.specular <= 0 && strength.diffuse <= 0) {
			uniforms.uSunOcclusionStrength.value.set(0, 0)
			return
		}

		const { x, z } = plane.position
		const window = getSunOcclusionWindow(x, z, sunDirection, settings, this.window)
		if (this.syncCasters(chunks, chunkSize, window)) this.castersChanged = true
		const render = shouldRenderSunOcclusion({
			center: this.center,
			x: window.x,
			z: window.z,
			recenterDistance: settings.radius * settings.recenterShare,
			castersChanged: this.castersChanged,
			forced: this.forceRender,
			framesSinceRender: this.framesSinceRender,
			minFrames: settings.minFrames,
		})
		if (render) {
			this.forceRender = false
			this.castersChanged = false
			this.render(window)
			this.center = [window.x, window.z]
			this.framesSinceRender = 0
			this.renders++
			this.lastRenderMs = performance.now() - startTime
		}
		uniforms.uSunOcclusionStrength.value.set(strength.specular, strength.diffuse)
	}

	// Lists the chunks that overlap the window and rise above the sea; a chunk
	// of open sea would only draw the cleared height. Returns true when the
	// list differs from the geometries the last render drew.
	syncCasters(chunks, chunkSize, window) {
		const { casters, drawn } = this
		const halfSize = chunkSize / 2
		let count = 0
		let skipped = 0
		let changed = false
		for (const chunk of chunks.values()) {
			const { geometry, position } = chunk
			if (!geometry?.userData.segments) continue
			if (!chunkIntersectsSunOcclusionWindow(position.x, position.z, halfSize, window)) continue
			const flat = geometry.boundingSphere
			const top = position.y + flat.center.y + getFlatBoxHalfHeight(flat.radius, chunkSize)
			if (!chunkRisesAboveSea(top)) {
				skipped++
				continue
			}
			if (drawn[count] !== geometry) changed = true
			casters[count] = chunk
			count++
		}
		if (count !== drawn.length) changed = true
		casters.length = count
		this.skippedSeaChunks = skipped
		return changed
	}

	// Renders the heights of the listed chunks into the window.
	render(window) {
		const { renderer, casters, proxies, settings } = this
		this.material.uniforms.uSunOcclusionWindow.value.set(window.x, window.z, window.halfSize)
		this.placeholder.visible = false

		let triangles = 0
		for (let index = 0; index < casters.length; index++) {
			const chunk = casters[index]
			const { geometry } = chunk
			const { segments } = geometry.userData
			const shadowIndex = getChunkShadowIndex(
				segments,
				getSunOcclusionSegments(settings.segments, segments),
			)
			const view = getChunkShadowView(geometry, SUN_OCCLUSION_VIEW)
			// Only on a change: a new index rebuilds the view's vertex array.
			if (view.index !== shadowIndex) view.setIndex(shadowIndex)
			let proxy = proxies[index]
			if (!proxy) {
				proxy = new Mesh(view, this.material)
				proxy.name = 'sun-occlusion-caster'
				proxy.frustumCulled = false
				proxies.push(proxy)
				this.scene.add(proxy)
			}
			proxy.geometry = view
			proxy.position.copy(chunk.position)
			proxy.visible = true
			triangles += shadowIndex.count / 3
		}
		for (let index = casters.length; index < proxies.length; index++) {
			proxies[index].visible = false
		}
		this.drawn = casters.map((chunk) => chunk.geometry)
		this.triangles = triangles

		const previousTarget = renderer.getRenderTarget()
		const previousAutoClear = renderer.autoClear
		const previousClearAlpha = renderer.getClearAlpha()
		renderer.getClearColor(this.previousClearColor)
		renderer.autoClear = false
		renderer.setClearColor(BLACK, 0)

		renderer.setRenderTarget(this.target)
		renderer.clear(true, false, false)
		if (casters.length > 0) renderer.render(this.scene, this.camera)

		renderer.setRenderTarget(previousTarget)
		renderer.setClearColor(this.previousClearColor, previousClearAlpha)
		renderer.autoClear = previousAutoClear

		this.uniforms.uSunOcclusionWindow.value.set(window.x, window.z, window.halfSize)
	}

	getStats() {
		const strength = this.uniforms.uSunOcclusionStrength.value
		return {
			enabled: this.settings.enabled,
			specular: strength.x,
			diffuse: strength.y,
			radius: this.settings.radius,
			mapSize: this.mapSize,
			steps: this.settings.steps,
			center: this.center,
			casterChunks: this.drawn.length,
			skippedSeaChunks: this.skippedSeaChunks,
			triangles: this.triangles,
			renders: this.renders,
			renderMs: this.lastRenderMs,
		}
	}

	dispose() {
		this.target.dispose()
		this.material.dispose()
		this.placeholder.geometry.dispose()
		this.scene.clear()
		this.proxies.length = 0
		this.casters.length = 0
		this.drawn.length = 0
	}
}
