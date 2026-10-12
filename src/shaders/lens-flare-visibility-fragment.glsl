// The lens flare's occlusion (src/lensFlareEffect.js), drawn into a single
// texel: the share of the sun's disc the scene leaves on the sky, blended
// with the previous frame's for a steady flare.
#include ./lens-flare-taps.glsl

// The scene's resolved depth (the composer's input buffer).
uniform sampler2D depthBuffer;
// The other texel of the ping-pong pair.
uniform sampler2D previousVisibility;
// xy: the sun's UV, zw: the disc's UV radius.
uniform vec4 sunScreen;
// Weight of the previous visibility; 0 starts over.
uniform float history;

void main() {
	float visible = 0.0;
	float counted = 0.0;
	for (int i = 0; i < LENS_FLARE_TAPS; i++) {
		vec2 uv = getLensFlareTap(i, sunScreen);
		// Off screen nothing is known; the edge fade dims the flare there.
		if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) continue;
		counted += 1.0;
		visible += step(LENS_FLARE_SKY_DEPTH, texture2D(depthBuffer, uv).r);
	}
	float current = counted > 0.0 ? visible / counted : 0.0;
	float previous = texture2D(previousVisibility, vec2(0.5)).r;
	gl_FragColor = vec4(mix(current, previous, history), 0.0, 0.0, 1.0);
}
