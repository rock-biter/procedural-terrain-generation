// Sea ripples of the terrain shader (color-fragment.glsl), drawn on one sea
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

// Ripple brightness at sea height `seaHeight`: animated lines along the
// heights from -3.5 to -7.5, broken into dashes.
float getSeaRipple(float seaHeight, vec2 xz) {
	float ripple = sin(seaHeight * 8. - uTime * 4. + sin(xz.x * 0.5) + sin(xz.y * 0.5)) * 0.5 + 0.5;
	ripple *= ripple * ripple * ripple;
	float d = - 3.5;
	ripple *= smoothstep(d, d - 1.5, seaHeight) - smoothstep(d - 3., d - 4., seaHeight);
	return mix(ripple * 0.5, 0., sin(seaHeight + xz.x * 0.2));
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

// Sea height for the ripples at a point of raw height `height`: the raw
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
