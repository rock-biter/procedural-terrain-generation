// Complementary screen-door cross-fade between an impostor and its near mesh.
// Both read the same noise for a pixel: the mesh keeps it where the noise is
// below the fade and the impostor keeps the rest, so the two never overlap or
// leave a gap and need no blending or sorting.
varying vec2 vSceneryDither;

#include ./interleaved-gradient-noise.glsl

// The per-instance shift keeps overlapping instances from sharing one pattern.
float getSceneryDitherNoise() {
	vec2 shift = floor(fract(vSceneryDither.y * vec2(7.31, 11.17)) * 64.0);
	return interleavedGradientNoise(floor(gl_FragCoord.xy) + shift);
}
