// The airplane's wake on the sea (src/seaWake.js, rules in
// src/seaWakePolicy.js), read by the terrain's vertex (heights) and fragment
// (normals, foam) shaders and by the boats (getSeaFloatPose()), through
// sea-surface-pars.glsl. The map covers a square around the airplane in flat
// world space and holds, per texel, the wake's slopes, height, and foam.
// Every lookup is skipped while the wake idles and outside the rectangle it
// can occupy, and fades radially toward the map's edge, so the wake never
// ends on a straight line.
#ifndef SEA_WAKE_PARS
#define SEA_WAKE_PARS

// x, z slopes (height units per world unit), height (about -1 to 1), foam.
uniform sampler2D uSeaWakeMap;
// xy: the map's center (flat world XZ), z: 1 / its side, w: 1 / its half-size.
uniform vec4 uSeaWakeWindow;
// The rectangle the wake can occupy (flat world XZ): min x, min z, max x,
// max z; empty while it idles.
uniform vec4 uSeaWakeBounds;
// x: the terrain vertices' lift per height unit (world units, 0 skips the
// vertex lookup), y: the normals' (the slopes' scale), z: 1 / the shore depth
// over which the wake comes in from the coast, w: 1 while the wake runs.
uniform vec4 uSeaWakeShape;
// x, y: radial fade start and end (shares of the half-size), z: 1 / the
// width (world units) of the fade inside the occupied rectangle's edge.
uniform vec4 uSeaWakeFade;
// x: the boats' heave per height unit (world units), y: their tilt's scale.
uniform vec2 uSeaWakeBoat;

// The wake at flat world `xz`, `depth` world units deep (the raw height's
// opposite): slopes, height, and foam, already scaled by `fade`, the share
// the radial fade, the occupied rectangle's edge, and the shore leave.
// textureLod(): the callers sit in non-uniform control flow.
vec4 getSeaWake(vec2 xz, float depth, out float fade) {
	fade = 0.0;
	if (uSeaWakeShape.w <= 0.0 || depth <= 0.0) return vec4(0.0);
	vec4 inside = vec4(xz - uSeaWakeBounds.xy, uSeaWakeBounds.zw - xz);
	float edge = min(min(inside.x, inside.y), min(inside.z, inside.w));
	if (edge <= 0.0) return vec4(0.0);
	vec2 offset = xz - uSeaWakeWindow.xy;
	fade = (1.0 - smoothstep(uSeaWakeFade.x, uSeaWakeFade.y, length(offset) * uSeaWakeWindow.w))
		* smoothstep(0.0, 1.0, edge * uSeaWakeFade.z)
		* smoothstep(0.0, 1.0, depth * uSeaWakeShape.z);
	if (fade <= 0.0) return vec4(0.0);
	return textureLod(uSeaWakeMap, offset * uSeaWakeWindow.z + 0.5, 0.0) * fade;
}
#endif
