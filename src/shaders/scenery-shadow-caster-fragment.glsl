// Impostor shadow caster: keeps the texels the baked silhouette covers. Only
// depth is written (colorWrite is off), or, with SHADOW_CASTER_COVERAGE
// (cloud shadows), the fractional coverage in the red channel, combined with
// max blending.
uniform sampler2D uImpostorAlbedo;
varying vec4 vFrame0;
varying vec4 vFrame1;
varying vec4 vFrame2;
varying vec3 vFrameWeights;

const vec2 IMPOSTOR_ATLAS_FRAMES = vec2(
	float(IMPOSTOR_ATLAS_COLUMNS * IMPOSTOR_FRAMES),
	float(IMPOSTOR_ATLAS_ROWS * IMPOSTOR_FRAMES)
);

float getFrameCoverage(vec4 frame) {
	vec2 inside = step(vec2(0.0), frame.zw) * step(frame.zw, vec2(1.0));
	vec2 atlasUv = (frame.xy + clamp(frame.zw, 0.0, 1.0)) / IMPOSTOR_ATLAS_FRAMES;
	return texture2D(uImpostorAlbedo, atlasUv).a * inside.x * inside.y;
}

void main() {
#ifdef IMPOSTOR_SINGLE_FRAME
	vec4 dominantFrame = vFrameWeights.x >= max(vFrameWeights.y, vFrameWeights.z)
		? vFrame0
		: (vFrameWeights.y >= vFrameWeights.z ? vFrame1 : vFrame2);
	float coverage = getFrameCoverage(dominantFrame);
#else
	float coverage = getFrameCoverage(vFrame0) * vFrameWeights.x
		+ getFrameCoverage(vFrame1) * vFrameWeights.y
		+ getFrameCoverage(vFrame2) * vFrameWeights.z;
#endif
#ifdef SHADOW_CASTER_COVERAGE
	gl_FragColor = vec4(coverage, 0.0, 0.0, 1.0);
#else
	if (coverage < 0.5) discard;
	gl_FragColor = vec4(1.0);
#endif
}
