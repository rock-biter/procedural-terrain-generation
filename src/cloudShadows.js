import {
	Color,
	CustomBlending,
	LinearFilter,
	Matrix4,
	MaxEquation,
	Mesh,
	OneFactor,
	OrthographicCamera,
	PlaneGeometry,
	RedFormat,
	Scene,
	ShaderMaterial,
	UnsignedByteType,
	Vector2,
	Vector3,
	WebGLRenderTarget,
} from 'three'
import fullscreenVertexShader from './shaders/fullscreen-vertex.glsl'
import blurFragmentShader from './shaders/cloud-shadow-blur-fragment.glsl'
import { bakeImpostorAtlas } from './impostors/impostorBaker'
import { CLOUD_IMPOSTORS } from './impostors/impostorCatalogs'
import {
	CLOUD_SHADOW_IMPOSTOR_FRAMES,
	CLOUD_SHADOW_IMPOSTOR_FRAME_SIZE,
} from './impostors/impostorTypes'
import { createHemiOctViews } from './impostors/octahedral'
import { LightBasis, createImpostorCasterMaterial, writeShadowMatrix } from './lightSpace'
import {
	CLOUD_SHADOW_DEFAULTS,
	getCloudShadowBlurTexels,
	getCloudShadowSphere,
	getShadowStrength,
	hasLightDirectionChanged,
	shouldRenderCloudShadow,
} from './shadowPolicy'

// Half the depth of the light camera. The map has no depth test, so it only
// has to contain every cloud along the light rays through the covered disk,
// even with a low light.
const DEPTH_REACH = 8000
const BLACK = new Color(0x000000)

// Receiver uniforms, shared with the terrain, impostor, and near-mesh
// materials through the shared uniform object (cloud-shadow-pars-fragment.glsl).
export function createCloudShadowUniforms() {
	return {
		uCloudShadowMap: { value: null },
		uCloudShadowMatrix: { value: new Matrix4() },
		uCloudShadowWindow: { value: new Vector3() },
		uCloudShadowStrength: { value: 0 },
	}
}

// Soft cloud shadows on the terrain and the scenery (rules in
// src/shadowPolicy.js). It renders the cloud impostors, seen from the light and
// turned toward the airplane's current position, as fractional coverage into a
// light-aligned map around the airplane, blurs it, and publishes the matrix
// the receivers sample it with. Casters and
// receivers use flat world space; the curvature is visual only.
//
// The drawn clouds' atlas holds only frontal views, but the light can look at
// a cloud from any side, so the caster reads its own small lower-hemisphere
// atlas (CLOUD_SHADOW_IMPOSTOR_FRAMES), baked here without wood detail: only
// its coverage is used.
//
// Ownership: this object owns both render targets, the shadow atlas, the light
// camera, and the caster and blur materials. The caster proxy borrows the
// cloud field's impostor geometry and never disposes it. `uniforms` is the shared
// uniform object (src/sharedUniforms.js), which must hold createCloudShadowUniforms(); this object
// writes them. `settings` is params.clouds.shadows
// (createCloudShadowSettings()), `shadowSettings` the scenery shadow settings
// (its `lightThreshold`), and `clouds` the Clouds field.
export default class CloudShadows {
	constructor({ renderer, uniforms, settings, shadowSettings, clouds }) {
		this.renderer = renderer
		this.uniforms = uniforms
		this.settings = settings
		this.shadowSettings = shadowSettings
		this.clouds = clouds
		this.center = null
		this.revision = -1
		this.forceRender = true
		// shouldRenderCloudShadow() options, filled every frame.
		this.renderCheck = {
			center: null,
			x: 0,
			z: 0,
			recenterDistance: 0,
			lightChanged: false,
			revisionChanged: false,
			forced: false,
		}
		this.renders = 0
		this.lastRenderMs = 0
		this.basis = new LightBasis()
		this.mapCenter = new Vector3()
		this.sphere = {}
		this.previousClearColor = new Color()

		this.atlas = bakeImpostorAtlas(renderer, {
			catalog: CLOUD_IMPOSTORS,
			views: createHemiOctViews(CLOUD_SHADOW_IMPOSTOR_FRAMES, CLOUD_IMPOSTORS.hemisphere),
			frameSize: CLOUD_SHADOW_IMPOSTOR_FRAME_SIZE,
		})
		this.casterMaterial = createImpostorCasterMaterial({
			catalog: CLOUD_IMPOSTORS,
			views: this.atlas.views,
			// Coverage does not depend on the wood detail, so a cloud re-bake leaves
			// this atlas unchanged.
			albedo: { value: this.atlas.albedo },
			types: {
				value: this.atlas.types.map(
					({ frameRadius, centerY }) => new Vector2(frameRadius, centerY),
				),
			},
			light: this.basis.vector,
			singleFrame: 'IMPOSTOR_SINGLE_FRAME' in clouds.material.defines,
			// The clouds turn toward the airplane as they are drawn.
			uniforms: { uShadowCasterFacing: { value: new Vector2() } },
			defines: { SHADOW_CASTER_COVERAGE: '' },
			depthTest: false,
			depthWrite: false,
			// Overlapping clouds keep the larger coverage.
			blending: CustomBlending,
			blendEquation: MaxEquation,
			blendSrc: OneFactor,
			blendDst: OneFactor,
		})
		this.scene = new Scene()
		this.scene.name = 'cloud-shadow-casters'
		this.proxy = new Mesh(new PlaneGeometry(2, 2), this.casterMaterial)
		this.proxy.name = 'cloud-shadow-caster'
		this.proxy.frustumCulled = false
		this.placeholderGeometry = this.proxy.geometry
		this.scene.add(this.proxy)
		this.camera = new OrthographicCamera()

		this.blurMaterial = new ShaderMaterial({
			vertexShader: fullscreenVertexShader,
			fragmentShader: blurFragmentShader,
			defines: { CLOUD_SHADOW_MAX_BLUR: CLOUD_SHADOW_DEFAULTS.maxBlurTexels },
			uniforms: {
				tSource: { value: null },
				uStep: { value: new Vector2() },
				uRadius: { value: 0 },
			},
			depthTest: false,
			depthWrite: false,
		})
		this.blurScene = new Scene()
		const quad = new Mesh(new PlaneGeometry(2, 2), this.blurMaterial)
		quad.frustumCulled = false
		this.blurScene.add(quad)
		this.blurQuad = quad

		this.targets = []
		this.createTargets()
	}

	createTargets() {
		for (const target of this.targets) target.dispose()
		const { mapSize } = this.settings
		this.mapSize = mapSize
		this.targets = [0, 1].map((index) => {
			const target = new WebGLRenderTarget(mapSize, mapSize, {
				format: RedFormat,
				type: UnsignedByteType,
				depthBuffer: false,
				minFilter: LinearFilter,
				magFilter: LinearFilter,
				generateMipmaps: false,
			})
			target.texture.name = `cloud-shadow-${index}`
			return target
		})
		this.uniforms.uCloudShadowMap.value = this.targets[0].texture
	}

	// Compiles the caster and blur programs before their first render, which
	// waits for daylight (World.precompileShaders()).
	compileAsync() {
		return Promise.all([
			this.renderer.compileAsync(this.scene, this.camera),
			this.renderer.compileAsync(this.blurScene, this.camera),
		])
	}

	// Re-reads the live settings; the next update renders the map again.
	applySettings() {
		if (this.settings.mapSize !== this.mapSize) this.createTargets()
		this.forceRender = true
	}

	// Runs after SceneryShadows.update() (which picks the shadowing light,
	// `light`) and after the cloud field's update, before the main pass.
	update(light, plane) {
		const startTime = performance.now()
		const { settings, uniforms } = this
		const strength =
			light && this.clouds.impostors ? getShadowStrength(settings, light.strength) : 0
		// Nothing is sampled before the first render.
		uniforms.uCloudShadowStrength.value = this.center ? strength : 0
		if (strength <= 0) return

		const lightChanged = hasLightDirectionChanged(
			this.basis.direction,
			light.direction,
			this.shadowSettings.lightThreshold,
		)
		const { x, z } = plane.position
		const check = this.renderCheck
		check.center = this.center
		check.x = x
		check.z = z
		check.recenterDistance = settings.radius * settings.recenterShare
		check.lightChanged = lightChanged
		check.revisionChanged = this.revision !== this.clouds.revision
		check.forced = this.forceRender
		if (!shouldRenderCloudShadow(check)) return

		if (lightChanged) this.basis.setDirection(light.direction)
		this.forceRender = false
		this.revision = this.clouds.revision
		this.render(x, z)
		uniforms.uCloudShadowStrength.value = strength
		this.renders++
		this.lastRenderMs = performance.now() - startTime
	}

	// Renders the coverage around (x, z), snapped to whole texels in light
	// space so re-centered maps line up, then blurs it.
	render(x, z) {
		const { renderer, settings, uniforms, camera } = this
		const sphere = getCloudShadowSphere(x, z, settings, this.sphere)
		const radius = sphere.sphereRadius
		const texel = (radius * 2) / this.mapSize
		this.mapCenter.set(sphere.x, sphere.y, sphere.z)
		this.basis.fit(camera, this.mapCenter, radius, texel, -DEPTH_REACH, DEPTH_REACH)

		this.casterMaterial.uniforms.uShadowCasterFacing.value.set(x, z)
		this.proxy.geometry = this.clouds.impostors?.geometry ?? this.placeholderGeometry
		this.proxy.visible = Boolean(this.clouds.impostors)

		const previousTarget = renderer.getRenderTarget()
		const previousAutoClear = renderer.autoClear
		const previousClearAlpha = renderer.getClearAlpha()
		renderer.getClearColor(this.previousClearColor)
		renderer.autoClear = false
		renderer.setClearColor(BLACK, 0)

		const [main, scratch] = this.targets
		renderer.setRenderTarget(main)
		renderer.clear(true, false, false)
		renderer.render(this.scene, camera)

		const blur = getCloudShadowBlurTexels(settings.softness, texel)
		if (blur > 0) {
			const { uniforms: blurUniforms } = this.blurMaterial
			blurUniforms.uRadius.value = blur
			blurUniforms.tSource.value = main.texture
			blurUniforms.uStep.value.set(1 / this.mapSize, 0)
			renderer.setRenderTarget(scratch)
			renderer.render(this.blurScene, camera)
			blurUniforms.tSource.value = scratch.texture
			blurUniforms.uStep.value.set(0, 1 / this.mapSize)
			renderer.setRenderTarget(main)
			renderer.render(this.blurScene, camera)
		}

		renderer.setRenderTarget(previousTarget)
		renderer.setClearColor(this.previousClearColor, previousClearAlpha)
		renderer.autoClear = previousAutoClear

		writeShadowMatrix(uniforms.uCloudShadowMatrix.value, camera)
		uniforms.uCloudShadowWindow.value.set(sphere.x, sphere.z, sphere.diskRadius)
		this.center = [x, z]
	}

	getStats() {
		return {
			enabled: this.settings.enabled,
			strength: this.uniforms.uCloudShadowStrength.value,
			radius: this.settings.radius,
			mapSize: this.mapSize,
			center: this.center,
			renders: this.renders,
			renderMs: this.lastRenderMs,
		}
	}

	dispose() {
		for (const target of this.targets) target.dispose()
		this.atlas.dispose()
		this.casterMaterial.dispose()
		this.blurMaterial.dispose()
		this.placeholderGeometry.dispose()
		this.blurQuad.geometry.dispose()
		this.scene.clear()
		this.blurScene.clear()
	}
}
