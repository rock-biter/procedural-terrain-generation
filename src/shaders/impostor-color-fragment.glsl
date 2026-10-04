// Replaces <color_fragment>.
// Near the eye the mesh keeps the pixels below the fade; the impostor keeps the
// rest (scenery-dither-pars-fragment.glsl). Discard before any atlas fetch.
if (getSceneryDitherNoise() < vSceneryDither.x) discard;

vec4 impostorAlbedo = vec4(0.0);
vec3 impostorNormalSum = vec3(0.0);
float impostorDepthSum = 0.0;
float impostorPaintSum = 0.0;
#ifdef IMPOSTOR_SINGLE_FRAME
// Cheaper path: only the dominant frame, with visible switches between views.
vec4 dominantFrame = vFrameWeights.x >= max(vFrameWeights.y, vFrameWeights.z)
	? vFrame0
	: (vFrameWeights.y >= vFrameWeights.z ? vFrame1 : vFrame2);
sampleImpostorFrame(dominantFrame, 1.0, impostorAlbedo, impostorNormalSum, impostorDepthSum, impostorPaintSum);
#else
sampleImpostorFrame(vFrame0, vFrameWeights.x, impostorAlbedo, impostorNormalSum, impostorDepthSum, impostorPaintSum);
sampleImpostorFrame(vFrame1, vFrameWeights.y, impostorAlbedo, impostorNormalSum, impostorDepthSum, impostorPaintSum);
sampleImpostorFrame(vFrame2, vFrameWeights.z, impostorAlbedo, impostorNormalSum, impostorDepthSum, impostorPaintSum);
#endif
float impostorCoverage = max(impostorAlbedo.a, 1e-4);
// The instance tint, mixed from the trunk to the crown palette tint by the
// baked crown mask like scenery-mesh-color-fragment.glsl.
vec3 impostorTint = vTint;
#ifdef SCENERY_PALETTE
impostorTint = mix(vTint, vPaintTint, impostorPaintSum / impostorCoverage);
#endif
// <alphatest_fragment> discards or converts this coverage to MSAA samples.
diffuseColor.rgb = sRGBTransferEOTF(vec4(impostorAlbedo.rgb / impostorCoverage, 1.0)).rgb * impostorTint;
diffuseColor.a = impostorAlbedo.a;

// Surface position for the shadow lookup: the baked depth moves the quad
// point along the view ray (positive toward the eye).
float impostorDepth = impostorDepthSum / impostorCoverage * 2.0 - 1.0;
vec3 impostorShadowPosition = vShadowPosition + normalize(vShadowView) * impostorDepth * vShadowDepthScale;

// Atmosphere clamp shared with the terrain. Clouds skip it: clamping their
// light albedo to the atmosphere color would tint them; only fog fades them.
#ifndef SCENERY_NO_ATMOSPHERE_CLAMP
diffuseColor.rgb = mix(min(uAtmosphere, diffuseColor.rgb), diffuseColor.rgb, smoothstep(700.0, 400.0, distanceFromCamera));
#endif
