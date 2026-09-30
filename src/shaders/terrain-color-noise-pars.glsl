// Soft lighter patches over the land colors; params.terrainColorNoise in
// main.js drives these uniforms.
// World frequency of the noise (cycles per world unit, roughly).
uniform float uColorNoiseFrequency;
// Brightening inside the patches: 0 = none, 1 = twice as bright.
uniform float uColorNoiseIntensity;
// Noise value in [0, 1] above which the terrain lightens; higher = fewer patches.
uniform float uColorNoiseThreshold;
// Half-width of the transition around the threshold, in noise units.
uniform float uColorNoiseSoftness;
// Drift in noise units per second (uTime); 0 freezes the patches.
uniform float uColorNoiseSpeed;

// Two octaves of simplex noise mapped to about [0, 1]. They drift in
// different directions and at different rates, so the patches slowly change
// shape instead of sliding as a whole.
float getTerrainColorNoise(vec2 xz) {
	vec2 p = xz * uColorNoiseFrequency;
	float drift = uTime * uColorNoiseSpeed;
	float n = snoise(p + 71.3 + vec2(1.0, 0.4) * drift) * 0.65
		+ snoise(p * 2.7 - 19.1 + vec2(-0.6, 1.3) * drift) * 0.35;
	return n * 0.5 + 0.5;
}

// Brightness factor in [1, 1 + intensity], smooth across the threshold.
// Multiplying keeps the hue and leaves the black band lines black.
float getTerrainColorShade(vec2 xz) {
	float softness = max(uColorNoiseSoftness, 1e-3);
	float mask = smoothstep(uColorNoiseThreshold - softness, uColorNoiseThreshold + softness, getTerrainColorNoise(xz));
	return 1.0 + uColorNoiseIntensity * mask;
}
