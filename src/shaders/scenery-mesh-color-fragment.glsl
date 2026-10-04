// Replaces <color_fragment>. LOD 0 keeps the pixels whose noise is below the
// LOD fade, LOD 1 those between it and the mesh fade, and the impostor the
// rest (scenery-dither-pars-fragment.glsl), so each pixel is drawn once.
float sceneryNoise = getSceneryDitherNoise();
#if SCENERY_MESH_LOD == 0
if (sceneryNoise >= vSceneryLodFade) discard;
#else
if (sceneryNoise < vSceneryLodFade || sceneryNoise >= vSceneryDither.x) discard;
#endif

// The same albedo the bake stores: vertex color times the wood detail, then
// the instance tint and variation like impostor-color-fragment.glsl, mixed
// from the trunk to the crown palette tint by the crown mask.
vec3 sceneryTint = vTint;
#ifdef SCENERY_PALETTE
sceneryTint = mix(vTint, vPaintTint, vSceneryPaint);
#endif
diffuseColor.rgb *= applyDetail(vColor.rgb, vSceneryLocalPosition, normalize(vSceneryLocalNormal), vSceneryDetail) * sceneryTint;

// Atmosphere clamp shared with the terrain. Clouds skip it: clamping their
// light albedo to the atmosphere color would tint them; only fog fades them.
#ifndef SCENERY_NO_ATMOSPHERE_CLAMP
diffuseColor.rgb = mix(min(uAtmosphere, diffuseColor.rgb), diffuseColor.rgb, smoothstep(700.0, 400.0, distanceFromCamera));
#endif
