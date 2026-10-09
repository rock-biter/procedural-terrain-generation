#ifdef USE_NORMALMAP_OBJECTSPACE

normal = texture2D(normalMap, vNormalMapUv).xyz * 2.0 - 1.0; // overrides both flatShading and attribute normals

	#ifdef FLIP_SIDED

normal = - normal;

	#endif

	#ifdef DOUBLE_SIDED

normal = normal * faceDirection;

	#endif

normal = normalize(normalMatrix * normal);

#elif defined( USE_NORMALMAP_TANGENTSPACE )

// Each terrain layer (terrainBand from color-fragment.glsl) has its own map,
// sampled in world XZ so tiles continue across chunks. V runs along -Z like
// the chunk uv, so the tangent frame built from vNormalMapUv still applies.
vec2 terrainNormalUv = vec2(wPosition.x, - wPosition.z);
// The sea's ribs snake across themselves (getSeaRippleWarp()) as far as its
// waves reach, stronger in rough regions; the mip level keeps the unwarped
// gradients.
vec2 terrainNormalSampleUv = terrainNormalUv;
float seaRippleBoost = 1.0;
if (terrainBand == TERRAIN_BAND_SEA) {
	seaRippleBoost = getSeaRippleBoost(seaOceanMask, seaState);
	if (seaWaves.amount > 0.0 && distanceFromCamera < uTerrainNormalFade.y) {
		terrainNormalSampleUv += getSeaRippleWarp(terrainNormalUv, vSeaRippleNoise, seaOceanMask, seaWaves.amount * seaRippleBoost);
	}
}
vec3 mapN = sampleTerrainNormal(terrainBand, terrainNormalSampleUv, dFdx(terrainNormalUv), dFdy(terrainNormalUv));
	// Fade the fabric normal maps out before their fine patterns alias into
	// moire at a distance; range set by uTerrainNormalFade.
mapN.xy *= 1.0 - smoothstep(uTerrainNormalFade.x, uTerrainNormalFade.y, distanceFromCamera);
// The waves' normal (color-fragment.glsl) in the tangent frame (T along +X,
// B along -Z), added to the map's by their slopes; it reaches past the maps'
// fade.
if (terrainBand == TERRAIN_BAND_SEA) {
	mapN.xy *= seaRippleBoost;
	vec3 waveN = vec3(seaWaveNormal.x, - seaWaveNormal.z, seaWaveNormal.y);
	mapN = vec3(mapN.xy * waveN.z + waveN.xy * mapN.z, mapN.z * waveN.z);
}

normal = normalize(tbn * mapN);

#elif defined( USE_BUMPMAP )

normal = perturbNormalArb(- vViewPosition, normal, dHdxy_fwd(), faceDirection);

#endif