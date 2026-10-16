// The lens flare's occlusion (src/lensFlareEffect.js), drawn into a single
// texel: the share of the sun's disc the scene leaves on the sky, blended
// with the previous frame's for a steady flare. The horizon clouds write no
// depth (they are part of the sky), so their coverage over each tap's view
// direction hides it too, in part along their soft edges.
#include ./lens-flare-taps.glsl
#include ./horizon-clouds-pars.glsl

// The scene's resolved depth (the composer's input buffer).
uniform sampler2D depthBuffer;
// The other texel of the ping-pong pair.
uniform sampler2D previousVisibility;
// xy: the sun's UV, zw: the disc's UV radius.
uniform vec4 sunScreen;
// Weight of the previous visibility; 0 starts over.
uniform float history;
// The camera's world matrix and inverse projection, which turn a tap's UV into
// its view direction.
uniform mat4 cameraWorld;
uniform mat4 projectionInverse;
// x: 1 while the sun's disc reaches into the clouds' band
// (shouldTestHorizonClouds()), y: the angle between taps (radians).
uniform vec2 cloudTest;

vec3 getTapDirection(vec2 uv) {
	vec4 view = projectionInverse * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
	return normalize(mat3(cameraWorld) * (view.xyz / view.w));
}

void main() {
	float visible = 0.0;
	float counted = 0.0;
	for (int i = 0; i < LENS_FLARE_TAPS; i++) {
		vec2 uv = getLensFlareTap(i, sunScreen);
		// Off screen nothing is known; the edge fade dims the flare there.
		if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) continue;
		counted += 1.0;
		float sky = step(LENS_FLARE_SKY_DEPTH, texture2D(depthBuffer, uv).r);
		if (cloudTest.x > 0.5 && sky > 0.0) {
			sky *= 1.0 - getHorizonCloudCoverage(getTapDirection(uv), cloudTest.y);
		}
		visible += sky;
	}
	float current = counted > 0.0 ? visible / counted : 0.0;
	float previous = texture2D(previousVisibility, vec2(0.5)).r;
	gl_FragColor = vec4(mix(current, previous, history), 0.0, 0.0, 1.0);
}
