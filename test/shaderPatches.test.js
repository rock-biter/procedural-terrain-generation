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
	// whose settings follow the sea type and the sea state.
	assert.match(
		terrain.fragmentShader,
		/getSeaRipple\(getSeaFoamHeight\(wPosition\.y, wPosition\.xz\), wPosition\.xz, seaOceanMask, seaState\)/,
	)
	// The waves move the sea's vertices, tilt its normals, and stay still
	// under the frozen sea in both stages.
	assert.match(terrain.vertexShader, /mvPosition\.xyz \+= seaOffset;/)
	assert.match(terrain.vertexShader, /vSeaState = getSeaState\(wPosition\.xz\);/)
	assert.match(terrain.fragmentShader, /getSeaIceStill\(wPosition\.y, iceValue\)/)
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
	// Only the scenery paints crowns; the palette uniforms always exist.
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
		},
	)
	// Unshadowed: the lighting never calls the shadow lookup.
	assert.doesNotMatch(
		patch(clouds, 'physical').fragmentShader,
		/getSceneryShadow\(impostorShadowPosition/,
	)
	assert.ok(!('SCENERY_PALETTE' in clouds.defines))
	assert.ok(!('SCENERY_SEA_WAVES' in clouds.defines))
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
	})
	for (const meshes of [scenery, clouds]) {
		for (const level of meshes.levels) {
			const shader = patch(level.material, 'physical')
			assert.ok('uSceneryDetail' in shader.uniforms)
			assert.ok('uSceneryPaletteNoise' in shader.uniforms)
			// The rocks read their biome from the instance tint: no per-vertex field.
			if (meshes === scenery) {
				assert.doesNotMatch(shader.vertexShader, /getIceValue|getClimateNoise/)
				assert.match(shader.vertexShader, /getSceneryPaletteTints\(sceneryTint, aInstanceB\.z/)
				// Boats float and tilt with the waves.
				assert.match(
					shader.vertexShader,
					/getSceneryFloat\(sceneryType, sceneryBase, aInstanceB\.z/,
				)
			}
			patch(level.wireframeMaterial, 'physical')
		}
	}
	// The crown mask reaches the scenery meshes only; cloud sources have none.
	assert.ok(scenery.levels[0].types[0].geometry.getAttribute('paint'))
	assert.equal(clouds.levels[0].types[0].geometry.getAttribute('paint'), undefined)
	assert.match(patch(scenery.levels[0].material, 'physical').vertexShader, /vSceneryPaint = paint/)
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
