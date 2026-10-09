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
	getSeaRegionDrift,
	getSeaWaveComponents,
	SEA_TYPES,
	SEA_WAVE_COUNT,
} from './seaSurfacePolicy'
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

const perSeaType = (create) => SEA_TYPES.map(() => create())

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
		// The moving sea (sea-surface-pars.glsl, sea-ripple-pars-fragment.glsl),
		// one entry per sea type or per wave component; written by
		// updateSeaSurfaceUniforms().
		uSeaWaves: {
			value: Array.from({ length: SEA_TYPES.length * SEA_WAVE_COUNT }, () => new Vector4()),
		},
		uSeaWaveSizes: {
			value: Array.from({ length: SEA_TYPES.length * SEA_WAVE_COUNT }, () => new Vector2()),
		},
		uSeaWaveShape: { value: perSeaType(() => new Vector4()) },
		uSeaCrestWaves: { value: perSeaType(() => 0) },
		uSeaRegions: { value: new Vector4() },
		uSeaSurface: { value: new Vector4() },
		uSeaFoamColor: { value: new Color() },
		uSeaFoamLineBand: { value: perSeaType(() => new Vector4()) },
		uSeaFoamLineMotion: { value: perSeaType(() => new Vector4()) },
		uSeaFoamLineStyle: { value: perSeaType(() => new Vector4()) },
		uSeaFoamLineDash: { value: perSeaType(() => new Vector2()) },
		uSeaRipples: { value: perSeaType(() => new Vector4()) },
		uSeaRippleDetail: { value: perSeaType(() => new Vector2()) },
		uSeaCrestLines: { value: perSeaType(() => new Vector4()) },
		uSeaMinimum: { value: perSeaType(() => new Vector2()) },
	}
	updateBiomeOffsetUniforms(uniforms, createBiomeOffset(seed))
	updateCoastMaskUniforms(uniforms, params.coast.mask)
	updateBiomeUniforms(uniforms, params.biomes)
	updateTerrainPaletteUniforms(uniforms, params.terrainPalette)
	updateSeaIceUniforms(uniforms, params.seaIce, params.dayNight?.timeOfDay)
	updateSeaSurfaceUniforms(uniforms, params.seaSurface)
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

// Smallest gap between the two edges of a smoothstep(), which is undefined
// unless the first is below the second.
const MIN_EDGE_GAP = 0.01

// Writes the moving sea's settings (params.seaSurface, src/seaSurfacePolicy.js)
// into their uniforms, in place: the Gerstner components of both sea types
// (getSeaWaveComponents()), the regions, the vertex fade, the ripples, the
// crest lines, and the foam lines, with the foam color converted from sRGB to
// linear.
export function updateSeaSurfaceUniforms(uniforms, settings) {
	const { regions, vertex, oceanBlend, foamColor, debugView } = settings
	const fadeStart = Math.max(vertex.fadeStart, 0)
	uniforms.uSeaSurface.value.set(
		fadeStart,
		Math.max(vertex.fadeEnd, fadeStart + 1),
		Math.max(oceanBlend, 1e-4),
		debugView,
	)
	const [driftX, driftZ] = getSeaRegionDrift(regions)
	uniforms.uSeaRegions.value.set(1 / Math.max(regions.scale, 1), regions.contrast, driftX, driftZ)
	uniforms.uSeaFoamColor.value.set(foamColor)
	SEA_TYPES.forEach((key, type) => {
		const { waves, coast, ripples, crests, foam } = settings[key]
		getSeaWaveComponents(waves).forEach((component, index) => {
			const slot = type * SEA_WAVE_COUNT + index
			uniforms.uSeaWaves.value[slot].set(component.x, component.z, component.k, component.omega)
			uniforms.uSeaWaveSizes.value[slot].set(component.amplitude, component.reach)
		})
		const coastStart = Math.max(coast.start, 0)
		uniforms.uSeaWaveShape.value[type].set(
			Math.max(waves.calm, 0),
			Math.max(waves.rough, 0),
			coastStart,
			Math.max(coast.full, coastStart + MIN_EDGE_GAP),
		)
		uniforms.uSeaRipples.value[type].set(
			ripples.amplitude,
			Math.max(ripples.wavelength, 0.1),
			ripples.speed,
			ripples.irregularity,
		)
		uniforms.uSeaRippleDetail.value[type].set(ripples.irregularityScale, ripples.stateStrength)
		uniforms.uSeaCrestLines.value[type].set(
			crests.threshold,
			Math.max(crests.softness, 1e-3),
			crests.width,
			crests.intensity,
		)
		uniforms.uSeaMinimum.value[type].set(crests.minimum, ripples.minimum)
		uniforms.uSeaCrestWaves.value[type] = crests.waves
		const bandStart = Math.max(foam.start, 0)
		const fadeEdge = Math.max(foam.fadeStart, 0)
		uniforms.uSeaFoamLineBand.value[type].set(
			bandStart,
			Math.max(foam.full, bandStart + MIN_EDGE_GAP),
			fadeEdge,
			Math.max(foam.end, fadeEdge + MIN_EDGE_GAP),
		)
		uniforms.uSeaFoamLineMotion.value[type].set(
			foam.frequency,
			foam.speed,
			foam.wobbleFrequency,
			foam.wobbleAmount,
		)
		uniforms.uSeaFoamLineStyle.value[type].set(
			Math.max(foam.sharpness, 0.1),
			foam.intensity,
			foam.stateBoost,
			0,
		)
		uniforms.uSeaFoamLineDash.value[type].set(foam.dashScale, foam.dashAmount)
	})
}
