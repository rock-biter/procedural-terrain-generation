import { smoothstep } from './math.js'
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
// - Colors are sRGB: the sheet, the floes, and the icy water between them;
//   the ice meets the water without any dark line.
export const SEA_ICE_DEFAULTS = Object.freeze({
	shelf: 15.3,
	fade: 0.065,
	band: 9,
	cellSize: 15,
	crackMin: 0.25,
	crackMax: 4.3,
	edgeNoise: 1.1,
	edgeFrequency: 0.145,
	colors: Object.freeze({ sheet: '#93bdd2', floe: '#c3dfee', water: '#249af5' }),
})

// A mutable copy of SEA_ICE_DEFAULTS (params.seaIce).
export function createSeaIceSettings() {
	return { ...SEA_ICE_DEFAULTS, colors: { ...SEA_ICE_DEFAULTS.colors } }
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
