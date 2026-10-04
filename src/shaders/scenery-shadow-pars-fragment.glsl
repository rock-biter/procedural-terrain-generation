// Scenery shadow lookup shared by the terrain, near scenery meshes, and
// impostors (src/sceneryShadows.js, rules in src/shadowPolicy.js). Positions
// are flat world space (before the curvature), like the shadow maps.
// Array sizes match SCENERY_SHADOW_CASCADE_COUNT: 0 near, 1 far.
uniform sampler2DShadow uSceneryShadowMaps[2];
uniform mat4 uSceneryShadowMatrices[2];
// xy: cascade center XZ, z: covered disk radius, w: shadow-map UV per unit.
uniform vec4 uSceneryShadowCascades[2];
// Normalized light depth per world unit.
uniform float uSceneryShadowDepthScale[2];
// 0 disables every lookup; includes the light-elevation fade.
uniform float uSceneryShadowStrength;
// World direction toward the shadowing light (sun or moon).
uniform vec3 uSceneryShadowLight;
// Distance from the plane where shadows start to weaken (x) and vanish (y).
uniform vec2 uSceneryShadowFade;
// Penumbra radius in world units, near (x) and at the fade end (y).
uniform vec2 uSceneryShadowSoftness;
// Constant depth bias in world units.
uniform float uSceneryShadowBias;
varying vec3 vShadowPosition;

#include ./interleaved-gradient-noise.glsl

// PCF samples per cascade come from the material defines
// SCENERY_SHADOW_TAPS_NEAR and SCENERY_SHADOW_TAPS_FAR
// (getSceneryShadowTapDefines() in src/shadowPolicy.js), at most 16. Unshadowed
// materials (SCENERY_NO_SHADOWS) include this chunk without them and get only
// the declarations above.
#ifdef SCENERY_SHADOW_TAPS_NEAR


// Golden-angle (Vogel) spiral: tap i at angle i * 2.39996323 and radius
// sqrt(i + 0.5). A kernel of n taps divides the first n by sqrt(n), so tap i
// lands at sqrt((i + 0.5) / n) of the penumbra radius. Precomputed, so no tap
// evaluates a trigonometric function.
const vec2 SCENERY_SHADOW_SPIRAL[16] = vec2[16](
	vec2(0.7071068, 0.0000000),
	vec2(-0.9030888, 0.8273033),
	vec2(0.1382322, -1.5750847),
	vec2(1.1382849, 1.4846911),
	vec2(-2.0888927, -0.3694957),
	vec2(1.9787816, -1.2587389),
	vec2(-0.6618637, 2.4621000),
	vec2(-1.2622459, -2.4303776),
	vec2(2.7385686, 1.0001209),
	vec2(-2.8490243, 1.1760358),
	vec2(1.3734180, -2.9349145),
	vec2(1.0149210, 3.2357280),
	vec2(-3.0589836, -1.7727435),
	vec2(3.5885359, -0.7889295),
	vec2(-2.1900276, 3.1150889),
	vec2(-0.5059471, -3.9043588)
);

// Vogel-disk PCF; each tap is a bilinear hardware comparison. `rotation` is
// the per-pixel kernel rotation, shared by both cascades; one tap samples the
// center.
float sampleSceneryShadowCascade(
	sampler2DShadow map,
	mat4 shadowMatrix,
	vec3 position,
	float radiusUv,
	float depthBias,
	mat2 rotation,
	int taps
) {
	vec3 coord = (shadowMatrix * vec4(position, 1.0)).xyz;
	float reference = clamp(coord.z - depthBias, 0.0, 1.0);
	if (taps == 1) return texture(map, vec3(coord.xy, reference));
	mat2 kernel = rotation * (radiusUv * inversesqrt(float(taps)));
	float lit = 0.0;
	for (int i = 0; i < taps; i++) {
		lit += texture(map, vec3(coord.xy + kernel * SCENERY_SHADOW_SPIRAL[i], reference));
	}
	return lit / float(taps);
}

// Visibility of the shadowing light in [0, 1]. `selfBias` (world units) lets
// scenery ignore its own flat caster quad. The near cascade hands over to the
// far one in a radial band, the far one fades to lit at its edge, and the
// whole result fades out with distance from the plane, so no transition has a
// hard edge.
float getSceneryShadow(vec3 position, float selfBias) {
	if (uSceneryShadowStrength <= 0.0) return 1.0;
	float planeDistance = length(position.xz - uCamera.xz);
	float fade = 1.0 - smoothstep(uSceneryShadowFade.x, uSceneryShadowFade.y, planeDistance);
	if (fade <= 0.0) return 1.0;

	float softness = mix(
		uSceneryShadowSoftness.x,
		uSceneryShadowSoftness.y,
		smoothstep(0.0, uSceneryShadowFade.y, planeDistance)
	);
	// Interleaved gradient noise rotates the kernel per pixel.
	float angle = 6.28318531 * interleavedGradientNoise(gl_FragCoord.xy);
	float cosine = cos(angle);
	float sine = sin(angle);
	mat2 rotation = mat2(cosine, sine, -sine, cosine);
	float bias = uSceneryShadowBias + selfBias;
	vec4 nearCascade = uSceneryShadowCascades[0];
	vec4 farCascade = uSceneryShadowCascades[1];
	float nearWeight = 1.0 - smoothstep(nearCascade.z * 0.75, nearCascade.z * 0.95, length(position.xz - nearCascade.xy));
	float farWeight = 1.0 - smoothstep(farCascade.z * 0.85, farCascade.z * 0.98, length(position.xz - farCascade.xy));

	float visibility = 1.0;
	if (nearWeight < 1.0 && farWeight > 0.0) {
		float farLit = sampleSceneryShadowCascade(
			uSceneryShadowMaps[1],
			uSceneryShadowMatrices[1],
			position,
			softness * farCascade.w,
			bias * uSceneryShadowDepthScale[1],
			rotation,
			SCENERY_SHADOW_TAPS_FAR
		);
		visibility = mix(1.0, farLit, farWeight);
	}
	if (nearWeight > 0.0) {
		float nearLit = sampleSceneryShadowCascade(
			uSceneryShadowMaps[0],
			uSceneryShadowMatrices[0],
			position,
			softness * nearCascade.w,
			bias * uSceneryShadowDepthScale[0],
			rotation,
			SCENERY_SHADOW_TAPS_NEAR
		);
		visibility = mix(visibility, nearLit, nearWeight);
	}
	return mix(1.0, visibility, fade * uSceneryShadowStrength);
}

#endif
