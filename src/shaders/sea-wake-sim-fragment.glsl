// One step of the airplane's wake (src/seaWake.js, rules in
// src/seaWakePolicy.js), per texel of the map centered on the airplane: the
// previous state, scrolled by whole texels to the new window, runs one step
// of a damped wave equation, its foam decays and spreads, then the airplane
// stamps the segment it flew during the step. A radial sponge absorbs both
// toward the edge. Texel rows run along world +z.

// The previous state: x height, y its rate, z foam.
uniform sampler2D uState;
// Texels the state moved by: the new window's texel index minus the old's.
uniform vec2 uShift;
// 1 when the previous state is stale (the first step after idling, a reset).
uniform float uReset;
// x: c² dt / texel², y: dt (seconds), z: the waves' decay over the step,
// w: the foam's.
uniform vec4 uWave;
// x: radius (share of the half-size) where the sponge starts, y: its extra
// decay over the step at full strength, z: the foam's spread over the step
// (getSeaWakeFoamSpread()), w: world units per texel.
uniform vec4 uSponge;
// The readers' radial fade (shares of the half-size), which the stamp follows.
uniform vec2 uFade;
// The segment the airplane flew during the step, in the new window's texel
// coordinates: a (xy) to b (zw).
uniform vec4 uStampSegment;
// x: the kick's radius (texels), y: its height, z: the foam's radius
// (texels), w: the foam's amount.
uniform vec4 uStamp;
// x, y: the pulse's phase at a and b, z: its mix (getSeaWakePulse()).
uniform vec3 uStampPulse;

layout(location = 0) out vec4 outState;
// The readers' map: x, z slopes (height units per world unit), height, foam.
layout(location = 1) out vec4 outSurface;

// Out-of-range texelFetch() is undefined: the water beyond the map is calm.
vec4 readState(ivec2 p, ivec2 size) {
	if (any(lessThan(p, ivec2(0))) || any(greaterThanEqual(p, size))) return vec4(0.0);
	return texelFetch(uState, p, 0);
}

// (1 - (d / r)²)², 1 on the track and 0 from `radius` on.
float getStampBump(float distance, float radius) {
	float t = clamp(distance / max(radius, 1e-3), 0.0, 1.0);
	float s = 1.0 - t * t;
	return s * s;
}

void main() {
	ivec2 size = textureSize(uState, 0);
	ivec2 p = ivec2(gl_FragCoord.xy) + ivec2(uShift);
	vec4 center = vec4(0.0);
	vec4 left = vec4(0.0);
	vec4 right = vec4(0.0);
	vec4 down = vec4(0.0);
	vec4 up = vec4(0.0);
	if (uReset < 0.5) {
		center = readState(p, size);
		left = readState(p - ivec2(1, 0), size);
		right = readState(p + ivec2(1, 0), size);
		down = readState(p - ivec2(0, 1), size);
		up = readState(p + ivec2(0, 1), size);
	}

	// Radial position in the map: 0 at the center, 1 at the middle of an edge.
	vec2 offset = gl_FragCoord.xy / vec2(size) * 2.0 - 1.0;
	float radius = length(offset);
	float sponge = smoothstep(uSponge.x, 1.0, radius);
	float spongeDecay = mix(1.0, uSponge.y, sponge);

	// Symplectic Euler: the rate first, then the height with the new rate.
	// Damping both halves any leftover mean level too.
	float laplacian = left.x + right.x + down.x + up.x - 4.0 * center.x;
	float decay = uWave.z * spongeDecay;
	float rate = (center.y + uWave.x * laplacian) * decay;
	float height = (center.x + rate * uWave.y) * decay;

	// Explicit diffusion of the foam (a convex mix for a spread up to 1).
	float foamMean = 0.25 * (left.z + right.z + down.z + up.z);
	float foam = mix(center.z, foamMean, uSponge.z) * uWave.w * spongeDecay;

	// The stamp: the airplane's track during the step, faded like the readers.
	vec2 a = uStampSegment.xy;
	vec2 ab = uStampSegment.zw - a;
	float along = clamp(dot(gl_FragCoord.xy - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
	float distance = length(gl_FragCoord.xy - (a + ab * along));
	float fade = 1.0 - smoothstep(uFade.x, uFade.y, radius);
	if (uStamp.y != 0.0 && distance < uStamp.x) {
		float pulse = mix(-1.0, sin(mix(uStampPulse.x, uStampPulse.y, along)), uStampPulse.z);
		height += uStamp.y * pulse * getStampBump(distance, uStamp.x) * fade;
	}
	if (uStamp.w > 0.0 && distance < uStamp.z) {
		foam = max(foam, uStamp.w * getStampBump(distance, uStamp.z) * fade);
	}

	outState = vec4(height, rate, foam, 0.0);
	// Slopes and height of the same (scrolled) state, so the readers' crest
	// phase stays consistent; one step behind, which never shows.
	vec2 slope = vec2(right.x - left.x, up.x - down.x) * (0.5 / uSponge.w);
	outSurface = vec4(slope, center.x, foam);
}
