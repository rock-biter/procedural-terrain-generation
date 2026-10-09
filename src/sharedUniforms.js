import { Color, Vector2, Vector3, Vector4 } from 'three'
import {
	BIOME_COUNT,
	createBiomeOffset,
	getBiomeGradientBounds,
	getOceanNoiseOffset,
} from './biome'
import { createCloudShadowUniforms } from './cloudShadows'
import { createSceneryShadowUniforms } from './sceneryShadows'
import { createSeaFoamUniforms } from './seaFoam'
import {
	getSeaIceBandAt,
	getSeaIceCrackScaleAt,
	getSeaIceShelfAt,
	SEA_ICE_NIGHT,
} from './seaIcePolicy'
import { createTerrainNormalUniforms } from './terrainNormals'
import {
	getTerrainPaletteLayout,
	TERRAIN_PALETTE_BANDS,
	TERRAIN_SEA_COLORS,
} from './terrainPalettePolicy'
import { CURVATURE } from './worldConstants'

const PALETTE_SIZE = BIOME_COUNT * TERRAIN_PALETTE_BANDS.length

// Uniforms shared by the terrain, scenery, clouds, and debug materials: one
// object whose entries every material references, so a write reaches them
// all. `params` is createAppParams(); `seed` sets the biome offset.
export function createSharedUniforms(params, seed) {
	const uniforms = {
		uTime: { value: 0 },
		uCamera: { value: new Vector3() },
		uCurvature: { value: CURVATURE },
		// Written by DayNight before the first render.
		uAtmosphere: { value: new Color() },
		// Seeded biome offsets; written by updateBiomeOffsetUniforms().
		uBiomeOffset: { value: new Vector4() },
		uBiomeOceanOffset: { value: new Vector2() },
		// Biome distribution (biome-value.glsl), terrain palettes
		// (terrain-bands-pars.glsl), and frozen sea (sea-ice-pars.glsl); written
		// by the update functions below.
		uBiomeClimate: { value: new Vector4() },
		uBiomeIce: { value: new Vector4() },
		uBiomeOcean: { value: new Vector4() },
		uTerrainColors: { value: Array.from({ length: PALETTE_SIZE }, () => new Color()) },
		uTerrainVariations: { value: Array.from({ length: PALETTE_SIZE }, () => new Vector4()) },
		uTerrainStyles: { value: Array.from({ length: BIOME_COUNT }, () => new Vector3()) },
		uSeaColors: { value: TERRAIN_SEA_COLORS.map(() => new Color()) },
		uSeaAbyssDepth: { value: new Vector2() },
		uSeaIceShape: { value: new Vector4() },
		uSeaIceEdge: { value: new Vector4() },
		uSeaIceColors: { value: [new Color(), new Color(), new Color()] },
		uColorNoiseFrequency: { value: params.terrainColorNoise.frequency },
		uColorNoiseIntensity: { value: params.terrainColorNoise.intensity },
		uColorNoiseThreshold: { value: params.terrainColorNoise.threshold },
		uColorNoiseSoftness: { value: params.terrainColorNoise.softness },
		uColorNoiseSpeed: { value: params.terrainColorNoise.speed },
		uCoastSandShade: { value: params.coastSand.shade },
		uCoastRockNoise: { value: new Vector3() },
		uCoastRockEdge: { value: new Vector2() },
		...createTerrainNormalUniforms(params.terrainNormals),
		// Impostor-to-mesh band; written by SceneryMeshes.applySettings().
		uSceneryMeshRange: { value: new Vector2(-2, -1) },
		// Shadow maps, matrices, and fades; written by SceneryShadows.
		...createSceneryShadowUniforms(params.shadows),
		// Cloud shadow map, matrix, and strength; written by CloudShadows.
		...createCloudShadowUniforms(),
		// Sea rock distance map and ripple shape; written by SeaFoam.
		...createSeaFoamUniforms(),
	}
	updateBiomeOffsetUniforms(uniforms, createBiomeOffset(seed))
	updateCoastMaskUniforms(uniforms, params.coast.mask)
	updateBiomeUniforms(uniforms, params.biomes)
	updateTerrainPaletteUniforms(uniforms, params.terrainPalette)
	updateSeaIceUniforms(uniforms, params.seaIce, params.dayNight?.timeOfDay)
	return uniforms
}

// Writes the seeded biome offset (createBiomeOffset()) into uBiomeOffset, and
// the deep ocean's noise offset derived from it into uBiomeOceanOffset, in
// place.
export function updateBiomeOffsetUniforms(uniforms, offset) {
	uniforms.uBiomeOffset.value.fromArray(offset)
	uniforms.uBiomeOceanOffset.value.fromArray(getOceanNoiseOffset(offset))
}

// Writes the rocky coast mask settings (params.coast.mask) into the terrain
// shader's uniforms, in place; the CPU reads the same settings
// (getCoastRockMask() in src/coast.js).
export function updateCoastMaskUniforms(uniforms, mask) {
	uniforms.uCoastRockNoise.value.set(mask.frequency, mask.detailFrequency, mask.detailWeight)
	uniforms.uCoastRockEdge.value.set(mask.threshold, mask.softness)
}

// Writes the biome distribution (params.biomes) into the biome uniforms, in
// place; the CPU reads the same settings (getBiomeFields() in src/biome.js).
// The gradient bounds follow the sizes, so the separators keep their width.
export function updateBiomeUniforms(uniforms, settings) {
	const bounds = getBiomeGradientBounds(settings)
	uniforms.uBiomeClimate.value.set(1 / settings.size, settings.desertBias, bounds.climate, 0)
	uniforms.uBiomeIce.value.set(
		1 / settings.iceSize,
		settings.iceThreshold,
		settings.iceRing,
		bounds.ice,
	)
	uniforms.uBiomeOcean.value.set(1 / settings.oceanSize, settings.oceanThreshold, 0, 0)
}

const color = new Color()

// Writes the terrain and sea colors (params.terrainPalette,
// getTerrainPaletteLayout()) into their uniforms, in place, converted from
// sRGB to linear, and the abyss depths.
export function updateTerrainPaletteUniforms(uniforms, settings) {
	const { colors, variations, styles, sea, abyssDepth } = getTerrainPaletteLayout(settings)
	colors.forEach((hex, index) => uniforms.uTerrainColors.value[index].set(hex))
	variations.forEach(({ color: hex, amount }, index) => {
		color.set(hex)
		uniforms.uTerrainVariations.value[index].set(color.r, color.g, color.b, amount)
	})
	styles.forEach((style, index) => uniforms.uTerrainStyles.value[index].fromArray(style))
	sea.forEach((hex, index) => uniforms.uSeaColors.value[index].set(hex))
	uniforms.uSeaAbyssDepth.value.fromArray(abyssDepth)
}

// Writes the frozen sea settings (params.seaIce, src/seaIcePolicy.js) into
// their uniforms, in place, with the shelf, band, and cracks of `timeOfDay`
// (noon by default: the daytime settings themselves).
export function updateSeaIceUniforms(uniforms, settings, timeOfDay = SEA_ICE_NIGHT.melt) {
	uniforms.uSeaIceShape.value.y = settings.fade
	uniforms.uSeaIceShape.value.w = settings.cellSize
	uniforms.uSeaIceEdge.value.z = settings.edgeNoise
	uniforms.uSeaIceEdge.value.w = settings.edgeFrequency
	updateSeaIceNight(uniforms, settings, timeOfDay)
	const { sheet, floe, water } = settings.colors
	;[sheet, floe, water].forEach((hex, index) => uniforms.uSeaIceColors.value[index].set(hex))
}

// Writes only what follows `timeOfDay`, every frame: the sea freezes further
// through the night (a deeper shelf, a deeper floe band, narrower cracks) and
// melts back by noon.
export function updateSeaIceNight(uniforms, settings, timeOfDay) {
	const shape = uniforms.uSeaIceShape.value
	shape.x = getSeaIceShelfAt(settings, timeOfDay)
	shape.z = getSeaIceBandAt(settings, timeOfDay)
	const crackScale = getSeaIceCrackScaleAt(settings, timeOfDay)
	uniforms.uSeaIceEdge.value.x = settings.crackMin * crackScale
	uniforms.uSeaIceEdge.value.y = settings.crackMax * crackScale
}
