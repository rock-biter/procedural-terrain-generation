import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
	BIOME_NOISE_LAYERS,
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
]

test('the material defines every band and biome constant the terrain shaders read', () => {
	for (const name of terrainShaders) {
		const source = code(name)
		const local = new Set([...source.matchAll(/#define\s+(\w+)/g)].map((match) => match[1]))
		const used = source.match(/\b(?:TERRAIN|BIOME_NOISE|COAST_ROCK)_[A-Z0-9_]+\b/g) ?? []
		for (const identifier of used) {
			if (local.has(identifier)) continue
			assert.ok(identifier in TERRAIN_SHADER_DEFINES, `${name} reads undefined ${identifier}`)
		}
	}
})

test('defines are GLSL literals', () => {
	const float = '-?\\d+\\.\\d*(?:e-?\\d+)?'
	for (const [name, value] of Object.entries(TERRAIN_SHADER_DEFINES)) {
		if (/^TERRAIN_BAND_/.test(name)) assert.match(value, /^\d+$/, name)
		else if (/_WAVE$|^BIOME_NOISE_LAYER_|^COAST_ROCK_(?:LAYER_|OFFSET$)/.test(name))
			assert.match(value, new RegExp(`^vec2\\(${float}, ${float}\\)$`), name)
		else assert.match(value, new RegExp(`^${float}$`), name)
	}
})

test('the shaders sum every biome layer and sample every band layer', () => {
	const biome = shader('biome-value.glsl')
	assert.match(shader('terrain-bands-pars.glsl'), /#include \.\/biome-value\.glsl/)
	BIOME_NOISE_LAYERS.forEach((_, index) =>
		assert.match(biome, new RegExp(`BIOME_NOISE_LAYER_${index}\\b`)),
	)
	assert.doesNotMatch(biome, new RegExp(`BIOME_NOISE_LAYER_${BIOME_NOISE_LAYERS.length}\\b`))
	// GLSL indexes sampler arrays only with constants, hence a fixed chain.
	const normals = shader('terrain-normal-pars.glsl')
	const sampled = [...normals.matchAll(/uTerrainNormalMaps\[(\d)\]/g)].map((match) => +match[1])
	assert.deepEqual([...new Set(sampled)].sort(), [...TERRAIN_BANDS.keys()])
	// The biome field left the shared common chunk with its constants.
	assert.doesNotMatch(shader('common.glsl'), /getBiomeValue/)
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
