// Depth taps over the sun's disc, shared by the lens flare's occlusion pass
// and its debug view (src/lensFlareEffect.js). LENS_FLARE_TAPS comes from
// the material defines. Guarded: both shaders include it once.
#ifndef LENS_FLARE_TAPS_PARS
#define LENS_FLARE_TAPS_PARS

// The sky dome writes no depth (src/dayNight.js), so its pixels keep the
// cleared 1.0; everything drawn lies within about 5000 units of the eye, well
// below this depth.
const float LENS_FLARE_SKY_DEPTH = 0.99999;

// UV of tap `index` on a golden-angle (Vogel) disc: `sunScreen` xy is the
// sun's UV, zw the disc's UV radius per axis.
vec2 getLensFlareTap(int index, vec4 sunScreen) {
	float radius = sqrt((float(index) + 0.5) / float(LENS_FLARE_TAPS));
	float angle = float(index) * 2.39996323;
	return sunScreen.xy + vec2(cos(angle), sin(angle)) * radius * sunScreen.zw;
}

#endif
