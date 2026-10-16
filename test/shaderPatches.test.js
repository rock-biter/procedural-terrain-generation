// Applies every onBeforeCompile patch to the raw shaders of the installed
// three.js (ShaderLib, as three hands them to onBeforeCompile), so an upgrade
// that renames or drops a chunk fails here instead of in the browser.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
	BackSide,
	BoxGeometry,
	BufferGeometry,
	Color,
	Mesh,
	MeshStandardMaterial,
	PerspectiveCamera,
	ShaderLib,
	Vector2,
	Vector3,
	Vector4,
} from 'three'
import Aurora from '../src/aurora.js'
import { createAuroraSettings } from '../src/auroraPolicy.js'
import Chunk from '../src/chunk.js'
import LensFlareEffect from '../src/lensFlareEffect.js'
import { createLensFlareSettings } from '../src/lensFlarePolicy.js'
import SunOcclusion, { createSunOcclusionUniforms } from '../src/sunOcclusion.js'
import SeaWake, { createSeaWakeUniforms } from '../src/seaWake.js'
import { createSeaWakeSettings } from '../src/seaWakePolicy.js'
import { createSunOcclusionSettings } from '../src/sunOcclusionPolicy.js'
import Plane from '../src/plane.js'
import TerrainSampleDebug from '../src/terrainSampleDebug.js'
import { AIRPLANE_MODELS } from '../src/airplaneModels.js'
import { replaceChunks } from '../src/shaderChunks.js'
import { createSceneryShadowSettings } from '../src/shadowPolicy.js'
import { createTerrainCasterMaterial } from '../src/lightSpace.js'
import {
	createCloudMeshSettings,
	createSceneryMeshSettings,
	createSceneryWireframeSettings,
} from '../src/sceneryMeshPolicy.js'
import SceneryMeshes from '../src/impostors/sceneryMeshes.js'
import {
	createImpostorMaterial,
	createImpostorWireframeMaterial,
} from '../src/impostors/impostorMaterial.js'
import { CLOUD_IMPOSTORS, SCENERY_IMPOSTORS } from '../src/impostors/impostorCatalogs.js'
import { createHemiOctViews } from '../src/impostors/octahedral.js'
import { CLOUD_IMPOSTOR_VIEWS, IMPOSTOR_FRAMES_DESKTOP } from '../src/impostors/impostorTypes.js'

// The source three passes to onBeforeCompile: ShaderLib with its includes
// still unresolved.
function rawShader(id) {
	const { vertexShader, fragmentShader } = ShaderLib[id]
	return { vertexShader, fragmentShader, uniforms: {} }
}

// Runs a material's patch and checks it changed both stages.
function patch(material, id) {
	const shader = rawShader(id)
	material.onBeforeCompile(shader, null)
	return shader
}

const uniforms = { uCamera: { value: new Vector3() }, uCurvature: { value: 3000 } }

function fakeAtlas(catalog, views) {
	return {
		catalog,
		views,
		albedo: null,
		normal: null,
		paint: null,
		types: Array.from({ length: catalog.typeCount }, () => ({ frameRadius: 1, centerY: 0 })),
	}
}

test('replaceChunks replaces includes and throws on a missing one', () => {
	assert.equal(replaceChunks('a\n#include <x>\nb', { x: 'X$&' }), 'a\nX$&\nb')
	assert.throws(() => replaceChunks('#include <x>', { y: '' }), /#include <y>/)
})

test('the terrain patches fit the standard material', () => {
	const params = { shadows: createSceneryShadowSettings() }
	const chunk = new Chunk(256, params, 0, new Vector3(), uniforms, {}, new BufferGeometry())
	const terrain = patch(chunk.material, 'physical')
	assert.match(terrain.fragmentShader, /getSceneryShadow\(vShadowPosition, 0\.0\)/)
	// The coast and the sea rocks share one sea height for the foam lines,
	// whose settings follow the sea type and the sea state; its change across
	// the pixel antialiases their strokes. Every foam thins away with the
	// distance, and beyond its fade neither the foam map nor the lines are read.
	assert.match(terrain.fragmentShader, /vec2 seaFoamFade = getSeaFoamFade\(distanceFromCamera\);/)
	// The higher the airplane, the farther the foam reaches.
	assert.match(terrain.fragmentShader, /float reach = max\(uCamera\.y, 0\.0\) \* uSeaFoamFade\.w;/)
	assert.match(
		terrain.fragmentShader,
		/seaFoamHeight = seaFoamNear \? getSeaFoamHeight\(wPosition\.y, wPosition\.xz\) : wPosition\.y;/,
	)
	assert.match(
		terrain.fragmentShader,
		/if \(seaFoamNear\) \{\s*float onda = getSeaRipple\(seaFoamHeight, seaFoamHeightPixel, wPosition\.xz, seaOceanMask, seaState, groundPixel, seaFoamFade\)/,
	)
	// The sea's ribs drift across themselves over time.
	assert.match(
		terrain.fragmentShader,
		/terrainNormalSampleUv -= seaRippleDrift \* \(uSeaRippleDrift \* uTime\);/,
	)
	// The waves move the sea's vertices, tilt its normals, and stay still
	// under the frozen sea in both stages.
	assert.match(terrain.vertexShader, /mvPosition\.xyz \+= seaOffset;/)
	assert.match(terrain.vertexShader, /vSeaState = getSeaState\(wPosition\.xz\);/)
	assert.match(terrain.fragmentShader, /getSeaIceStill\(wPosition\.y, iceValue\)/)
	// Every component varies its phase and amplitude by simplex noise, so the
	// waves never repeat one lattice of crests: the vertices evaluate it (no
	// texture read there), the fragment reads it interpolated.
	assert.doesNotMatch(terrain.vertexShader, /uNoiseTexture/)
	assert.match(
		terrain.vertexShader,
		/seaWaveNoise = getSeaWaveNoise\(wPosition\.xz, seaOceanMask\);/,
	)
	assert.match(terrain.fragmentShader, /seaStill, groundPixel, vSeaWaveNoise\);/)
	assert.match(terrain.fragmentShader, /wave\.z \* \(dot\(wave\.xy, xz\) \+ shifts\[i\]\)/)
	// The airplane's wake lifts the vertices, looked up only where it lifts
	// them, and adds its slopes and foam to the waves'.
	assert.match(
		terrain.vertexShader,
		/if \(uSeaWakeShape\.x > 0\.0\) \{\s*float seaWakeFade;\s*vec4 seaWake = getSeaWake\(wPosition\.xz, -height, seaWakeFade\);/,
	)
	assert.match(
		terrain.fragmentShader,
		/seaWake = getSeaWake\(wPosition\.xz, -wPosition\.y, seaWakeFade\) \* \(1\.0 - seaStill\);/,
	)
	assert.match(
		terrain.fragmentShader,
		/crestFoam = max\(crestFoam, getSeaWakeFoam\(seaWake, seaWakeFade, wPosition\.xz, groundPixel, seaFoamFade\)\);/,
	)
	assert.match(terrain.fragmentShader, /seaWaves\.slope \+= seaWake\.xy \* uSeaWakeShape\.y;/)
	// The floes ride the waves where they reach under them, without foam.
	assert.match(terrain.fragmentShader, /uSeaFoamColor, crestFoam \* \(1\.0 - seaIce\)\)/)
	assert.match(
		terrain.fragmentShader,
		/bool seaWaveTilt = seaWaves\.amount > 0\.0 \|\| seaWakeFade > 0\.0;/,
	)
	assert.match(terrain.fragmentShader, /if \(seaWaveTilt\) \{\s*vec3 waveN/)
	// Foam lines ride the waves' crests, only within the foam's fade.
	assert.match(terrain.fragmentShader, /if \(seaFoamFade\.x > 0\.0\) \{\s*int crestFoamStyle/)
	assert.match(
		terrain.fragmentShader,
		/getSeaCrestLine\(seaWaves, wPosition\.xz, seaOceanMask, seaState, groundPixel, seaFoamFade\)/,
	)
	// Or breaking foam trailing behind them, from the squeeze of the recent past.
	assert.match(
		terrain.fragmentShader,
		/getSeaBreakingFoam\(seaWaves, wPosition\.xz, seaOceanMask, seaState, groundPixel, seaFoamFade\.x\)/,
	)
	assert.match(terrain.fragmentShader, /waves\.squeezeLag \+= /)
	assert.match(
		terrain.fragmentShader,
		/vec3 waveN = vec3\(seaWaveNormal\.x, - seaWaveNormal\.z, seaWaveNormal\.y\);/,
	)
	assert.match(terrain.fragmentShader, /getCoastRockMask\(biomeXZ\)/)
	// The frozen sea covers the sea, and its sheet keeps the vertex waves still.
	assert.match(terrain.fragmentShader, /seaIce = applySeaIce\(diffuseColor\.rgb, wPosition\.y/)
	// The broad ice field is evaluated per vertex and interpolated.
	assert.match(terrain.vertexShader, /vIceValue = getIceValue\(/)
	assert.match(terrain.vertexShader, /getSeaIceStill\(height, vIceValue\)/)
	assert.match(terrain.fragmentShader, /float iceValue = vIceValue;/)
	// So is the climate, skipped where the ice or the deep ocean covers every
	// triangle around the vertex; the fragment reads it outside them.
	assert.match(
		terrain.vertexShader,
		/vClimateNoise = getClimateNoise\(wPosition\.xz \+ uBiomeOffset\.xy\);/,
	)
	assert.match(terrain.vertexShader, /vOceanValue <= uBiomeOcean\.z \* uBiomeClimate\.w/)
	assert.match(
		terrain.fragmentShader,
		/float climateNoise = iceValue < 0\.0 && !inOcean \? vClimateNoise : 0\.0;/,
	)
	// The separators take the fields' gradients from their screen derivatives,
	// with the exact fields' differences only where those degenerate.
	assert.match(terrain.fragmentShader, /dFdx\(vClimateNoise\)/)
	assert.match(terrain.fragmentShader, /dFdx\(vIceValue\)/)
	assert.match(
		terrain.fragmentShader,
		/if \(!getFieldGradient\(ringDriven \? iceScreen : climateScreen, groundDx, groundDy, gradient\)\)/,
	)
	// The land's purely visual noise samples the baked tile, with the pixel's
	// ground size for its mip level.
	assert.match(terrain.fragmentShader, /uniform sampler2D uNoiseTexture;/)
	assert.match(terrain.fragmentShader, /getTerrainColorShade\(biomeXZ, groundPixel\)/)
	assert.match(terrain.fragmentShader, /biomeVariation = sampleNoiseTile\(biomeXZ \* 0\.001,/)
	assert.doesNotMatch(terrain.fragmentShader, /snoise\(p \+ 71\.3/)
	assert.ok('NOISE_TILE_UV_SCALE' in chunk.material.defines)
	// Without the low-sun settings the march is never compiled.
	assert.ok(!('SUN_OCCLUSION_STEPS' in chunk.material.defines))
})

test('the terrain marches toward a low sun with the preset step count', () => {
	const params = {
		shadows: createSceneryShadowSettings(),
		sunOcclusion: createSunOcclusionSettings(),
	}
	const chunk = new Chunk(256, params, 0, new Vector3(), uniforms, {}, new BufferGeometry())
	const terrain = patch(chunk.material, 'physical')
	assert.equal(chunk.material.defines.SUN_OCCLUSION_STEPS, params.sunOcclusion.steps)
	assert.match(terrain.fragmentShader, /getSunOcclusion\(vShadowPosition, distanceFromCamera,/)
	assert.match(terrain.fragmentShader, /uniform sampler2D uSunOcclusionMap;/)
})

test('the terrain shadow caster draws back faces only and flattens onto the near plane', () => {
	const light = new Vector3(0, 1, 0)
	const material = createTerrainCasterMaterial({ light, offset: 0.5 })
	assert.equal(material.side, BackSide)
	assert.equal(material.colorWrite, false)
	assert.equal(material.uniforms.uShadowCasterLight.value, light)
	assert.equal(material.uniforms.uTerrainCasterOffset.value, 0.5)
	assert.match(material.vertexShader, /world\.xyz -= uShadowCasterLight \* uTerrainCasterOffset;/)
	assert.match(material.vertexShader, /gl_Position\.z = max\(gl_Position\.z, -gl_Position\.w\);/)
})

test('the scenery and cloud impostor patches fit the standard material', () => {
	const scenery = createImpostorMaterial(
		fakeAtlas(SCENERY_IMPOSTORS, createHemiOctViews(IMPOSTOR_FRAMES_DESKTOP, 1)),
		uniforms,
	)
	const sceneryShader = patch(scenery, 'physical')
	assert.match(sceneryShader.fragmentShader, /getSceneryShadow\(impostorShadowPosition/)
	// The bend shared with the aurora (curvature-bend.glsl).
	assert.match(sceneryShader.vertexShader, /void getCurvatureBend\(/)
	assert.match(sceneryShader.vertexShader, /getCurvatureBend\(impostorBase,/)
	// The scenery paints crowns, cacti, and rocks; the palette uniforms always
	// exist.
	assert.ok('SCENERY_PALETTE' in scenery.defines)
	assert.match(sceneryShader.vertexShader, /getSceneryPaletteTints\(/)
	assert.match(sceneryShader.fragmentShader, /uImpostorPaint/)
	// The boats bob with the sea waves; the clouds never compile them.
	assert.ok('SCENERY_SEA_WAVES' in scenery.defines)
	assert.match(
		sceneryShader.vertexShader,
		/getSceneryFloat\(impostorType, impostorBase, aInstanceB\.z/,
	)
	assert.match(sceneryShader.vertexShader, /void getSeaFloatPose\(/)
	// They float on the same varied waves, from simplex noise, and on the
	// airplane's wake.
	assert.match(sceneryShader.vertexShader, /getSeaTypeWaveNoise\(0, xz\)\);/)
	assert.match(sceneryShader.vertexShader, /vec4 wake = getSeaWake\(xz, depth, wakeFade\);/)
	for (const name of ['uImpostorPaint', 'uSceneryPaletteColors', 'uSceneryPaletteWeights']) {
		assert.ok(name in sceneryShader.uniforms, name)
	}
	const wireframe = createImpostorWireframeMaterial(scenery, 0x3fd5ff)
	const wireframeShader = patch(wireframe, 'physical')
	assert.match(wireframeShader.fragmentShader, /uSceneryWireframeColor/)
	assert.ok('uSceneryTrunkColors' in wireframeShader.uniforms)

	const clouds = createImpostorMaterial(
		fakeAtlas(CLOUD_IMPOSTORS, CLOUD_IMPOSTOR_VIEWS),
		uniforms,
		{
			receiveShadows: false,
			ambientScale: { value: 1 },
			translucent: true,
		},
	)
	// Unshadowed: the lighting never calls the shadow lookup.
	const cloudShader = patch(clouds, 'physical')
	assert.doesNotMatch(cloudShader.fragmentShader, /getSceneryShadow\(impostorShadowPosition/)
	// The clouds are painted whole from their own palette.
	assert.ok('SCENERY_PALETTE' in clouds.defines)
	assert.match(cloudShader.vertexShader, /getSceneryPaletteTints\(/)
	assert.match(cloudShader.fragmentShader, /uImpostorPaint/)
	for (const name of ['uImpostorPaint', 'uSceneryPaletteColors', 'uSceneryPaletteNoise']) {
		assert.ok(name in cloudShader.uniforms, name)
	}
	assert.ok(!('SCENERY_SEA_WAVES' in clouds.defines))
	// The clouds carry the light shining through them, and so does their
	// wireframe twin.
	assert.ok('CLOUD_TRANSLUCENCY' in clouds.defines)
	assert.match(cloudShader.fragmentShader, /getCloudTranslucency\(directLight\.color/)
	assert.ok('CLOUD_TRANSLUCENCY' in createImpostorWireframeMaterial(clouds, 0xffffff).defines)
	assert.ok(!('CLOUD_TRANSLUCENCY' in scenery.defines))
})

test('the near scenery and cloud mesh patches fit the standard material', () => {
	const shared = {
		uniforms: { ...uniforms, uSceneryMeshRange: { value: new Vector2() } },
		variation: { amount: { value: [0, 0, 0, 0, 0, 0] }, frequency: { value: 1 } },
		detail: { uDetail: { value: null }, uSceneryDetail: { value: [] } },
		wireframe: createSceneryWireframeSettings(),
	}
	const scenery = new SceneryMeshes({ ...shared, settings: createSceneryMeshSettings() })
	const clouds = new SceneryMeshes({
		...shared,
		settings: createCloudMeshSettings(),
		catalog: CLOUD_IMPOSTORS,
		receiveShadows: false,
		ambientScale: { value: 1 },
		translucent: true,
	})
	assert.ok('CLOUD_TRANSLUCENCY' in clouds.levels[0].material.defines)
	assert.ok(!('CLOUD_TRANSLUCENCY' in scenery.levels[0].material.defines))
	for (const meshes of [scenery, clouds]) {
		for (const level of meshes.levels) {
			const shader = patch(level.material, 'physical')
			assert.ok('uSceneryDetail' in shader.uniforms)
			assert.ok('uSceneryPaletteNoise' in shader.uniforms)
			assert.match(shader.vertexShader, /getSceneryPaletteTints\(sceneryTint, aInstanceB\.z/)
			// The rocks read their biome from the instance tint: no per-vertex field.
			if (meshes === scenery) {
				assert.doesNotMatch(shader.vertexShader, /getIceValue|getClimateNoise/)
				// Boats float and tilt with the waves.
				assert.match(
					shader.vertexShader,
					/getSceneryFloat\(sceneryType, sceneryBase, aInstanceB\.z/,
				)
			}
			patch(level.wireframeMaterial, 'physical')
		}
	}
	// The paint mask reaches the scenery and cloud meshes alike.
	assert.ok(scenery.levels[0].types[0].geometry.getAttribute('paint'))
	assert.ok(clouds.levels[0].types[0].geometry.getAttribute('paint'))
	for (const meshes of [scenery, clouds]) {
		assert.match(patch(meshes.levels[0].material, 'physical').vertexShader, /vSceneryPaint = paint/)
	}
})

test('the trail, propeller, and debug marker patches fit their materials', () => {
	// Plane listens for pointer input on window.
	globalThis.window ??= new EventTarget()
	const params = {
		propeller: { speed: 4 },
		trails: {
			ribbonWidth: 9.6,
			lineWidth: 0.65,
			borderWidth: 0.08,
			outerEdge: { frequency: 1.4, amplitude: 0.47 },
			innerEdge: { frequency: 1.4, amplitude: 0.43 },
			oscillation: { frequency: 0.03, amplitude: 0.3 },
		},
	}
	const model = new Mesh(new BoxGeometry(), new MeshStandardMaterial())
	const plane = new Plane(model, params, new PerspectiveCamera(), AIRPLANE_MODELS.biplane)
	assert.match(patch(plane.trails.material, 'basic').fragmentShader, /uTrailTint/)
	assert.match(patch(model.material, 'physical').vertexShader, /rotatePropeller/)

	const markers = new TerrainSampleDebug(uniforms)
	patch(markers.markers[0].material, 'basic')
})

// The aurora is a ShaderMaterial, without replaceChunks() to catch a missing
// declaration: every uniform its shaders declare must reach it.
test('the aurora material supplies every uniform its shaders declare', () => {
	const shared = {
		...uniforms,
		uTime: { value: 0 },
		uAtmosphere: { value: new Color() },
		uBiomeOffset: { value: new Vector4() },
	}
	const aurora = new Aurora({
		uniforms: shared,
		settings: createAuroraSettings(),
		sampleIce: () => -1,
	})
	const { material } = aurora
	for (const source of [material.vertexShader, material.fragmentShader]) {
		for (const [, name] of source.matchAll(/^\s*uniform\s+\w+\s+(\w+)/gm)) {
			assert.ok(name in material.uniforms, name)
		}
	}
	assert.match(material.vertexShader, /getCurvatureBend\(vec3\(groundXZ/)
	assert.ok(material.transparent && !material.depthWrite && !material.fog)
	aurora.dispose()
})

test('the impostor bake shader keeps its detail placeholder', () => {
	const bake = readFileSync(
		new URL('../src/shaders/impostor-bake-fragment.glsl', import.meta.url),
		'utf8',
	)
	assert.ok(bake.includes('#include <scenery_detail_pars_fragment>'))
})

test('the bake and resolve passes write the crown mask as a third target', () => {
	for (const file of ['impostor-bake-fragment.glsl', 'impostor-resolve-fragment.glsl']) {
		const source = readFileSync(new URL(`../src/shaders/${file}`, import.meta.url), 'utf8')
		assert.match(source, /layout\(location = 2\) out vec4 gPaint;/, file)
	}
})

// Every uniform a standalone shader declares must reach its material.
function assertDeclaredUniforms(sources, supplied) {
	for (const source of sources) {
		for (const [, name] of source.matchAll(/^\s*uniform\s+\w+\s+(\w+)/gm)) {
			assert.ok(supplied.has(name), name)
		}
	}
}

test('the lens flare composite and its occlusion pass supply every uniform they declare', () => {
	const sun = { direction: new Vector3(0, 1, 0), color: new Color(), discVisibility: 0 }
	const effect = new LensFlareEffect(new PerspectiveCamera(), createLensFlareSettings(), sun)
	assertDeclaredUniforms([effect.getFragmentShader()], effect.uniforms)
	assert.equal(effect.defines.get('LENS_FLARE_TAPS'), '32')
	const { fullscreenMaterial } = effect.visibilityPass
	assertDeclaredUniforms(
		[fullscreenMaterial.vertexShader, fullscreenMaterial.fragmentShader],
		new Map(Object.entries(fullscreenMaterial.uniforms)),
	)
	// The occlusion pass and the composite share the sun's screen position.
	assert.equal(fullscreenMaterial.uniforms.sunScreen, effect.uniforms.get('sunScreen'))
	effect.dispose()
})

test('the wake step supplies every uniform it declares and writes the readers map', () => {
	const uniforms = createSeaWakeUniforms()
	const wake = new SeaWake({
		renderer: null,
		uniforms,
		settings: createSeaWakeSettings(),
		sampleHeight: () => -10,
	})
	const { material } = wake
	assertDeclaredUniforms(
		[material.vertexShader, material.fragmentShader],
		new Map(Object.entries(material.uniforms)),
	)
	assert.match(material.fragmentShader, /layout\(location = 0\) out vec4 outState;/)
	assert.match(material.fragmentShader, /layout\(location = 1\) out vec4 outSurface;/)
	// The readers sample the second target of the step written last.
	assert.equal(uniforms.uSeaWakeMap.value, wake.targets[0].textures[1])
	assert.equal(wake.targets[0].textures.length, 2)
	// Idle until the airplane flies low over the sea.
	assert.equal(uniforms.uSeaWakeShape.value.w, 0)
	wake.dispose()
})

test('the wake readers declare every shared wake uniform', () => {
	const source = readFileSync(new URL('../src/shaders/sea-wake-pars.glsl', import.meta.url), 'utf8')
	const supplied = new Map(Object.entries(createSeaWakeUniforms()))
	assertDeclaredUniforms([source], supplied)
	const fragment = readFileSync(
		new URL('../src/shaders/sea-ripple-pars-fragment.glsl', import.meta.url),
		'utf8',
	)
	for (const name of ['uSeaWakeFoam', 'uSeaWakeLines']) {
		assert.match(fragment, new RegExp(`uniform vec4 ${name};`))
		assert.ok(supplied.has(name), name)
	}
})

test('the low-sun height map caster supplies every uniform it declares', () => {
	const occlusion = new SunOcclusion({
		renderer: null,
		uniforms: createSunOcclusionUniforms(),
		settings: createSunOcclusionSettings(),
	})
	const { material } = occlusion
	assertDeclaredUniforms(
		[material.vertexShader, material.fragmentShader],
		new Map(Object.entries(material.uniforms)),
	)
	assert.match(material.defines.SUN_OCCLUSION_HEIGHT_BASE, /^\(-?\d+\.\d\)$/)
	assert.equal(occlusion.uniforms.uSunOcclusionMap.value, occlusion.target.texture)
	occlusion.dispose()
})
