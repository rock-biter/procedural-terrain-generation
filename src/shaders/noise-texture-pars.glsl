// The baked tileable noise (src/noiseTexture.js, rules in
// src/noiseTexturePolicy.js): four independent gradient-noise fields, one per
// channel, as spread and as fine per unit as snoise(), that repeat every
// 1 / NOISE_TILE_UV_SCALE (about 19) noise units. Purely visual noise samples
// it instead of evaluating snoise() per pixel; the fields tied to the CPU
// twins (src/biome.js, src/coast.js) never do.
#ifndef NOISE_TEXTURE
#define NOISE_TEXTURE

// Guarded apart: horizon-clouds-pars.glsl declares it too.
#ifndef NOISE_TEXTURE_SAMPLER
#define NOISE_TEXTURE_SAMPLER
uniform sampler2D uNoiseTexture;
#endif

// The four fields at `p`, in snoise() units, about [-1, 1]. `footprint` is the
// pixel's size in the same units, which picks the mip level: the callers sit
// in non-uniform control flow, where implicit derivatives are undefined, and
// a scalar footprint does not over-blur the noise seen at a grazing angle.
vec4 sampleNoiseTile(vec2 p, float footprint) {
	float lod = log2(max(footprint * NOISE_TILE_UV_SCALE * NOISE_TILE_SIZE, 1e-4));
	return textureLod(uNoiseTexture, p * NOISE_TILE_UV_SCALE, lod) * 2.0 - 1.0;
}

#endif
