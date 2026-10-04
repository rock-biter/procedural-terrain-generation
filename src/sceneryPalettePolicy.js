import { IMPOSTOR_TYPE } from './impostors/impostorTypes.js'

// Crown palettes of the painted scenery types (the trees). Their sources are
// baked in a neutral gray with a crown mask (src/impostors/impostorArchetypes.js),
// and the shaders pick one palette color per instance from world-space noise
// (getSceneryPaletteTints() in scenery-instance-pars-vertex.glsl): every slot
// has its own noise field, and its weight sets its share. The trunk keeps one
// color per type. Everything here is applied live through uniforms
// (src/sceneryImpostors.js): no re-bake and no placement job.

// Slots per type. The shader packs the weights of a type in one vec4, so this
// cannot exceed 4; it reaches GLSL as a catalog define.
export const SCENERY_PALETTE_SIZE = 4

// Linear gray the painted types are baked in, trunk and crown alike. Below
// white, so the normalized wood grain (which brightens above 1) never clips in
// the 8-bit atlas; the uniforms divide the palette colors by it.
export const SCENERY_PAINT_BASE = 0.5

export const SCENERY_PAINTED_TYPES = Object.freeze([
	IMPOSTOR_TYPE.ROUND_TREE,
	IMPOSTOR_TYPE.CONIFER,
])

// Settings edited by the debug GUI. Colors are sRGB hex strings and labels
// name them in the panel; weights are relative shares (only their ratios
// matter, 0 disables a slot). `frequency`
// is the patch noise frequency per world unit and `mix` the share of a random
// pick per instance (0 noise patches only, 1 every tree random). Types are
// keyed like SCENERY_TYPE_KEYS.
export function createTreePaletteSettings() {
	return {
		frequency: 0.05,
		mix: 0.9,
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
	}
}

// Flattens `settings` into the shader layout for `typeCount` types:
// colors[type * SCENERY_PALETTE_SIZE + slot] and trunks[type] are hex strings,
// or null for white (unpainted types, unused slots); weights follows colors.
// Painted types always keep a positive total weight (slot 0 when every weight
// is 0) and fall back to the default palette when `settings` lacks theirs.
// `typeKeys` maps a type index to its settings key (SCENERY_TYPE_KEYS).
export function getSceneryPaletteLayout(settings, typeKeys, typeCount) {
	const colors = new Array(typeCount * SCENERY_PALETTE_SIZE).fill(null)
	const weights = new Array(typeCount * SCENERY_PALETTE_SIZE).fill(0)
	const trunks = new Array(typeCount).fill(null)
	const defaults = createTreePaletteSettings()

	for (const type of SCENERY_PAINTED_TYPES) {
		if (type >= typeCount) continue
		const key = typeKeys[type]
		const palette = settings?.[key] ?? defaults[key]
		if (!palette) continue
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
	}

	return {
		colors,
		weights,
		trunks,
		frequency: Math.max(0, Number(settings?.frequency ?? defaults.frequency) || 0),
		mix: Math.min(Math.max(Number(settings?.mix ?? defaults.mix) || 0, 0), 1),
	}
}
