import assert from 'node:assert/strict'
import test from 'node:test'
import {
	FLAT_TERRAIN_NORMAL,
	TERRAIN_NORMAL_FADE,
	TERRAIN_NORMAL_LAYERS,
	TERRAIN_NORMAL_TEXTURES,
	createTerrainNormalSettings,
	createTerrainNormalUniforms,
	updateTerrainNormalUniforms,
} from '../src/terrainNormals.js'
import { TERRAIN_BANDS } from '../src/terrainBands.js'

test('every band uses a known texture, KTX2 encoded', () => {
	for (const band of TERRAIN_BANDS) {
		const layer = TERRAIN_NORMAL_LAYERS[band]
		assert.ok(TERRAIN_NORMAL_TEXTURES[layer.texture], `${band}: ${layer.texture}`)
	}
	for (const { src } of Object.values(TERRAIN_NORMAL_TEXTURES)) assert.match(src, /\.ktx2$/)
})

test('settings are fresh copies of the defaults', () => {
	const settings = createTerrainNormalSettings()
	settings.sand.scale = 99
	settings.fade.start = 1
	assert.notEqual(TERRAIN_NORMAL_LAYERS.sand.scale, 99)
	assert.equal(TERRAIN_NORMAL_FADE.start, 150)
	assert.equal(createTerrainNormalSettings().sand.scale, TERRAIN_NORMAL_LAYERS.sand.scale)
})

test('uniforms start flat and follow the settings per band', () => {
	const settings = createTerrainNormalSettings()
	const uniforms = createTerrainNormalUniforms(settings)
	assert.ok(uniforms.uTerrainNormalMaps.value.every((map) => map === FLAT_TERRAIN_NORMAL))
	TERRAIN_BANDS.forEach((band, index) => {
		const layer = settings[band]
		const green = TERRAIN_NORMAL_TEXTURES[layer.texture].invertGreen ? -1 : 1
		assert.equal(uniforms.uTerrainNormalScale.value[index], layer.scale)
		assert.deepEqual(uniforms.uTerrainNormalStrength.value[index].toArray(), [
			layer.strength,
			layer.strength * green,
		])
		const angle = (layer.rotation * Math.PI) / 180
		assert.ok(Math.abs(uniforms.uTerrainNormalRotation.value[index].x - Math.cos(angle)) < 1e-9)
		assert.ok(Math.abs(uniforms.uTerrainNormalRotation.value[index].y - Math.sin(angle)) < 1e-9)
	})
})

test('updates keep the fade ordered and the tile size positive', () => {
	const settings = createTerrainNormalSettings()
	const uniforms = createTerrainNormalUniforms(settings)
	settings.fade.start = 300
	settings.fade.end = 100
	settings.sea.scale = 0
	settings.sea.texture = 'fabric'
	updateTerrainNormalUniforms(uniforms, settings)
	assert.deepEqual(uniforms.uTerrainNormalFade.value.toArray(), [300, 301])
	assert.ok(uniforms.uTerrainNormalScale.value[0] > 0)
	// The fabric map does not follow the OpenGL convention: Y is flipped.
	assert.ok(uniforms.uTerrainNormalStrength.value[0].y < 0)
})
