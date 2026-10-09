// Biome field and band borders of the terrain. Every constant comes from
// src/terrainBands.js (TERRAIN_SHADER_DEFINES), which the CPU reads too.

// The biome fields.
#include ./biome-value.glsl
// The ice and deep ocean fields, interpolated from the vertices
// (project-vertex.glsl).
varying float vIceValue;
varying float vOceanValue;

// Land band colors per biome (src/terrainPalettePolicy.js, written by
// updateTerrainPaletteUniforms() in src/sharedUniforms.js), linear, at
// biome * TERRAIN_PALETTE_BAND_COUNT + band (sand, grass, land, rocks, snow).
uniform vec3 uTerrainColors[BIOME_COUNT * TERRAIN_PALETTE_BAND_COUNT];
// Color (rgb) each band drifts toward with the biome variation noise, and
// how far (a).
uniform vec4 uTerrainVariations[BIOME_COUNT * TERRAIN_PALETTE_BAND_COUNT];
// Per biome, x: color noise scale, y: band line darkness (1 black), z: 1 when
// any band varies.
uniform vec3 uTerrainStyles[BIOME_COUNT];
// Sea colors from the shore down: shallow water, open sea, deep sea, and the
// abyss of the deep ocean.
uniform vec3 uSeaColors[4];
// Depths (positive, world units) where the abyss color starts and is full.
uniform vec2 uSeaAbyssDepth;

// Color of land band `band` (0 sand to 4 snow) in `biome`, drifted by
// `variation` (the biome variation noise, about 0 to 1.2).
vec3 getTerrainColor(int biome, int band, float variation) {
	int index = biome * TERRAIN_PALETTE_BAND_COUNT + band;
	vec4 drift = uTerrainVariations[index];
	return mix(uTerrainColors[index], drift.rgb, variation * drift.a);
}

// Half-width in world units of the black line along biome borders, and the
// world steps of the forward differences that measure the fields' gradients
// (the ice field is broader, so its step is longer).
#define BIOME_LINE_HALF_WIDTH 0.6
#define BIOME_CLIMATE_GRADIENT_STEP 0.5
#define BIOME_ICE_GRADIENT_STEP 4.0

// World-space gradient of the ice field, by central differences: the
// interpolated vIceValue would not do for a difference across a few units.
vec2 getIceGradient(vec2 biomeXZ) {
	vec2 dx = vec2(BIOME_ICE_GRADIENT_STEP, 0.0);
	vec2 dz = vec2(0.0, BIOME_ICE_GRADIENT_STEP);
	return vec2(
		getIceValue(biomeXZ + dx) - getIceValue(biomeXZ - dx),
		getIceValue(biomeXZ + dz) - getIceValue(biomeXZ - dz)
	) / (2.0 * BIOME_ICE_GRADIENT_STEP);
}

// Coverage of the biome separator at a point where a field is `value` with
// world-space gradient `gradient`: the distance to the border is
// |value| / |gradient|, so the line keeps a constant world width. The
// antialias is the pixel's footprint along the gradient, from the ground
// derivatives (fwidth(value) / |gradient| without evaluating the field in
// uniform control flow).
float getBiomeSeparator(float value, vec2 gradient, vec2 groundDx, vec2 groundDy) {
	float gradientLength = max(length(gradient), 1e-9);
	vec2 direction = gradient / gradientLength;
	float borderDistance = abs(value) / gradientLength;
	float antialias = max(abs(dot(direction, groundDx)) + abs(dot(direction, groundDy)), 1e-4) * 0.5;
	return 1.0 - smoothstep(BIOME_LINE_HALF_WIDTH - antialias, BIOME_LINE_HALF_WIDTH + antialias, borderDistance);
}

// Sand brightness on fully rocky coast (params.coastSand.shade).
uniform float uCoastSandShade;

// Rocky coast mask settings (params.coast.mask, updateCoastMaskUniforms()):
// x: frequency per world unit, y: detail frequency, z: detail weight.
uniform vec3 uCoastRockNoise;
// x: threshold, y: softness (half-width of the transition).
uniform vec2 uCoastRockEdge;

// Rocky coast mask in [0, 1] at biomeXZ (already shifted by uBiomeOffset.xy);
// getCoastRockMask() in src/coast.js mirrors it, with the same layer order.
float getCoastRockMask(vec2 biomeXZ) {
	vec2 coastXZ = biomeXZ + COAST_ROCK_OFFSET;
	float value = snoise(coastXZ * uCoastRockNoise.x)
		+ snoise(coastXZ * uCoastRockNoise.y) * uCoastRockNoise.z;
	return smoothstep(uCoastRockEdge.x - uCoastRockEdge.y, uCoastRockEdge.x + uCoastRockEdge.y, value);
}

// The height plus a band's wave (x = frequency, y = amplitude), compared with
// the band's line and level; getBandHeight() in src/terrainBands.js.
float getTerrainBandHeight(vec3 position, vec2 wave) {
	return position.y + sin(position.x * wave.x) * wave.y + cos(position.z * wave.x) * wave.y;
}
