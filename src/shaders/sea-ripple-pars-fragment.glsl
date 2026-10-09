// The sea's fragment details (color-fragment.glsl, normal-fragment-map.glsl):
// the moving surface (sea-surface-pars.glsl), its whitecaps and ribbed ripples,
// and the foam lines of the coast and the sea rocks. Every setting comes per
// sea type (0 the sea, 1 the deep ocean), blended by getSeaOceanMask(); see
// src/seaSurfacePolicy.js.
#include ./sea-surface-pars.glsl

// The sea state and the ripples' phase noise, interpolated from the vertices
// (project-vertex.glsl).
varying float vSeaState;
varying float vSeaRippleNoise;

// Linear color of the foam lines and the whitecaps.
uniform vec3 uSeaFoamColor;
// Foam lines, per type. Band: depths (positive) where the lines start, are
// full, start fading, and end.
uniform vec4 uSeaFoamLineBand[SEA_SURFACE_TYPE_COUNT];
// x: lines per unit of depth, y: their speed, z, w: wobble frequency (per
// world unit) and amount (radians).
uniform vec4 uSeaFoamLineMotion[SEA_SURFACE_TYPE_COUNT];
// x: sharpness (power), y: intensity, z: sea state boost (±).
uniform vec4 uSeaFoamLineStyle[SEA_SURFACE_TYPE_COUNT];
// x: dash noise frequency (per world unit), y: its weight.
uniform vec2 uSeaFoamLineDash[SEA_SURFACE_TYPE_COUNT];
// Ripples of the sea's normal map, per type. x: amplitude across the ribs and
// y: wavelength along them (world units), z: speed (world units per second),
// w: irregularity (radians of phase noise).
uniform vec4 uSeaRipples[SEA_SURFACE_TYPE_COUNT];
// Whitecaps, per type. x: crest squeeze where they start, y: softness, z:
// intensity, w: frequency of the breakup noise (per world unit).
uniform vec4 uSeaWhitecaps[SEA_SURFACE_TYPE_COUNT];
// The least of the sea's details, per type, whatever the sea state. x: the
// whitecaps' share left on the highest crests of calm water, y: the ribbed
// map's strength.
uniform vec2 uSeaMinimum[SEA_SURFACE_TYPE_COUNT];

// The sea rock ripples: the foam lines also circle the sea rocks, on one sea
// height: the coast's raw height fused with the sea rocks (src/seaFoam.js,
// rules in src/seaFoamPolicy.js), whose distance comes from the foam map. The
// lines are contours of that single height, so the coast's lines bend around
// the rocks and merge with theirs instead of crossing them.
// Positions are flat world space (before the curvature), like the map.
uniform sampler2D uSeaFoamMap;
// xy: covered square center XZ, z: its half-size.
uniform vec3 uSeaFoamWindow;
// x: reach (world units the map holds beyond a rock's edge), y: sea height at
// the rock's edge, z: how far the height may move from it per world unit away
// from the rock, w: weight of the rocks in the fused height (0 disables every
// lookup).
uniform vec4 uSeaFoamShape;
// Height range over which the coast and the rocks blend (smooth maximum).
uniform float uSeaFoamBlend;

// Foam line brightness at sea height `seaHeight`, flat world `xz`, deep ocean
// share `oceanMask`, and sea state `state`: animated contour lines that run
// toward the coast within the depth band, wobbling and broken into dashes.
float getSeaRipple(float seaHeight, vec2 xz, float oceanMask, float state) {
	vec4 band = mix(uSeaFoamLineBand[0], uSeaFoamLineBand[1], oceanMask);
	float depth = -seaHeight;
	float inBand = smoothstep(band.x, band.y, depth) - smoothstep(band.z, band.w, depth);
	if (inBand <= 0.0) return 0.0;
	vec4 motion = mix(uSeaFoamLineMotion[0], uSeaFoamLineMotion[1], oceanMask);
	vec4 style = mix(uSeaFoamLineStyle[0], uSeaFoamLineStyle[1], oceanMask);
	vec2 dash = mix(uSeaFoamLineDash[0], uSeaFoamLineDash[1], oceanMask);
	float wobble = (sin(xz.x * motion.z) + sin(xz.y * motion.z)) * motion.w;
	float ripple = sin(seaHeight * motion.x - uTime * motion.y + wobble) * 0.5 + 0.5;
	ripple = pow(ripple, style.x) * inBand;
	float dashes = max(1.0 - dash.y * snoise(xz * dash.x), 0.0);
	return ripple * dashes * style.y * mix(1.0 - style.z, 1.0 + style.z, state);
}

// Strength of the sea's normal map in sea state `state`, never below the
// type's minimum.
float getSeaRippleBoost(float oceanMask, float state) {
	float boost = mix(uSeaRippleDetail[0].y, uSeaRippleDetail[1].y, oceanMask);
	float minimum = mix(uSeaMinimum[0].y, uSeaMinimum[1].y, oceanMask);
	return max(mix(1.0 - boost, 1.0 + boost, state), minimum);
}

// Offset of the sea normal map's world uv `uv` (x, -z, normal-fragment-map.glsl)
// that snakes its ribs: across them, along the texture's u axis on the ground
// (uTerrainNormalRotation[0]), by a wave running along them, its phase broken
// by `noise` (vSeaRippleNoise), `strength` times the amplitude.
vec2 getSeaRippleWarp(vec2 uv, float noise, float oceanMask, float strength) {
	vec4 ripples = mix(uSeaRipples[0], uSeaRipples[1], oceanMask);
	vec2 across = uTerrainNormalRotation[0];
	vec2 along = vec2(-across.y, across.x);
	float phase = 6.2831853 / ripples.y * (dot(uv, along) - ripples.z * uTime) + ripples.w * noise;
	return across * (ripples.x * strength * sin(phase));
}

// Whitecap coverage of the waves `waves` at flat world `xz`: they break where
// the crests squeeze the surface beyond the threshold, in rough water, and a
// thinner foam (the type's minimum) stays on the highest crests of any water,
// placed by the squeeze over its peak, so calm open water keeps some. Both
// are broken by a slowly drifting noise, the thinner foam into sparser dabs,
// and fade out before the noise gets finer than a few pixels (`pixel`, the
// pixel's size on the ground), instead of sparkling. The coast and the ice
// calm the thinner foam with the waves.
float getSeaWhitecap(SeaWaves waves, vec2 xz, float oceanMask, float pixel) {
	vec4 caps = mix(uSeaWhitecaps[0], uSeaWhitecaps[1], oceanMask);
	float fade = 1.0 - smoothstep(0.15, 0.35, pixel * caps.w);
	float breaking = smoothstep(caps.x - caps.y, caps.x + caps.y, waves.squeeze);
	float minimum = mix(uSeaMinimum[0].x, uSeaMinimum[1].x, oceanMask);
	float crest = waves.squeeze / max(waves.peak, 1e-5);
	float calm = minimum * waves.amount * smoothstep(0.5, 0.8, crest);
	if (max(breaking, calm) * fade <= 0.0) return 0.0;
	float noise = snoise(xz * caps.w + uTime * 0.05);
	float foam = max(breaking * smoothstep(0.0, 0.6, noise), calm * smoothstep(0.25, 0.7, noise));
	return foam * fade * caps.z;
}

// The sea painted by the debug view `view` (SEA_SURFACE_DEBUG_VIEWS in
// src/seaSurfacePolicy.js): the sea state, the deep ocean mask (blue sea, red
// deep ocean), the share of the waves the coast and the ice leave, or the
// crest squeeze.
vec3 getSeaSurfaceDebug(int view, float state, float oceanMask, SeaWaves waves) {
	if (view == 1) return vec3(state);
	if (view == 2) return mix(vec3(0.1, 0.3, 1.0), vec3(1.0, 0.2, 0.1), oceanMask);
	if (view == 3) return vec3(waves.amount);
	return vec3(clamp(waves.squeeze * 2.0, 0.0, 1.0));
}

// Polynomial smooth maximum and minimum: max(a, b) and min(a, b), rounded
// where they are less than `blend` apart, so contour lines meet in curves
// instead of corners.
float getSmoothMax(float a, float b, float blend) {
	float h = max(blend - abs(a - b), 0.0) / max(blend, 1e-4);
	return max(a, b) + h * h * blend * 0.25;
}

float getSmoothMin(float a, float b, float blend) {
	return -getSmoothMax(-a, -b, blend);
}

// Sea height for the foam lines at a point of raw height `height`: the raw
// height on land, without a rock within reach, or outside the map. Near a
// rock it is the raw height clamped (smoothly) between `edge - slope * d` and
// `edge + slope * d`, d being the distance from the rock's edge: a double cone
// that holds the sea at the rock's edge height next to it and lets it return
// to the raw height farther out. Over deep water the rock raises the sea like
// an islet, so the coast's lines circle it; over shallow water it lowers it,
// so a rock near the beach still gets its own lines. The rocks' weight fades
// over the outer quarter of the reach and near the edge of the covered square,
// where the cone is already wider than the lines, so no seam shows.
float getSeaFoamHeight(float height, vec2 xz) {
	if (uSeaFoamShape.w <= 0.0 || height >= 0.0) return height;
	vec2 offset = (xz - uSeaFoamWindow.xy) / uSeaFoamWindow.z;
	float edge = max(abs(offset.x), abs(offset.y));
	if (edge >= 0.97) return height;
	float closeness = texture2D(uSeaFoamMap, offset * 0.5 + 0.5).r;
	if (closeness <= 0.0) return height;
	float spread = (1.0 - closeness) * uSeaFoamShape.x * uSeaFoamShape.z;
	float fused = getSmoothMax(height, uSeaFoamShape.y - spread, uSeaFoamBlend);
	fused = getSmoothMin(fused, uSeaFoamShape.y + spread, uSeaFoamBlend);
	float weight = smoothstep(0.0, 0.25, closeness) * (1.0 - smoothstep(0.85, 0.97, edge)) * uSeaFoamShape.w;
	return mix(height, fused, weight);
}
