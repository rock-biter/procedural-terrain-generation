// The frozen sea of the ice biome, shared by the terrain's vertex (still
// waves) and fragment (sea-ice-pars-fragment.glsl) shaders. The settings are
// params.seaIce, written by updateSeaIceUniforms() (src/sharedUniforms.js);
// src/seaIcePolicy.js mirrors the sheet on the CPU.
#ifndef SEA_ICE_PARS
#define SEA_ICE_PARS

// x: shelf (depth the sheet covers deep in the ice), y: fade (ice field value
// where shelf and band reach full size), z: floe band depth beyond the sheet,
// w: floe cell size in world units. The shelf and band deepen at night.
uniform vec4 uSeaIceShape;
// x, y: crack width in world units at the sheet edge and at the band's outer
// limit (narrower at night), z: edge wobble in units of depth, w: its
// frequency per world unit.
uniform vec4 uSeaIceEdge;

// Share of the full shelf and band at ice field value `iceValue`: 0 at and
// outside the ice border; getSeaIceAmount() in src/seaIcePolicy.js.
float getSeaIceAmount(float iceValue) {
	return smoothstep(0.0, max(uSeaIceShape.y, 1e-6), iceValue);
}

// How still the sea surface stays at raw terrain height `height`: 1 under the
// sheet up to where its cracks start opening (half a band inside its edge,
// applySeaIce()), then easing smoothly through the floe band, so the floes
// ride a little of the waves that grows seaward, to 0 a few units of depth
// beyond the band's outer limit and its wobble.
float getSeaIceStill(float height, float iceValue) {
	float amount = getSeaIceAmount(iceValue);
	if (amount <= 0.0) return 0.0;
	float edge = height + uSeaIceShape.x * amount;
	float band = uSeaIceShape.z * amount;
	float reach = band + uSeaIceEdge.z * amount;
	return smoothstep(0.0, 0.2, amount) * smoothstep(-reach - 3.0, 0.5 * band, edge);
}
#endif
