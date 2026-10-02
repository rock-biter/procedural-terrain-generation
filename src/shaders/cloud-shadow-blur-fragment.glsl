// One axis of the separable Gaussian blur that softens the cloud shadow
// coverage map (src/cloudShadows.js). CLOUD_SHADOW_MAX_BLUR (define) bounds
// the half-width in texels.
uniform sampler2D tSource;
// One texel along the blur axis, in UV.
uniform vec2 uStep;
// Half-width in texels; 0 copies the source.
uniform float uRadius;
varying vec2 vUv;

void main() {
	float sigma = max(uRadius * 0.5, 1e-3);
	float sum = 0.0;
	float weightSum = 0.0;
	for (int i = -CLOUD_SHADOW_MAX_BLUR; i <= CLOUD_SHADOW_MAX_BLUR; i++) {
		float offset = float(i);
		if (abs(offset) > uRadius + 0.5) continue;
		float weight = exp(-offset * offset / (2.0 * sigma * sigma));
		sum += texture2D(tSource, vUv + uStep * offset).r * weight;
		weightSum += weight;
	}
	gl_FragColor = vec4(sum / weightSum, 0.0, 0.0, 1.0);
}
