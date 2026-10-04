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

// Offset of the rocky coast mask (src/coast.js) from the seeded biome
// coordinates, which decorrelates it from the biome field. Its noise settings
// are runtime parameters (params.coast.mask), shared with the shader as
// uniforms.
export const COAST_ROCK_OFFSET = Object.freeze([-5217.3, 8841.6])

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

// The biome layers as defines, for every shader that includes
// biome-value.glsl: the terrain and the scenery palettes.
export const BIOME_SHADER_DEFINES = Object.freeze(
	Object.fromEntries(
		BIOME_NOISE_LAYERS.map(([frequency, weight], index) => [
			`BIOME_NOISE_LAYER_${index}`,
			`vec2(${glslFloat(frequency)}, ${glslFloat(weight)})`,
		]),
	),
)

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
	Object.assign(defines, BIOME_SHADER_DEFINES)
	const [offsetX, offsetZ] = COAST_ROCK_OFFSET
	defines.COAST_ROCK_OFFSET = `vec2(${glslFloat(offsetX)}, ${glslFloat(offsetZ)})`
	return Object.freeze(defines)
}

// Material defines for the terrain shader.
export const TERRAIN_SHADER_DEFINES = createShaderDefines()
