import { BIOME, BIOME_COUNT } from './terrainBands.js'

// Terrain colors per biome and of the sea (three-free), edited by the ?gui=1
// Biomes folders and applied live: updateTerrainPaletteUniforms() in
// src/sharedUniforms.js writes getTerrainPaletteLayout() into the uniforms
// color-fragment.glsl reads.
//
// Every biome colors the five land bands of src/terrainBands.js (sand, grass,
// land, rocks, snow). Each band can drift toward a `variation` color by up to
// `amount`, following a slow world-space noise (the forest's grass, land, and
// rocks do). `colorNoise` scales the soft lighter patches
// (params.terrainColorNoise) on the biome, and `lines` the darkness of the ink
// lines below each band border (1 black, 0 none). Colors are sRGB hex strings.

// Land bands in palette order: TERRAIN_BANDS without the sea.
export const TERRAIN_PALETTE_BANDS = Object.freeze(['sand', 'grass', 'land', 'rocks', 'snow'])

// Settings key of each biome, indexed by BIOME id.
export const TERRAIN_PALETTE_BIOMES = Object.freeze({
	[BIOME.DESERT]: 'desert',
	[BIOME.TEMPERATE]: 'temperate',
	[BIOME.ICE]: 'ice',
})

// Sea colors from the shore down: shallow water, open sea (from 6 to 16
// units deep), and deep sea (from 24 to 40).
export const TERRAIN_SEA_COLORS = Object.freeze(['shallow', 'mid', 'deep'])

function variation(color, amount) {
	return { color, amount }
}

// The forest and desert colors reproduce the former shader constants; the ice
// is snow up to the rocks, which turn into blue ice rock and glacier ice.
export function createTerrainPaletteSettings() {
	return {
		temperate: {
			colors: {
				sand: '#f3e7bc',
				grass: '#6d976d',
				land: '#455f0c',
				rocks: '#b66635',
				snow: '#aae7f3',
			},
			variation: {
				sand: variation('#9b7c00', 0),
				grass: variation('#9b7c00', 0.5),
				land: variation('#598959', 0.5),
				rocks: variation('#190019', 1),
				snow: variation('#598959', 0),
			},
			colorNoise: 1,
			lines: 1,
		},
		desert: {
			colors: {
				sand: '#f6ddad',
				grass: '#e2b87c',
				land: '#d79559',
				rocks: '#a06f4b',
				snow: '#765035',
			},
			variation: {
				sand: variation('#9b7c00', 0),
				grass: variation('#9b7c00', 0),
				land: variation('#598959', 0),
				rocks: variation('#190019', 0),
				snow: variation('#190019', 0),
			},
			colorNoise: 1,
			lines: 1,
		},
		ice: {
			colors: {
				sand: '#dfe9ef',
				grass: '#e8f0f4',
				land: '#d4e3ec',
				rocks: '#8ea7ba',
				snow: '#b4dcec',
			},
			variation: {
				sand: variation('#a9c4d6', 0),
				grass: variation('#a9c4d6', 0),
				land: variation('#a9c4d6', 0),
				rocks: variation('#4d6a82', 0),
				snow: variation('#7fc3e0', 0),
			},
			colorNoise: 0.3,
			lines: 1,
		},
		sea: { shallow: '#007ccb', mid: '#0000bc', deep: '#000027' },
	}
}

// The settings in shader order: `colors` and `variations` ({ color, amount })
// at biome * 5 + band, `styles` per biome ([colorNoise, lines, 1 when any
// band varies]), `sea` shallow to deep. Missing entries fall back to the
// defaults.
export function getTerrainPaletteLayout(settings) {
	const defaults = createTerrainPaletteSettings()
	const colors = []
	const variations = []
	const styles = []
	for (let biome = 0; biome < BIOME_COUNT; biome++) {
		const key = TERRAIN_PALETTE_BIOMES[biome]
		const palette = settings?.[key] ?? defaults[key]
		let varies = 0
		for (const band of TERRAIN_PALETTE_BANDS) {
			colors.push(palette.colors?.[band] ?? defaults[key].colors[band])
			const entry = palette.variation?.[band] ?? defaults[key].variation[band]
			const amount = Math.max(0, Number(entry.amount) || 0)
			if (amount > 0) varies = 1
			variations.push({ color: entry.color, amount })
		}
		styles.push([
			Math.max(0, Number(palette.colorNoise ?? 1)),
			Math.max(0, Number(palette.lines ?? 1)),
			varies,
		])
	}
	const sea = TERRAIN_SEA_COLORS.map((name) => settings?.sea?.[name] ?? defaults.sea[name])
	return { colors, variations, styles, sea }
}
