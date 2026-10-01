// Complementary screen-door cross-fade between an impostor and its near mesh.
// Both read the same noise for a pixel: the mesh keeps it where the noise is
// below the fade and the impostor keeps the rest, so the two never overlap or
// leave a gap and need no blending or sorting.
varying vec2 vSceneryDither;

// Interleaved gradient noise (Jimenez 2014) in [0, 1). The per-instance shift
// keeps overlapping instances from sharing one pattern.
float getSceneryDitherNoise() {
	vec2 shift = floor(fract(vSceneryDither.y * vec2(7.31, 11.17)) * 64.0);
	vec2 pixel = floor(gl_FragCoord.xy) + shift;
	return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
}
