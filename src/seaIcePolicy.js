import { clamp01, smoothstep } from './math.js'
import { SAND_LEVEL } from './terrainBands.js'

// The frozen sea of the ice biome (three-free). The terrain shader draws it
// (applySeaIce() in sea-ice-pars-fragment.glsl, with the uniforms of
// updateSeaIceUniforms() in src/sharedUniforms.js); these helpers mirror its
// sheet for the debug map and the tests. Placement keeps boats out of the
// whole ice biome instead (src/sceneryPlacement.js), so nothing here reaches
// the workers.
//
// - The sheet covers the sea wherever its raw height plus the shelf depth is
//   above 0: the shelf grows from 0 at the ice border to `shelf` (world
//   units of depth) once the ice field reaches `fade`, so the sheet narrows
//   to the coast where the ice ends.
// - Beyond its edge, a band `band` units of depth deep (tapered like the
//   shelf) breaks into floes: Voronoi cells `cellSize` units wide, each a
//   plate where the relative depth into the band is below the cell's random
//   value, split by water cracks from `crackMin` to `crackMax` units wide,
//   wider seaward.
// - A simplex wobble of `edgeNoise` units of depth at `edgeFrequency` per
//   world unit frays the edge.
// - The sea freezes further at night: from sunset the shelf deepens by up to
//   `nightShelf` units of depth and the floe band by up to `nightBand`, while
//   the cracks narrow by up to the share `nightCrack`, all reached at sunrise
//   and melted back to the daytime values by noon (getSeaIceNightGrowth()).
//   World updates those uniforms every frame from the time of day
//   (updateSeaIceNight() in src/sharedUniforms.js).
// - Colors are sRGB: the sheet, the floes, and the icy water between them;
//   the ice meets the water without any dark line.
export const SEA_ICE_DEFAULTS = Object.freeze({
	shelf: 15.3,
	fade: 0.15,
	band: 9,
	cellSize: 15,
	crackMin: 0.25,
	crackMax: 4.3,
	edgeNoise: 1.1,
	edgeFrequency: 0.145,
	nightShelf: 18,
	nightBand: 9,
	nightCrack: 0.6,
	colors: Object.freeze({ sheet: '#aed3e5', floe: '#ffffff', water: '#2fe1ee' }),
})

// A mutable copy of SEA_ICE_DEFAULTS (params.seaIce).
export function createSeaIceSettings() {
	return { ...SEA_ICE_DEFAULTS, colors: { ...SEA_ICE_DEFAULTS.colors } }
}

// Times of day (src/dayNightPolicy.js: 0 midnight, 0.5 noon) of the night
// freeze, on a flat horizon: the sea starts freezing at sunset, is most
// frozen at sunrise, and has melted back by noon.
export const SEA_ICE_NIGHT = Object.freeze({ freeze: 0.75, peak: 0.25, melt: 0.5 })

function wrapUnit(value) {
	return value - Math.floor(value)
}

// Share of the night growth at `timeOfDay`: 0 from noon to sunset, rising
// smoothly through the night to 1 at sunrise, then falling back to 0 by noon.
export function getSeaIceNightGrowth(timeOfDay) {
	const { freeze, peak, melt } = SEA_ICE_NIGHT
	// Time since sunset, in the cycle, and the length of the night and morning.
	const sinceFreeze = wrapUnit(timeOfDay - freeze)
	const night = wrapUnit(peak - freeze)
	const morning = wrapUnit(melt - peak)
	if (sinceFreeze <= night) return smoothstep(0, night, sinceFreeze)
	return 1 - smoothstep(night, night + morning, sinceFreeze)
}

// The shelf at `timeOfDay`: `shelf`, deepened by `nightShelf` as the night
// growth goes.
export function getSeaIceShelfAt(settings, timeOfDay) {
	return settings.shelf + Math.max(settings.nightShelf ?? 0, 0) * getSeaIceNightGrowth(timeOfDay)
}

// The floe band at `timeOfDay`: `band`, deepened by `nightBand` as the night
// growth goes, so the floes reach further seaward and pack closer.
export function getSeaIceBandAt(settings, timeOfDay) {
	return settings.band + Math.max(settings.nightBand ?? 0, 0) * getSeaIceNightGrowth(timeOfDay)
}

// Share of the crack widths left open at `timeOfDay`: 1 by day, down to
// 1 - `nightCrack` at sunrise, as the water between the floes freezes.
export function getSeaIceCrackScaleAt(settings, timeOfDay) {
	return 1 - clamp01(settings.nightCrack ?? 0) * getSeaIceNightGrowth(timeOfDay)
}

// Share of the full shelf and band at ice field value `ice`: 0 at and outside
// the ice border, 1 once the field reaches `fade`.
export function getSeaIceAmount(ice, settings) {
	return smoothstep(0, Math.max(settings.fade, 1e-6), ice)
}

export function getSeaIceShelf(ice, settings) {
	return settings.shelf * getSeaIceAmount(ice, settings)
}

export function getSeaIceBand(ice, settings) {
	return settings.band * getSeaIceAmount(ice, settings)
}

// Whether the sheet (without floes or edge wobble) covers the sea at raw
// height `height` and ice field value `ice`.
export function isUnderSeaIce(height, ice, settings) {
	return height <= SAND_LEVEL && ice > 0 && height + getSeaIceShelf(ice, settings) > 0
}
