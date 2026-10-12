// Biome field and band borders of the terrain. Every constant comes from
// src/terrainBands.js (TERRAIN_SHADER_DEFINES), which the CPU reads too.

// The biome fields.
#include ./biome-value.glsl
// The ice and deep ocean fields and the climate (before the forest ring),
// interpolated from the vertices (project-vertex.glsl).
varying float vIceValue;
varying float vOceanValue;
varying float vClimateNoise;

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

// Half-width in world units of the black line along biome borders, the
// smallest sine between the pixel's ground axes that getFieldGradient()
// solves, and the world steps of the fallback differences of the exact fields
// (the ice field is broader, so its step is longer).
#define BIOME_LINE_HALF_WIDTH 0.6
#define BIOME_GRADIENT_MIN_SINE 0.02
#define BIOME_CLIMATE_GRADIENT_STEP 0.5
#define BIOME_ICE_GRADIENT_STEP 4.0

// World-space gradient of a field interpolated across the triangle (the
// vertex fields), from its screen derivatives `screen` (dFdx, dFdy) and the
// ground's, `groundDx` and `groundDy`: both are affine on the triangle, so
// screen = (groundDx · g, groundDy · g) holds exactly for the interpolated
// field, the one the separators threshold, with no noise sample. False where
// the pixel's ground axes are nearly parallel (a cliff seen head-on), whose
// solution the derivatives' precision would spoil; the callers then take the
// exact field's differences below.
bool getFieldGradient(vec2 screen, vec2 groundDx, vec2 groundDy, out vec2 gradient) {
	float determinant = groundDx.x * groundDy.y - groundDx.y * groundDy.x;
	bool solvable = abs(determinant) > BIOME_GRADIENT_MIN_SINE * length(groundDx) * length(groundDy);
	gradient = vec2(
		screen.x * groundDy.y - screen.y * groundDx.y,
		screen.y * groundDx.x - screen.x * groundDy.x
	) / (solvable ? determinant : 1.0);
	return solvable;
}

// Fallback world-space gradients of the exact fields, by differences.
vec2 getClimateGradient(vec2 biomeXZ) {
	float climate = getClimateNoise(biomeXZ);
	return (vec2(
		getClimateNoise(biomeXZ + vec2(BIOME_CLIMATE_GRADIENT_STEP, 0.0)),
		getClimateNoise(biomeXZ + vec2(0.0, BIOME_CLIMATE_GRADIENT_STEP))
	) - climate) / BIOME_CLIMATE_GRADIENT_STEP;
}

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

// The band heights (getTerrainBandHeight()): exact per pixel, and
// interpolated from the vertices (grass, land, rocks, snow) for their change
// across the pixel, whose derivatives include the waves' slopes with no
// trigonometry in the fragment.
#include ./terrain-band-height.glsl
varying vec4 vBandHeights;

// The ink lines (the band lines and the shoreline), params.terrainLines: x and
// y, the distances from the camera where they start thinning and where they
// are gone; z, the width of their edges in pixels there (one pixel near).
uniform vec3 uTerrainLines;

// The share of its width an ink line keeps at `cameraDistance` (x, 1 near, 0
// far) and the width of its edges in pixels (y).
vec2 getTerrainLineFade(float cameraDistance) {
	float fade = 1.0 - smoothstep(uTerrainLines.x, uTerrainLines.y, cameraDistance);
	return vec2(fade, mix(uTerrainLines.z, 1.0, fade));
}

// Coverage of an ink line `width` units wide that runs below the border
// `level`, at the value `value`, which changes by `pixel` across the pixel:
// the share of a window fade.y pixels wide (getTerrainLineFade()) that the
// line covers, so its edges soften over fade.y pixels and a line thinner than
// the window keeps its ink, fading evenly instead of breaking into dashes. The
// line thins toward the border by fade.x. It reaches at most half a window
// below `level - width` and above `level`.
float getTerrainLine(float value, float pixel, float level, float width, vec2 fade) {
	float window = max(fade.y * pixel, 1e-5);
	float overlap = min(value + 0.5 * window, level) - max(value - 0.5 * window, level - width * fade.x);
	return max(overlap, 0.0) / window;
}

// A band's border at band height `value`, which changes by `pixel` across
// the pixel (fwidth() of vBandHeights): x, the share of the band above its
// border `level`, antialiased over one pixel; y, the coverage of its ink line
// from `line` up to the border (getTerrainLine()).
vec2 getTerrainBandBorder(float value, float pixel, float line, float level, vec2 fade) {
	pixel = max(pixel, 1e-5);
	return vec2(clamp((value - level) / pixel + 0.5, 0.0, 1.0), getTerrainLine(value, pixel, level, level - line, fade));
}
