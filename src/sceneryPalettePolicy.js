import { IMPOSTOR_TYPE } from './impostors/impostorTypes.js'

// Color palettes of the painted scenery types: the trees' crowns and the whole
// cacti. Their sources are baked in a neutral gray with a paint mask
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
// share one palette and its noise fields, so a region paints them alike.
export const SCENERY_PALETTE_TYPES = Object.freeze({
	[IMPOSTOR_TYPE.ROUND_TREE]: Object.freeze({ palette: 'roundTree', group: 'trees' }),
	[IMPOSTOR_TYPE.CONIFER]: Object.freeze({ palette: 'conifer', group: 'trees' }),
	[IMPOSTOR_TYPE.CACTUS_ONE_ARM]: Object.freeze({ palette: 'cactus', group: 'cacti' }),
	[IMPOSTOR_TYPE.CACTUS_TWO_ARMS]: Object.freeze({ palette: 'cactus', group: 'cacti' }),
})

export const SCENERY_PAINTED_TYPES = Object.freeze(Object.keys(SCENERY_PALETTE_TYPES).map(Number))

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
// slot); tree palettes also have a `trunk` color. Cacti are painted whole.
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
		},
	}
}

// Flattens `settings` into the shader layout for `typeCount` types:
// colors[type * SCENERY_PALETTE_SIZE + slot] and trunks[type] are hex strings,
// or null for white (unpainted types, unused slots, the cacti's trunks);
// weights follows colors; noise[type] is [frequency, mix, palette index].
// Painted types always keep a positive total weight (slot 0 when every weight
// is 0) and fall back to the defaults for any palette or noise group
// `settings` lacks.
export function getSceneryPaletteLayout(settings, typeCount) {
	const colors = new Array(typeCount * SCENERY_PALETTE_SIZE).fill(null)
	const weights = new Array(typeCount * SCENERY_PALETTE_SIZE).fill(0)
	const trunks = new Array(typeCount).fill(null)
	const noise = Array.from({ length: typeCount }, () => [0, 0, 0])
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
		]
	}

	return { colors, weights, trunks, noise }
}
