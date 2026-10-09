import assert from 'node:assert/strict'
import test from 'node:test'
import { Color, LinearSRGBColorSpace, Vector3, Vector4 } from 'three'
import { BIOME, BIOME_COUNT } from '../src/biome.js'
import { createAppParams } from '../src/appParams.js'
import {
	createSharedUniforms,
	updateBiomeUniforms,
	updateSeaIceUniforms,
	updateTerrainPaletteUniforms,
} from '../src/sharedUniforms.js'
import {
	createTerrainPaletteSettings,
	getTerrainPaletteLayout,
	TERRAIN_PALETTE_BANDS,
	TERRAIN_PALETTE_BIOMES,
	TERRAIN_SEA_COLORS,
} from '../src/terrainPalettePolicy.js'
import { createBiomeSettings, getBiomeGradientBounds } from '../src/biome.js'
import { createSeaIceSettings } from '../src/seaIcePolicy.js'

const HEX = /^#[0-9a-f]{6}$/

test('every biome colors every land band with valid sRGB hex', () => {
	const settings = createTerrainPaletteSettings()
	assert.deepEqual(Object.values(TERRAIN_PALETTE_BIOMES).sort(), ['desert', 'ice', 'temperate'])
	for (const key of Object.values(TERRAIN_PALETTE_BIOMES)) {
		for (const band of TERRAIN_PALETTE_BANDS) {
			assert.match(settings[key].colors[band], HEX, `${key} ${band}`)
			assert.match(settings[key].variation[band].color, HEX, `${key} ${band} variation`)
		}
	}
	for (const name of TERRAIN_SEA_COLORS) assert.match(settings.sea[name], HEX, name)
})

// The former shader constants, linear RGB.
const FORMER = {
	temperate: { sand: [0.9, 0.8, 0.5], snow: [0.4, 0.8, 0.9] },
	desert: {
		sand: [0.92, 0.72, 0.42],
		grass: [0.76, 0.48, 0.2],
		land: [0.68, 0.3, 0.1],
		rocks: [0.35, 0.16, 0.07],
		snow: [0.18, 0.08, 0.035],
	},
	variation: { grass: [0.33, 0.2, 0], land: [0.1, 0.25, 0.1], rocks: [0.01, 0, 0.01] },
}

function assertLinear(hex, expected, label) {
	const color = new Color(hex)
	const actual = [color.r, color.g, color.b]
	actual.forEach((value, index) =>
		assert.ok(Math.abs(value - expected[index]) < 4e-3, `${label}: ${actual} vs ${expected}`),
	)
}

test('the forest and desert keep the former shader colors', () => {
	const settings = createTerrainPaletteSettings()
	for (const [band, rgb] of Object.entries(FORMER.temperate)) {
		assertLinear(settings.temperate.colors[band], rgb, `forest ${band}`)
	}
	for (const [band, rgb] of Object.entries(FORMER.desert)) {
		assertLinear(settings.desert.colors[band], rgb, `desert ${band}`)
	}
	// The forest's variation: grass and land halfway, rocks fully.
	for (const [band, rgb] of Object.entries(FORMER.variation)) {
		assertLinear(settings.temperate.variation[band].color, rgb, `variation ${band}`)
	}
	assert.equal(settings.temperate.variation.grass.amount, 0.5)
	assert.equal(settings.temperate.variation.land.amount, 0.5)
	assert.equal(settings.temperate.variation.rocks.amount, 1)
	assert.equal(settings.temperate.variation.sand.amount, 0)
	// The former temperate uniforms.
	assert.equal(settings.temperate.colors.grass, '#6d976d')
	assert.equal(settings.temperate.colors.land, '#455f0c')
	assert.equal(settings.temperate.colors.rocks, '#b66635')
})

test('lays the palettes out by biome id and band, in shader order', () => {
	const settings = createTerrainPaletteSettings()
	settings.ice.colors.rocks = '#123456'
	settings.desert.variation.land = { color: '#abcdef', amount: -1 }
	settings.ice.colorNoise = 0.5
	const { colors, variations, styles, sea } = getTerrainPaletteLayout(settings)
	const bands = TERRAIN_PALETTE_BANDS.length
	assert.equal(colors.length, BIOME_COUNT * bands)
	assert.equal(colors[BIOME.ICE * bands + TERRAIN_PALETTE_BANDS.indexOf('rocks')], '#123456')
	const land = variations[BIOME.DESERT * bands + TERRAIN_PALETTE_BANDS.indexOf('land')]
	// Negative amounts clamp to none.
	assert.deepEqual(land, { color: '#abcdef', amount: 0 })
	// Only the forest varies by default.
	assert.deepEqual(
		styles.map(([, , varies]) => varies),
		[0, 1, 0],
	)
	assert.equal(styles[BIOME.ICE][0], 0.5)
	assert.deepEqual(sea, [settings.sea.shallow, settings.sea.mid, settings.sea.deep])
	// Missing entries fall back to the defaults.
	assert.deepEqual(
		getTerrainPaletteLayout({}),
		getTerrainPaletteLayout(createTerrainPaletteSettings()),
	)
})

test('the uniforms mirror the palette, biome, and sea ice settings', () => {
	const params = createAppParams({ urlParams: new URLSearchParams(), isMobile: false })
	const uniforms = createSharedUniforms(params, 'uniforms')
	assert.ok(uniforms.uBiomeOffset.value instanceof Vector4)

	const palette = createTerrainPaletteSettings()
	palette.temperate.colors.grass = '#ff0000'
	updateTerrainPaletteUniforms(uniforms, palette)
	const grass = uniforms.uTerrainColors.value[BIOME.TEMPERATE * 5 + 1]
	assert.deepEqual([grass.r, grass.g, grass.b], [1, 0, 0])
	const rocks = uniforms.uTerrainVariations.value[BIOME.TEMPERATE * 5 + 3]
	assert.equal(rocks.w, 1)
	const linear = new Color().setRGB(0.01, 0, 0.01, LinearSRGBColorSpace)
	assert.ok(Math.abs(rocks.x - linear.r) < 4e-3)
	assert.ok(uniforms.uTerrainStyles.value[BIOME.ICE] instanceof Vector3)

	const biomes = { ...createBiomeSettings(), size: 2, iceSize: 4 }
	updateBiomeUniforms(uniforms, biomes)
	const bounds = getBiomeGradientBounds(biomes)
	assert.deepEqual(uniforms.uBiomeClimate.value.toArray(), [
		0.5,
		biomes.desertBias,
		bounds.climate,
		0,
	])
	assert.deepEqual(uniforms.uBiomeIce.value.toArray(), [
		0.25,
		biomes.iceThreshold,
		biomes.iceRing,
		bounds.ice,
	])

	const seaIce = { ...createSeaIceSettings(), shelf: 3, cellSize: 9 }
	updateSeaIceUniforms(uniforms, seaIce)
	assert.deepEqual(uniforms.uSeaIceShape.value.toArray(), [3, seaIce.fade, seaIce.band, 9])
	assert.deepEqual(uniforms.uSeaIceEdge.value.toArray(), [
		seaIce.crackMin,
		seaIce.crackMax,
		seaIce.edgeNoise,
		seaIce.edgeFrequency,
	])
})
