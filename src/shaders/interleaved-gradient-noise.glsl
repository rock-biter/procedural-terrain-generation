// Interleaved gradient noise (Jimenez 2014) in [0, 1) at pixel position `p`.
// Guarded: several chunks of one program include it.
#ifndef INTERLEAVED_GRADIENT_NOISE
#define INTERLEAVED_GRADIENT_NOISE
float interleavedGradientNoise(vec2 p) {
	return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
#endif
