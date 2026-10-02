// Per-layer terrain normal maps. Arrays follow TERRAIN_BANDS in
// src/terrainNormals.js: 0 sea, 1 sand, 2 grass, 3 land, 4 rocks, 5 snow.
#define TERRAIN_NORMAL_LAYERS 6
uniform sampler2D uTerrainNormalMaps[TERRAIN_NORMAL_LAYERS];
// Size of one texture tile in world units.
uniform float uTerrainNormalScale[TERRAIN_NORMAL_LAYERS];
uniform vec2 uTerrainNormalStrength[TERRAIN_NORMAL_LAYERS];
// (cos, sin) of the texture rotation on the ground.
uniform vec2 uTerrainNormalRotation[TERRAIN_NORMAL_LAYERS];
// x = distance where the fade starts, y = distance where the maps are gone.
uniform vec2 uTerrainNormalFade;

// Samples one layer at world-space uv. Only the selected layer is fetched;
// gradients come from the caller because derivatives are undefined inside
// the non-uniform branch below. GLSL ES 3.00 only indexes sampler arrays
// with constants, hence the if chain.
vec3 sampleTerrainNormal(int layer, vec2 worldUv, vec2 worldUvDx, vec2 worldUvDy) {
	// Rotating the uv by -angle turns the texture by +angle on the ground.
	vec2 rotation = uTerrainNormalRotation[layer];
	mat2 toTexture = mat2(rotation.x, - rotation.y, rotation.y, rotation.x) / uTerrainNormalScale[layer];
	vec2 uv = toTexture * worldUv;
	vec2 uvDx = toTexture * worldUvDx;
	vec2 uvDy = toTexture * worldUvDy;
	vec4 texel;
	if (layer == 0) texel = textureGrad(uTerrainNormalMaps[0], uv, uvDx, uvDy);
	else if (layer == 1) texel = textureGrad(uTerrainNormalMaps[1], uv, uvDx, uvDy);
	else if (layer == 2) texel = textureGrad(uTerrainNormalMaps[2], uv, uvDx, uvDy);
	else if (layer == 3) texel = textureGrad(uTerrainNormalMaps[3], uv, uvDx, uvDy);
	else if (layer == 4) texel = textureGrad(uTerrainNormalMaps[4], uv, uvDx, uvDy);
	else texel = textureGrad(uTerrainNormalMaps[5], uv, uvDx, uvDy);

	// X is in the color channels and Y in alpha (scripts/encode-assets.mjs);
	// Z follows from a unit normal.
	vec2 xy = vec2(texel.r, texel.a) * 2.0 - 1.0;
	vec3 mapN = vec3(xy, sqrt(max(1.0 - dot(xy, xy), 0.0)));
	mapN.xy *= uTerrainNormalStrength[layer];
	// Turn the perturbation back into the unrotated uv frame used by the
	// tangent basis.
	mapN.xy = mat2(rotation.x, rotation.y, - rotation.y, rotation.x) * mapN.xy;
	return mapN;
}
