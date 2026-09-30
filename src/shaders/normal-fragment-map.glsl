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
vec3 mapN = sampleTerrainNormal(terrainBand, terrainNormalUv, dFdx(terrainNormalUv), dFdy(terrainNormalUv));
	// Fade the fabric normal map out before its fine pattern aliases into
	// moire at mid distance; full strength within 20 units of the plane.
mapN.xy *= smoothstep(120., 20., distanceFromCamera);

normal = normalize(tbn * mapN);

#elif defined( USE_BUMPMAP )

normal = perturbNormalArb(- vViewPosition, normal, dHdxy_fwd(), faceDirection);

#endif