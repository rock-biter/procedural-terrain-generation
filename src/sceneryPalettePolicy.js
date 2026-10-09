import { IMPOSTOR_TYPE } from './impostors/impostorTypes.js'
import { BIOME } from './terrainBands.js'

// Color palettes of the painted scenery types: the trees' crowns, the whole
// cacti, the whole rocks (boulders, layered rocks, and sea rocks), and the
// whole ice spikes. Their sources are baked in a neutral gray with a paint mask
// (src/impostors/impostorArchetypes.js), and the shaders pick one palette
// color per instance from world-space noise (getSceneryPaletteTints() in
// scenery-instance-pars-vertex.glsl): every slot has its own noise field, and
// its weight sets its share. A tree's trunk keeps one color per type.
// Everything here is applied live through uniforms (src/sceneryImpostors.js):
// no re-bake and no placement job.

// Slots per palette. The shader packs the weights of a type in one vec4, so
// this cannot exceed 4; it reaches GLSL as a catalog define.
export const SCENERY_PALETTE_SIZE = 4

// Linear gray the painted types are baked in, painted and unpainted parts
// alike. Below white, so the normalized wood grain (which brightens above 1)
// never clips in the 8-bit atlas; the uniforms divide the palette colors by it.
export const SCENERY_PAINT_BASE = 0.5

// Each painted type's palette (a key of settings.palettes) and noise group (a
// key of settings.noise, named like SCENERY_CATEGORIES). Both cactus types
// share one palette and its noise fields, so a region paints them alike. The
// palette indices select the noise fields, so new noise palettes go last; the
// rocks pick their colors by biome and read no noise.
export const SCENERY_PALETTE_TYPES = Object.freeze({
	[IMPOSTOR_TYPE.ROUND_TREE]: Object.freeze({ palette: 'roundTree', group: 'trees' }),
	[IMPOSTOR_TYPE.CONIFER]: Object.freeze({ palette: 'conifer', group: 'trees' }),
	[IMPOSTOR_TYPE.CACTUS_ONE_ARM]: Object.freeze({ palette: 'cactus', group: 'cacti' }),
	[IMPOSTOR_TYPE.CACTUS_TWO_ARMS]: Object.freeze({ palette: 'cactus', group: 'cacti' }),
	[IMPOSTOR_TYPE.BOULDER]: Object.freeze({ palette: 'boulder', group: 'rocks' }),
	[IMPOSTOR_TYPE.LAYERED_ROCK]: Object.freeze({ palette: 'layeredRock', group: 'rocks' }),
	[IMPOSTOR_TYPE.SEA_ROCK]: Object.freeze({ palette: 'seaRock', group: 'seaRocks' }),
	[IMPOSTOR_TYPE.ICE_SPIKES_TWO]: Object.freeze({ palette: 'iceSpike', group: 'iceSpikes' }),
	[IMPOSTOR_TYPE.ICE_SPIKES_THREE]: Object.freeze({ palette: 'iceSpike', group: 'iceSpikes' }),
})

export const SCENERY_PAINTED_TYPES = Object.freeze(Object.keys(SCENERY_PALETTE_TYPES).map(Number))

// Slot of each biome (src/biome.js) in the palettes picked by biome. Placement
// stores it in the blue byte of every painted instance's tint (painted types
// vary in brightness only), so the shaders read the biome instead of
// evaluating it per vertex.
export const SCENERY_BIOME_SLOTS = Object.freeze({
	[BIOME.TEMPERATE]: 0,
	[BIOME.DESERT]: 1,
	[BIOME.ICE]: 2,
})

// Every palette once, in type order. A palette's index here selects its noise
// fields in the shader.
export const SCENERY_PALETTE_KEYS = Object.freeze([
	...new Set(Object.values(SCENERY_PALETTE_TYPES).map(({ palette }) => palette)),
])

// Settings edited by the debug GUI. `noise` holds, per group, the patch noise
// `frequency` per world unit and `mix`, the share of a random pick per
// instance (0 noise patches only, 1 every instance random). `palettes` holds
// the colors: sRGB hex strings, labels that name them in the panel, and
// weights that are relative shares (only their ratios matter, 0 disables a
// slot); tree palettes also have a `trunk` color. Cacti and sea rocks are
// painted whole. A palette with `byBiome` ignores the noise and the weights:
// its colors paint the temperate biome, the desert, and the ice, in that
// order, as the terrain colors them.
export function createSceneryPaletteSettings() {
	return {
		noise: {
			trees: { frequency: 0.05, mix: 0.9 },
			cacti: { frequency: 0.05, mix: 0.9 },
		},
		palettes: {
			roundTree: {
				trunk: '#7a4a2a',
				colors: [
					{ label: 'Light wood', color: '#b88347', weight: 1 },
					{ label: 'Light green wood', color: '#a4ad38', weight: 1 },
					{ label: 'Orange wood', color: '#ff674d', weight: 1 },
					{ label: 'Dark brown wood', color: '#257960', weight: 1 },
				],
			},
			conifer: {
				trunk: '#5e3a22',
				colors: [
					{ label: 'Dark wood', color: '#2e856f', weight: 1 },
					{ label: 'Dark green wood', color: '#5a731c', weight: 1 },
					{ label: 'Bluish green wood', color: '#105c70', weight: 1 },
				],
			},
			cactus: {
				colors: [
					{ label: 'Brown wood', color: '#8f5f3a', weight: 1 },
					{ label: 'Light green wood', color: '#b8cc93', weight: 1 },
					{ label: 'Yellow wood', color: '#ee9577', weight: 1 },
				],
			},
			// The boulders and layered rocks of the forest and the desert keep their
			// former wood tones; the ice frosts its boulders (layered rocks stand
			// only in the desert, so their ice color is unused).
			boulder: {
				byBiome: true,
				colors: [
					{ label: 'Forest', color: '#c7b18e', weight: 1 },
					{ label: 'Desert', color: '#deb583', weight: 1 },
					{ label: 'Ice', color: '#d3e2ec', weight: 1 },
				],
			},
			layeredRock: {
				byBiome: true,
				colors: [
					{ label: 'Forest', color: '#e3c9a0', weight: 1 },
					{ label: 'Desert', color: '#e3c9a0', weight: 1 },
					{ label: 'Ice', color: '#dce8f0', weight: 1 },
				],
			},
			seaRock: {
				byBiome: true,
				colors: [
					{ label: 'Forest', color: '#5f3b2b', weight: 1 },
					{ label: 'Desert', color: '#e27865', weight: 1 },
					{ label: 'Ice', color: '#8fa9bd', weight: 1 },
				],
			},
			// Both ice spike types; they stand only in the ice, so the forest and
			// desert slots repeat its color.
			iceSpike: {
				byBiome: true,
				colors: [
					{ label: 'Forest', color: '#c6ecfa', weight: 1 },
					{ label: 'Desert', color: '#c6ecfa', weight: 1 },
					{ label: 'Ice', color: '#c6ecfa', weight: 1 },
				],
			},
		},
	}
}

// Flattens `settings` into the shader layout for `typeCount` types:
// colors[type * SCENERY_PALETTE_SIZE + slot] and trunks[type] are hex strings,
// or null for white (unpainted types, unused slots, the cacti's trunks);
// weights follows colors; noise[type] is [frequency, mix, palette index, by
// biome (1) or by noise (0)].
// Painted types always keep a positive total weight (slot 0 when every weight
// is 0) and fall back to the defaults for any palette or noise group
// `settings` lacks.
export function getSceneryPaletteLayout(settings, typeCount) {
	const colors = new Array(typeCount * SCENERY_PALETTE_SIZE).fill(null)
	const weights = new Array(typeCount * SCENERY_PALETTE_SIZE).fill(0)
	const trunks = new Array(typeCount).fill(null)
	const noise = Array.from({ length: typeCount }, () => [0, 0, 0, 0])
	const defaults = createSceneryPaletteSettings()

	for (const type of SCENERY_PAINTED_TYPES) {
		if (type >= typeCount) continue
		const { palette: key, group } = SCENERY_PALETTE_TYPES[type]
		const palette = settings?.palettes?.[key] ?? defaults.palettes[key]
		const offset = type * SCENERY_PALETTE_SIZE
		trunks[type] = palette.trunk ?? null
		let total = 0
		for (let slot = 0; slot < SCENERY_PALETTE_SIZE; slot++) {
			const entry = palette.colors?.[slot]
			if (!entry) continue
			const weight = Math.max(0, Number(entry.weight) || 0)
			colors[offset + slot] = entry.color ?? null
			weights[offset + slot] = weight
			total += weight
		}
		if (total === 0) weights[offset] = 1

		const { frequency, mix } = { ...defaults.noise[group], ...settings?.noise?.[group] }
		noise[type] = [
			Math.max(0, Number(frequency) || 0),
			Math.min(Math.max(Number(mix) || 0, 0), 1),
			SCENERY_PALETTE_KEYS.indexOf(key),
			palette.byBiome ? 1 : 0,
		]
	}

	return { colors, weights, trunks, noise }
}
