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

// Interleaved gradient noise (Jimenez 2014) rotates the kernel per pixel.
float getSceneryShadowNoise() {
	return fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
}

// Vogel-disk PCF; each tap is a bilinear hardware comparison.
float sampleSceneryShadowCascade(
	sampler2DShadow map,
	mat4 shadowMatrix,
	vec3 position,
	float radiusUv,
	float depthBias,
	float rotation,
	int taps
) {
	vec3 coord = (shadowMatrix * vec4(position, 1.0)).xyz;
	float reference = clamp(coord.z - depthBias, 0.0, 1.0);
	float lit = 0.0;
	for (int i = 0; i < taps; i++) {
		float radius = taps == 1 ? 0.0 : sqrt((float(i) + 0.5) / float(taps));
		float angle = float(i) * 2.39996323 + rotation;
		vec2 offset = vec2(cos(angle), sin(angle)) * radius * radiusUv;
		lit += texture(map, vec3(coord.xy + offset, reference));
	}
	return lit / float(taps);
}

// Visibility of the shadowing light in [0, 1]. `selfBias` (world units) lets
// scenery ignore its own flat caster quad. The near cascade hands over to the
// far one in a radial band, the far one fades to lit at its edge, and the
// whole result fades out with distance from the plane, so no transition has a
// hard edge.
float getSceneryShadow(vec3 position, float selfBias, int tapsNear, int tapsFar) {
	if (uSceneryShadowStrength <= 0.0) return 1.0;
	float planeDistance = length(position.xz - uCamera.xz);
	float fade = 1.0 - smoothstep(uSceneryShadowFade.x, uSceneryShadowFade.y, planeDistance);
	if (fade <= 0.0) return 1.0;

	float softness = mix(
		uSceneryShadowSoftness.x,
		uSceneryShadowSoftness.y,
		smoothstep(0.0, uSceneryShadowFade.y, planeDistance)
	);
	float rotation = 6.28318531 * getSceneryShadowNoise();
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
			tapsFar
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
			tapsNear
		);
		visibility = mix(visibility, nearLit, nearWeight);
	}
	return mix(1.0, visibility, fade * uSceneryShadowStrength);
}
