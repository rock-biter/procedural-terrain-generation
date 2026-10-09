import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
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
	'terrain-bands-pars.glsl',
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
