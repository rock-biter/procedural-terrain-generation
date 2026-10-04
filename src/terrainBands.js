// The terrain's biome field and elevation bands, shared by the CPU and the
// terrain shader so both draw the same borders: src/biome.js and scenery
// placement read these tables, and the terrain material receives them as
// #defines (TERRAIN_SHADER_DEFINES) read by terrain-bands-pars.glsl and
// color-fragment.glsl. Three-free: the chunk workers import it.

// The biome field is the sum of these simplex noise layers, each
// [frequency per world unit, weight]; >= 0 is temperate, below desert.
export const BIOME_NOISE_LAYERS = Object.freeze([
	Object.freeze([0.000175, 1]),
	Object.freeze([0.0035, 0.22]),
	Object.freeze([0.012, 0.06]),
])

// Rocky stretches of coast: a low-frequency field, the sum of these simplex
// layers ([frequency per world unit, weight]) at the seeded biome coordinates
// plus `offset`, which decorrelates it from the biome field. The mask is
// smoothstep(threshold - softness, threshold + softness, value): 1 on rocky
// coast, 0 elsewhere. It raises the coastal relief (src/coast.js), darkens the
// sand (color-fragment.glsl), and gathers the sea rocks (sceneryPlacement.js).
export const COAST_ROCK_NOISE = Object.freeze({
	layers: Object.freeze([Object.freeze([0.003, 1]), Object.freeze([0.011, 0.35])]),
	offset: Object.freeze([-5217.3, 8841.6]),
	threshold: 0.15,
	softness: 0.25,
})

// Terrain layers in shader order: the sea, then the elevation bands from
// lowest to highest. `terrainBand` in color-fragment.glsl and the
// per-layer normal maps (src/terrainNormals.js) use these indices.
export const TERRAIN_BANDS = Object.freeze(['sea', 'sand', 'grass', 'land', 'rocks', 'snow'])
export const TERRAIN_BAND = Object.freeze(
	Object.fromEntries(TERRAIN_BANDS.map((band, index) => [band, index])),
)

// Sand begins above this height; the sea fills everything below.
export const SAND_LEVEL = 0.1

// The bands above sand. Each begins where the height plus a wave,
// sin(x * frequency) * amplitude + cos(z * frequency) * amplitude, exceeds
// `level`; a black ink line runs between `line` and `level` below it.
export const TERRAIN_HEIGHT_BANDS = Object.freeze({
	grass: Object.freeze({ frequency: 0.3, amplitude: 0.6, line: 1.6, level: 1.7 }),
	land: Object.freeze({ frequency: 0.1, amplitude: 1.6, line: 14, level: 14.1 }),
	rocks: Object.freeze({ frequency: 0.15, amplitude: 2.5, line: 22, level: 22.2 }),
	snow: Object.freeze({ frequency: 0.15, amplitude: 5, line: 40, level: 40.2 }),
})

// The height plus the band's wave; getTerrainBandHeight() in GLSL.
export function getBandHeight(x, y, z, { frequency, amplitude }) {
	return y + Math.sin(x * frequency) * amplitude + Math.cos(z * frequency) * amplitude
}

// Index into TERRAIN_BANDS of the layer the shader colors at world point
// (x, y, z). Like the shader, a higher band wins wherever its border is passed.
export function getTerrainBand(x, y, z) {
	if (!(y > SAND_LEVEL)) return TERRAIN_BAND.sea
	let band = TERRAIN_BAND.sand
	for (const [name, settings] of Object.entries(TERRAIN_HEIGHT_BANDS)) {
		if (getBandHeight(x, y, z, settings) > settings.level) band = TERRAIN_BAND[name]
	}
	return band
}

// GLSL float literal: integers keep a decimal point.
function glslFloat(value) {
	return Number.isInteger(value) ? value.toFixed(1) : String(value)
}

function createShaderDefines() {
	const defines = {
		TERRAIN_BAND_COUNT: String(TERRAIN_BANDS.length),
		TERRAIN_SAND_LEVEL: glslFloat(SAND_LEVEL),
	}
	TERRAIN_BANDS.forEach((band, index) => {
		defines[`TERRAIN_BAND_${band.toUpperCase()}`] = String(index)
	})
	for (const [name, { frequency, amplitude, line, level }] of Object.entries(
		TERRAIN_HEIGHT_BANDS,
	)) {
		const key = name.toUpperCase()
		defines[`TERRAIN_${key}_WAVE`] = `vec2(${glslFloat(frequency)}, ${glslFloat(amplitude)})`
		defines[`TERRAIN_${key}_LINE`] = glslFloat(line)
		defines[`TERRAIN_${key}_LEVEL`] = glslFloat(level)
	}
	BIOME_NOISE_LAYERS.forEach(([frequency, weight], index) => {
		defines[`BIOME_NOISE_LAYER_${index}`] = `vec2(${glslFloat(frequency)}, ${glslFloat(weight)})`
	})
	COAST_ROCK_NOISE.layers.forEach(([frequency, weight], index) => {
		defines[`COAST_ROCK_LAYER_${index}`] = `vec2(${glslFloat(frequency)}, ${glslFloat(weight)})`
	})
	const [offsetX, offsetZ] = COAST_ROCK_NOISE.offset
	defines.COAST_ROCK_OFFSET = `vec2(${glslFloat(offsetX)}, ${glslFloat(offsetZ)})`
	defines.COAST_ROCK_THRESHOLD = glslFloat(COAST_ROCK_NOISE.threshold)
	defines.COAST_ROCK_SOFTNESS = glslFloat(COAST_ROCK_NOISE.softness)
	return Object.freeze(defines)
}

// Material defines for the terrain shader.
export const TERRAIN_SHADER_DEFINES = createShaderDefines()
