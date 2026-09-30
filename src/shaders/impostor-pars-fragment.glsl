uniform sampler2D uImpostorAlbedo;
uniform sampler2D uImpostorNormal;
varying vec4 vFrame0;
varying vec4 vFrame1;
varying vec4 vFrame2;
varying vec3 vFrameWeights;
varying vec3 vTint;
varying vec3 vImpostorNormalX;
varying vec3 vImpostorNormalY;
varying vec3 vImpostorNormalZ;
varying vec3 vSphereNormal;

const vec2 IMPOSTOR_ATLAS_FRAMES = vec2(
	float(IMPOSTOR_ATLAS_COLUMNS * IMPOSTOR_FRAMES),
	float(IMPOSTOR_ATLAS_ROWS * IMPOSTOR_FRAMES)
);

// Accumulates one frame weighted by its coverage, so empty texels and rays
// that leave the frame do not darken the blend.
void sampleImpostorFrame(vec4 frame, float weight, inout vec4 albedoSum, inout vec3 normalSum) {
	vec2 inside = step(vec2(0.0), frame.zw) * step(frame.zw, vec2(1.0));
	vec2 atlasUv = (frame.xy + clamp(frame.zw, 0.0, 1.0)) / IMPOSTOR_ATLAS_FRAMES;
	vec4 albedo = texture2D(uImpostorAlbedo, atlasUv);
	vec3 normal = texture2D(uImpostorNormal, atlasUv).xyz * 2.0 - 1.0;
	float coverage = weight * albedo.a * inside.x * inside.y;
	albedoSum += vec4(albedo.rgb * coverage, coverage);
	normalSum += normal * coverage;
}

vec3 impostorSRGBToLinear(vec3 color) {
	return mix(
		color / 12.92,
		pow((color + 0.055) / 1.055, vec3(2.4)),
		step(vec3(0.04045), color)
	);
}
