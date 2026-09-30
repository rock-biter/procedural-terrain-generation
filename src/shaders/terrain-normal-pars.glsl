// Per-layer terrain normal maps. Arrays follow TERRAIN_BANDS in
// src/terrainNormals.js: 0 sea, 1 sand, 2 grass, 3 land, 4 rocks, 5 snow.
#define TERRAIN_NORMAL_LAYERS 6
uniform sampler2D uTerrainNormalMaps[TERRAIN_NORMAL_LAYERS];
// Size of one texture tile in world units.
uniform float uTerrainNormalScale[TERRAIN_NORMAL_LAYERS];
uniform vec2 uTerrainNormalStrength[TERRAIN_NORMAL_LAYERS];

// Samples one layer at world-space uv. Only the selected layer is fetched;
// gradients come from the caller because derivatives are undefined inside
// the non-uniform branch below. GLSL ES 3.00 only indexes sampler arrays
// with constants, hence the if chain.
vec3 sampleTerrainNormal(int layer, vec2 worldUv, vec2 worldUvDx, vec2 worldUvDy) {
	float repeat = 1.0 / uTerrainNormalScale[layer];
	vec2 uv = worldUv * repeat;
	vec2 uvDx = worldUvDx * repeat;
	vec2 uvDy = worldUvDy * repeat;
	vec3 texel;
	if (layer == 0) texel = textureGrad(uTerrainNormalMaps[0], uv, uvDx, uvDy).xyz;
	else if (layer == 1) texel = textureGrad(uTerrainNormalMaps[1], uv, uvDx, uvDy).xyz;
	else if (layer == 2) texel = textureGrad(uTerrainNormalMaps[2], uv, uvDx, uvDy).xyz;
	else if (layer == 3) texel = textureGrad(uTerrainNormalMaps[3], uv, uvDx, uvDy).xyz;
	else if (layer == 4) texel = textureGrad(uTerrainNormalMaps[4], uv, uvDx, uvDy).xyz;
	else texel = textureGrad(uTerrainNormalMaps[5], uv, uvDx, uvDy).xyz;

	vec3 mapN = texel * 2.0 - 1.0;
	mapN.xy *= uTerrainNormalStrength[layer];
	return mapN;
}
