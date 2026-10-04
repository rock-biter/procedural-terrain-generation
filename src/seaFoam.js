import {
	Camera,
	Color,
	CustomBlending,
	LinearFilter,
	MaxEquation,
	Mesh,
	OneFactor,
	PlaneGeometry,
	RedFormat,
	Scene,
	ShaderMaterial,
	UnsignedByteType,
	Vector3,
	Vector4,
	WebGLRenderTarget,
} from 'three'
import casterVertexShader from './shaders/sea-foam-caster-vertex.glsl'
import casterFragmentShader from './shaders/sea-foam-caster-fragment.glsl'
import { SCENERY_IMPOSTORS, getCatalogSources } from './impostors/impostorCatalogs'
import { IMPOSTOR_INSTANCE_STRIDE, IMPOSTOR_TYPE_COUNT } from './impostors/impostorTypes'
import {
	SEA_FOAM_DEFAULTS,
	chunkIntersectsSeaFoamWindow,
	countSeaFoamInstances,
	getSeaFoamRadii,
	getSeaFoamWindow,
	shouldRenderSeaFoam,
} from './seaFoamPolicy'

const BLACK = new Color(0x000000)
// How far beyond its chunk a foam instance can reach into the window, in world
// units: its footprint and ripples, plus satellites placed across the chunk
// edge (src/sceneryPlacement.js).
const CASTER_MARGIN = 40

// Receiver uniforms, shared with the terrain material through the shared
// uniform object (sea-ripple-pars-fragment.glsl).
export function createSeaFoamUniforms() {
	return {
		uSeaFoamMap: { value: null },
		uSeaFoamWindow: { value: new Vector3(0, 0, 1) },
		uSeaFoamShape: { value: new Vector4() },
		uSeaFoamBlend: { value: SEA_FOAM_DEFAULTS.blend },
	}
}

// Ripples around the sea rocks (rules in src/seaFoamPolicy.js). It renders the
// footprint of every sea rock around the airplane into a top-down map of
// closeness to the nearest rock, which the terrain shader turns into the
// coast's ripples by fusing it with the sea height (getSeaFoamHeight()). The map is world-locked: it renders again
// only when the airplane has moved far enough, the drawn rock chunks change,
// or the settings change. Casters and receivers use flat world space.
//
// Ownership: this object owns the render target and the caster material. Its
// pooled proxies borrow the chunks' scenery geometries and never dispose them.
// `uniforms` is the shared uniform object, which must hold
// createSeaFoamUniforms(); `settings` is params.seaFoam (createSeaFoamSettings()).
export default class SeaFoam {
	constructor({ renderer, uniforms, settings }) {
		this.renderer = renderer
		this.uniforms = uniforms
		this.settings = settings
		this.center = null
		this.forceRender = true
		this.renders = 0
		this.lastRenderMs = 0
		this.window = {}
		this.previousClearColor = new Color()
		// Scenery geometries drawn by the last render, in order, and the foam
		// instance count of every geometry seen (scenery geometries never change
		// after creation).
		this.casters = []
		this.drawn = []
		this.foamCounts = new WeakMap()

		this.radii = getSeaFoamRadii(
			(type) => getCatalogSources(SCENERY_IMPOSTORS, type)[0].attributes.position.array,
		)
		this.material = new ShaderMaterial({
			vertexShader: casterVertexShader,
			fragmentShader: casterFragmentShader,
			defines: { IMPOSTOR_TYPE_COUNT: String(IMPOSTOR_TYPE_COUNT) },
			uniforms: {
				uSeaFoamRadius: { value: this.radii },
				uSeaFoamWindow: { value: new Vector3() },
				uSeaFoamReach: { value: settings.reach },
			},
			depthTest: false,
			depthWrite: false,
			// Overlapping footprints keep the closest rock.
			blending: CustomBlending,
			blendEquation: MaxEquation,
			blendSrc: OneFactor,
			blendDst: OneFactor,
		})
		this.scene = new Scene()
		this.scene.name = 'sea-foam-casters'
		this.proxies = []
		// Compiles the program before the first rock arrives (compileAsync());
		// hidden from the first render on.
		this.placeholder = new Mesh(new PlaneGeometry(2, 2), this.material)
		this.placeholder.frustumCulled = false
		this.scene.add(this.placeholder)
		// The caster shader writes clip coordinates itself.
		this.camera = new Camera()

		this.target = null
		this.createTarget()
		this.applySettings()
	}

	createTarget() {
		this.target?.dispose()
		const { mapSize } = this.settings
		this.mapSize = mapSize
		this.target = new WebGLRenderTarget(mapSize, mapSize, {
			format: RedFormat,
			type: UnsignedByteType,
			depthBuffer: false,
			minFilter: LinearFilter,
			magFilter: LinearFilter,
			generateMipmaps: false,
		})
		this.target.texture.name = 'sea-foam'
		this.uniforms.uSeaFoamMap.value = this.target.texture
	}

	// Compiles the caster program before the first rock comes into range
	// (World.precompileShaders()), through the placeholder mesh.
	compileAsync() {
		return this.renderer.compileAsync(this.scene, this.camera)
	}

	// Re-reads the live settings; the next update renders the map again.
	applySettings() {
		const { settings, uniforms } = this
		if (settings.mapSize !== this.mapSize) this.createTarget()
		this.material.uniforms.uSeaFoamReach.value = settings.reach
		const strength = settings.enabled && this.center ? settings.strength : 0
		uniforms.uSeaFoamShape.value.set(settings.reach, settings.edgeDepth, settings.slope, strength)
		uniforms.uSeaFoamBlend.value = settings.blend
		this.forceRender = true
	}

	// Runs after this frame's scenery commits, before the main pass.
	update(chunks, chunkSize, plane) {
		const startTime = performance.now()
		const { settings } = this
		if (!settings.enabled) {
			this.uniforms.uSeaFoamShape.value.w = 0
			return
		}

		const { x, z } = plane.position
		const window = getSeaFoamWindow(x, z, settings, this.window)
		const castersChanged = this.syncCasters(chunks, chunkSize, window)
		if (
			!shouldRenderSeaFoam({
				center: this.center,
				x,
				z,
				recenterDistance: settings.radius * settings.recenterShare,
				castersChanged,
				forced: this.forceRender,
			})
		) {
			return
		}

		this.forceRender = false
		this.render(window)
		this.uniforms.uSeaFoamShape.value.w = settings.strength
		this.center = [x, z]
		this.renders++
		this.lastRenderMs = performance.now() - startTime
	}

	// Lists the scenery geometries holding foam instances within reach of the
	// window. Returns true when the list differs from the last render's.
	syncCasters(chunks, chunkSize, window) {
		const { casters, foamCounts } = this
		let count = 0
		let changed = false
		for (const chunk of chunks.values()) {
			if (!chunk.scenery) continue
			const { x, z } = chunk.position
			if (!chunkIntersectsSeaFoamWindow(x, z, chunkSize / 2, window, CASTER_MARGIN)) continue
			const { geometry } = chunk.scenery
			let foam = foamCounts.get(geometry)
			if (foam === undefined) {
				foam = countSeaFoamInstances(
					geometry.attributes.aInstanceA.data.array,
					IMPOSTOR_INSTANCE_STRIDE,
					this.radii,
				)
				foamCounts.set(geometry, foam)
			}
			if (foam === 0) continue
			if (this.drawn[count] !== geometry) changed = true
			casters[count] = chunk
			count++
		}
		if (count !== this.drawn.length) changed = true
		casters.length = count
		return changed
	}

	// Renders the footprints of the listed chunks into the window.
	render(window) {
		const { renderer, casters, proxies } = this
		this.material.uniforms.uSeaFoamWindow.value.set(window.x, window.z, window.halfSize)
		this.placeholder.visible = false

		for (let index = 0; index < casters.length; index++) {
			const chunk = casters[index]
			let proxy = proxies[index]
			if (!proxy) {
				proxy = new Mesh(chunk.scenery.geometry, this.material)
				proxy.name = 'sea-foam-caster'
				proxy.frustumCulled = false
				proxies.push(proxy)
				this.scene.add(proxy)
			}
			proxy.geometry = chunk.scenery.geometry
			proxy.position.copy(chunk.position)
			proxy.visible = true
		}
		for (let index = casters.length; index < proxies.length; index++) {
			proxies[index].visible = false
		}
		this.drawn = casters.map((chunk) => chunk.scenery.geometry)

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

		this.uniforms.uSeaFoamWindow.value.set(window.x, window.z, window.halfSize)
	}

	getStats() {
		return {
			enabled: this.settings.enabled,
			strength: this.uniforms.uSeaFoamShape.value.w,
			radius: this.settings.radius,
			mapSize: this.mapSize,
			center: this.center,
			casterChunks: this.drawn.length,
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
