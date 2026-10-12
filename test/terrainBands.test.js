import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { Vector3 } from 'three'
import { updateTerrainLineUniforms } from '../src/sharedUniforms.js'
import {
	BIOME,
	BIOME_CLIMATE_LAYERS,
	BIOME_COUNT,
	BIOME_ICE_LAYERS,
	BIOME_OCEAN_LAYERS,
	BIOME_SHADER_DEFINES,
	getTerrainBand,
	SAND_LEVEL,
	TERRAIN_BAND,
	TERRAIN_BANDS,
	TERRAIN_HEIGHT_BANDS,
	TERRAIN_SHADER_DEFINES,
} from '../src/terrainBands.js'

const shader = (name) => readFileSync(new URL(`../src/shaders/${name}`, import.meta.url), 'utf8')
const code = (name) => shader(name).replace(/\/\/.*$/gm, '')
const terrainShaders = [
	'biome-value.glsl',
	'terrain-band-height.glsl',
	'terrain-bands-pars.glsl',
	'terrain-pars-vertex.glsl',
	'color-fragment.glsl',
	'terrain-normal-pars.glsl',
	'sea-ice-pars.glsl',
	'sea-ice-pars-fragment.glsl',
	'sea-surface-pars.glsl',
	'sea-ripple-pars-fragment.glsl',
	'normal-fragment-map.glsl',
	'project-vertex.glsl',
]

test('the material defines every band and biome constant the terrain shaders read', () => {
	// Constants a shader file defines for the files that include it.
	const local = new Set(
		terrainShaders.flatMap((name) =>
			[...code(name).matchAll(/#define\s+(\w+)/g)].map((match) => match[1]),
		),
	)
	for (const name of terrainShaders) {
		const source = code(name)
		const used = source.match(/\b(?:TERRAIN|BIOME|COAST_ROCK|SEA_ICE)_[A-Z0-9_]+\b/g) ?? []
		for (const identifier of used) {
			if (local.has(identifier)) continue
			assert.ok(identifier in TERRAIN_SHADER_DEFINES, `${name} reads undefined ${identifier}`)
		}
	}
})

test('defines are GLSL literals', () => {
	const float = '-?\\d+\\.\\d*(?:e-?\\d+)?'
	for (const [name, value] of Object.entries(TERRAIN_SHADER_DEFINES)) {
		if (/^TERRAIN_BAND_|_COUNT$|^BIOME_(?:DESERT|TEMPERATE|ICE|DEEP_OCEAN)$/.test(name)) {
			assert.match(value, /^\d+$/, name)
		} else if (
			/_WAVE$|^BIOME_(?:CLIMATE|ICE|OCEAN)_LAYER_|^COAST_ROCK_(?:LAYER_|OFFSET$)/.test(name)
		)
			assert.match(value, new RegExp(`^vec2\\(${float}, ${float}\\)$`), name)
		else assert.match(value, new RegExp(`^${float}$`), name)
	}
})

test('the biome ids reach the shaders as defines', () => {
	assert.equal(BIOME_COUNT, 4)
	for (const [name, id] of Object.entries(BIOME)) {
		assert.equal(BIOME_SHADER_DEFINES[`BIOME_${name}`], String(id))
		assert.equal(TERRAIN_SHADER_DEFINES[`BIOME_${name}`], String(id))
	}
	assert.equal(TERRAIN_SHADER_DEFINES.TERRAIN_PALETTE_BAND_COUNT, String(TERRAIN_BANDS.length - 1))
})

test('the shaders sum every biome layer and sample every band layer', () => {
	const biome = shader('biome-value.glsl')
	assert.match(shader('terrain-bands-pars.glsl'), /#include \.\/biome-value\.glsl/)
	assert.match(shader('terrain-pars-vertex.glsl'), /#include \.\/biome-value\.glsl/)
	for (const [prefix, layers] of [
		['BIOME_CLIMATE_LAYER', BIOME_CLIMATE_LAYERS],
		['BIOME_ICE_LAYER', BIOME_ICE_LAYERS],
		['BIOME_OCEAN_LAYER', BIOME_OCEAN_LAYERS],
	]) {
		layers.forEach((_, index) => assert.match(biome, new RegExp(`${prefix}_${index}\\b`)))
		assert.doesNotMatch(biome, new RegExp(`${prefix}_${layers.length}\\b`))
	}
	// GLSL indexes sampler arrays only with constants, hence a fixed chain.
	const normals = shader('terrain-normal-pars.glsl')
	const sampled = [...normals.matchAll(/uTerrainNormalMaps\[(\d)\]/g)].map((match) => +match[1])
	assert.deepEqual([...new Set(sampled)].sort(), [...TERRAIN_BANDS.keys()])
	// The biome fields left the shared common chunk with their constants.
	assert.doesNotMatch(shader('common.glsl'), /getClimateNoise|getIceValue/)
	// The terrain's pixels read them from the vertices; only the separators'
	// fallback gradients sample the exact fields.
	assert.doesNotMatch(code('color-fragment.glsl'), /getClimateNoise\(|getIceValue\(/)
	assert.match(code('terrain-bands-pars.glsl'), /vec2 getClimateGradient\(vec2 biomeXZ\)/)
})

test('both terrain stages share the band height and the fragment antialiases every band', () => {
	assert.match(shader('terrain-bands-pars.glsl'), /#include \.\/terrain-band-height\.glsl/)
	assert.match(shader('terrain-pars-vertex.glsl'), /#include \.\/terrain-band-height\.glsl/)
	assert.match(
		code('terrain-band-height.glsl'),
		/float getTerrainBandHeight\(vec3 position, vec2 wave\)/,
	)
	const vertex = code('project-vertex.glsl')
	const fragment = code('color-fragment.glsl')
	for (const name of Object.keys(TERRAIN_HEIGHT_BANDS)) {
		const key = name.toUpperCase()
		assert.match(vertex, new RegExp(`getTerrainBandHeight\\(bandPosition, TERRAIN_${key}_WAVE\\)`))
		assert.match(
			fragment,
			new RegExp(`getTerrainBandBorder\\([^;]*TERRAIN_${key}_LINE, TERRAIN_${key}_LEVEL`),
		)
	}
	assert.doesNotMatch(fragment, /\bstep\(bandHeight/)
})

test('the ink line fade keeps its smoothstep() edges ordered and the blur at one pixel or more', () => {
	const uniforms = { uTerrainLines: { value: new Vector3() } }
	updateTerrainLineUniforms(uniforms, { fadeStart: 150, fadeEnd: 600, blur: 3 })
	assert.deepEqual(uniforms.uTerrainLines.value.toArray(), [150, 600, 3])
	updateTerrainLineUniforms(uniforms, { fadeStart: 700, fadeEnd: 600, blur: 0.5 })
	assert.deepEqual(uniforms.uTerrainLines.value.toArray(), [700, 701, 1])
	updateTerrainLineUniforms(uniforms, { fadeStart: -10, fadeEnd: 0, blur: 2 })
	assert.deepEqual(uniforms.uTerrainLines.value.toArray(), [0, 1, 2])
})

test('bands follow the height, the waves, and the shader priority', () => {
	assert.equal(getTerrainBand(0, -5, 0), TERRAIN_BAND.sea)
	assert.equal(getTerrainBand(0, SAND_LEVEL, 0), TERRAIN_BAND.sea)
	assert.equal(getTerrainBand(0, SAND_LEVEL + 0.01, 0), TERRAIN_BAND.sand)
	// At x = z = 0 every wave adds its amplitude (cos 0 = 1, sin 0 = 0).
	for (const [name, { amplitude, level }] of Object.entries(TERRAIN_HEIGHT_BANDS)) {
		const border = level - amplitude
		assert.equal(getTerrainBand(0, border + 0.01, 0), TERRAIN_BAND[name], name)
		assert.equal(getTerrainBand(0, border - 0.01, 0), TERRAIN_BAND[name] - 1, name)
	}
	// The grass border moves with its wave: lower where the wave is high.
	const { frequency, amplitude, level } = TERRAIN_HEIGHT_BANDS.grass
	const crest = Math.PI / 2 / frequency
	const y = level - amplitude * 1.5
	assert.equal(getTerrainBand(crest, y, 0), TERRAIN_BAND.grass)
	assert.equal(getTerrainBand(-crest, y, 0), TERRAIN_BAND.sand)
	assert.equal(getTerrainBand(0, 1000, 0), TERRAIN_BAND.snow)
})
