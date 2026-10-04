// Applies every onBeforeCompile patch to the raw shaders of the installed
// three.js (ShaderLib, as three hands them to onBeforeCompile), so an upgrade
// that renames or drops a chunk fails here instead of in the browser.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
	BoxGeometry,
	BufferGeometry,
	Mesh,
	MeshStandardMaterial,
	PerspectiveCamera,
	ShaderLib,
	Vector2,
	Vector3,
} from 'three'
import Chunk from '../src/chunk.js'
import Plane from '../src/plane.js'
import TerrainSampleDebug from '../src/terrainSampleDebug.js'
import { AIRPLANE_MODELS } from '../src/airplaneModels.js'
import { replaceChunks } from '../src/shaderChunks.js'
import { createSceneryShadowSettings } from '../src/shadowPolicy.js'
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

test('the terrain and boat patches fit the standard material', () => {
	const params = { shadows: createSceneryShadowSettings() }
	const chunk = new Chunk(
		256,
		null,
		params,
		0,
		new Vector3(),
		uniforms,
		{},
		undefined,
		new BufferGeometry(),
	)
	const terrain = patch(chunk.material, 'physical')
	assert.match(terrain.fragmentShader, /getSceneryShadow\(vShadowPosition, 0\.0\)/)

	chunk.boat = new Mesh(new BoxGeometry(), new MeshStandardMaterial())
	const boat = chunk.createBoat(0, 0)
	assert.match(patch(boat.material, 'physical').vertexShader, /attribute float height;/)
})

test('the scenery and cloud impostor patches fit the standard material', () => {
	const scenery = createImpostorMaterial(
		fakeAtlas(SCENERY_IMPOSTORS, createHemiOctViews(IMPOSTOR_FRAMES_DESKTOP, 1)),
		uniforms,
	)
	const sceneryShader = patch(scenery, 'physical')
	assert.match(sceneryShader.fragmentShader, /getSceneryShadow\(impostorShadowPosition/)
	// Only the scenery paints crowns; the palette uniforms always exist.
	assert.ok('SCENERY_PALETTE' in scenery.defines)
	assert.match(sceneryShader.vertexShader, /getSceneryPaletteTints\(/)
	assert.match(sceneryShader.fragmentShader, /uImpostorPaint/)
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
