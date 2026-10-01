// Replaces <color_fragment>.
// Near the eye the mesh keeps the pixels below the fade; the impostor keeps the
// rest (scenery-dither-pars-fragment.glsl). Discard before any atlas fetch.
if (getSceneryDitherNoise() < vSceneryDither.x) discard;

vec4 impostorAlbedo = vec4(0.0);
vec3 impostorNormalSum = vec3(0.0);
#ifdef IMPOSTOR_SINGLE_FRAME
// Cheaper path: only the dominant frame, with visible switches between views.
vec4 dominantFrame = vFrameWeights.x >= max(vFrameWeights.y, vFrameWeights.z)
	? vFrame0
	: (vFrameWeights.y >= vFrameWeights.z ? vFrame1 : vFrame2);
sampleImpostorFrame(dominantFrame, 1.0, impostorAlbedo, impostorNormalSum);
#else
sampleImpostorFrame(vFrame0, vFrameWeights.x, impostorAlbedo, impostorNormalSum);
sampleImpostorFrame(vFrame1, vFrameWeights.y, impostorAlbedo, impostorNormalSum);
sampleImpostorFrame(vFrame2, vFrameWeights.z, impostorAlbedo, impostorNormalSum);
#endif
// <alphatest_fragment> discards or converts this coverage to MSAA samples.
diffuseColor.rgb = impostorSRGBToLinear(impostorAlbedo.rgb / max(impostorAlbedo.a, 1e-4)) * vTint;
diffuseColor.a = impostorAlbedo.a;

// Atmosphere clamp shared with the terrain and dormant scenery.
diffuseColor.rgb = mix(min(uAtmosphere, diffuseColor.rgb), diffuseColor.rgb, smoothstep(700.0, 400.0, distanceFromCamera));
