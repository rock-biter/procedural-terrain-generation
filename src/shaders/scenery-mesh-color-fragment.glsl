// Replaces <color_fragment>. Keeps the pixels the impostor discards
// (scenery-dither-pars-fragment.glsl), so the two together cover each pixel once.
if (getSceneryDitherNoise() >= vSceneryDither.x) discard;

// The same albedo the bake stores: vertex color times the wood detail, then
// the instance tint and variation like impostor-color-fragment.glsl.
diffuseColor.rgb *= applyDetail(vColor.rgb, vSceneryLocalPosition, normalize(vSceneryLocalNormal)) * vTint;

// Atmosphere clamp shared with the impostors.
diffuseColor.rgb = mix(min(uAtmosphere, diffuseColor.rgb), diffuseColor.rgb, smoothstep(700.0, 400.0, distanceFromCamera));
