// The sea's fragment details (color-fragment.glsl, normal-fragment-map.glsl):
// the moving surface (sea-surface-pars.glsl), its crest lines and ribbed ripples,
// and the foam lines of the coast and the sea rocks. Every setting comes per
// sea type (0 the sea, 1 the deep ocean), blended by getSeaOceanMask(); see
// src/seaSurfacePolicy.js.
#include ./sea-surface-pars.glsl
// The dashes, the crest flicker, and the fray sample the baked noise.
#include ./noise-texture-pars.glsl

// The sea state, the ripples' phase noise, and the waves' irregularity,
// interpolated from the vertices (project-vertex.glsl).
varying float vSeaState;
varying float vSeaRippleNoise;
varying vec2 vSeaWaveNoise;

// Linear color of the foam lines of the coast and the crests.
uniform vec3 uSeaFoamColor;
// The foam's fade with the distance, as the ink lines' (getTerrainLineFade()):
// x and y, the distances from the airplane (uCamera) where it starts thinning
// and where it is gone with the airplane at sea level; z, the width of the
// lines' edges in pixels there (one pixel near); w, how far both move out per
// unit of the airplane's altitude.
uniform vec4 uSeaFoamFade;
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
// The foam lines' fray, per type, like the crest lines'. x: amount (share of
// the half-width), y: frequency (per world unit).
uniform vec2 uSeaFoamLineFray[SEA_SURFACE_TYPE_COUNT];
// Ripples of the sea's normal map, per type. x: amplitude across the ribs and
// y: wavelength along them (world units), z: speed (world units per second),
// w: irregularity (radians of phase noise).
uniform vec4 uSeaRipples[SEA_SURFACE_TYPE_COUNT];
// World units per second the ribs drift along the map's v axis, the same for
// both types (normal-fragment-map.glsl).
uniform float uSeaRippleDrift;
// Foam lines along the crests, per type. x: crest height, as a share of the
// highest the waves that carry them (uSeaCrestWaves) reach there, where they
// start, y: softness, z: half-width (world units), w: intensity.
uniform vec4 uSeaCrestLines[SEA_SURFACE_TYPE_COUNT];
// The crest lines' flicker, per type. x: share of the lines it hides, y: its
// frequency (per world unit), z: its speed (noise units per second).
uniform vec3 uSeaCrestFlicker[SEA_SURFACE_TYPE_COUNT];
// The crest lines' fray, per type. x: amount (share of the half-width), y:
// frequency (per world unit).
uniform vec2 uSeaCrestFray[SEA_SURFACE_TYPE_COUNT];
// Breaking foam, per type. x: crest squeeze, as a share of the largest the
// waves reach there, where the crests break, y: softness, z: intensity, w:
// frequency of the foam's lace (per world unit).
uniform vec4 uSeaBreaking[SEA_SURFACE_TYPE_COUNT];
// The least of the sea's details, per type, whatever the sea state. x: the
// crest lines' presence in calm water, y: the ribbed map's strength, z: the
// breaking foam's presence in calm water.
uniform vec3 uSeaMinimum[SEA_SURFACE_TYPE_COUNT];
// Which foam the crests carry: 0 lines (getSeaCrestLine()), 1 breaking foam
// (getSeaBreakingFoam()), 2 both.
uniform float uSeaCrestFoam;

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

// The share of its width the foam keeps at `cameraDistance` (x, 1 near, 0
// far, where the foam is skipped) and the width of its lines' edges in pixels
// (y): the lines thin away instead of aliasing into a haze far out. The
// higher the airplane, the farther the fade: the sea is seen less edge-on
// and the curved horizon lies farther away.
vec2 getSeaFoamFade(float cameraDistance) {
	float reach = max(uCamera.y, 0.0) * uSeaFoamFade.w;
	float fade = 1.0 - smoothstep(uSeaFoamFade.x + reach, uSeaFoamFade.y + reach, cameraDistance);
	return vec2(fade, mix(uSeaFoamFade.z, 1.0, fade));
}

// Share of a pixel `pixel` world units wide, `distance` from a line's
// center, covered by the line `halfWidth` wide on each side: a box filter,
// so lines thinner than a pixel fade instead of flickering.
float getSeaLineCoverage(float distance, float halfWidth, float pixel) {
	float overlap = min(distance + pixel * 0.5, halfWidth) - max(distance - pixel * 0.5, -halfWidth);
	return clamp(overlap / max(pixel, 1e-4), 0.0, 1.0);
}

// Foam line coverage at sea height `seaHeight`, which changes by `heightPixel`
// across the pixel, flat world `xz`, deep ocean share `oceanMask`, sea state
// `state`, for a pixel `pixel` world units wide, `fade` the distance fade
// (getSeaFoamFade()): animated contour lines that run toward the coast within
// the depth band, wobbling and broken into dashes.
// The lines are the crest lines' strokes (getSeaCrestLine()) on the former
// soft profile, pow(sin(phase) * 0.5 + 0.5, sharpness) times the band, the
// dashes, the intensity, and the sea state boost: each covers where that
// profile reaches half, so it keeps the former lines' shape and motion,
// narrows where they faded (the band's edges, the dashes' gaps) and widens
// where they were brighter. The distance from the line's center is in phase
// units, like its half-width, box-filtered by the pixel's size in the same
// units; where the pixel spans the spacing between lines, the coverage turns
// into its mean. The fray varies the width and nudges the line sideways, as
// on the crests, so its edges are ragged. With the distance the line keeps
// fade.x of its width and its edges widen to fade.y pixels.
float getSeaRipple(float seaHeight, float heightPixel, vec2 xz, float oceanMask, float state, float pixel, vec2 fade) {
	vec4 band = mix(uSeaFoamLineBand[0], uSeaFoamLineBand[1], oceanMask);
	float depth = -seaHeight;
	float inBand = smoothstep(band.x, band.y, depth) - smoothstep(band.z, band.w, depth);
	if (inBand <= 0.0) return 0.0;
	vec4 motion = mix(uSeaFoamLineMotion[0], uSeaFoamLineMotion[1], oceanMask);
	vec4 style = mix(uSeaFoamLineStyle[0], uSeaFoamLineStyle[1], oceanMask);
	vec2 dash = mix(uSeaFoamLineDash[0], uSeaFoamLineDash[1], oceanMask);
	float dashes = max(1.0 - dash.y * sampleNoiseTile(xz * dash.x, pixel * dash.x).x, 0.0);
	float peak = inBand * dashes * style.y * mix(1.0 - style.z, 1.0 + style.z, state);
	if (peak <= 0.5) return 0.0;
	float halfWidth = acos(2.0 * pow(0.5 / peak, 1.0 / style.x) - 1.0) * fade.x;
	vec2 wobbleAngle = xz * motion.z;
	float wobble = (sin(wobbleAngle.x) + sin(wobbleAngle.y)) * motion.w;
	float phase = seaHeight * motion.x - uTime * motion.y + wobble;
	// The profile peaks where sin(phase) = 1.
	float distance = mod(phase - 1.5707963 + 3.1415927, 6.2831853) - 3.1415927;
	float phasePixel = (abs(motion.x) * heightPixel + length(cos(wobbleAngle)) * abs(motion.z * motion.w) * pixel) * fade.y;
	vec2 fray = mix(uSeaFoamLineFray[0], uSeaFoamLineFray[1], oceanMask);
	float frayDetail = fray.x * (1.0 - smoothstep(0.15, 0.35, pixel * fray.y));
	if (frayDetail > 0.0) {
		// Two fields of one sample: the width and the sideways nudge.
		vec4 frayNoise = sampleNoiseTile(xz * fray.y + uTime * 0.1 + 57.0, pixel * fray.y);
		distance += frayDetail * 0.5 * halfWidth * frayNoise.x;
		halfWidth *= max(1.0 + frayDetail * frayNoise.w, 0.0);
	}
	float coverage = getSeaLineCoverage(abs(distance), halfWidth, phasePixel);
	return mix(coverage, min(halfWidth / 3.1415927, 1.0), smoothstep(3.1415927, 6.2831853, phasePixel));
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

// Foam line coverage along the crests of the waves `waves` at flat world `xz`,
// in sea state `state`, for a pixel `pixel` world units wide. The line follows the ridge
// of the height of the waves that carry it (uSeaCrestWaves, the longest
// ones), so it rides their real crests and moves with them. Across the ridge
// is the direction where the surface bends down the most: the eigenvector of
// the height's most negative curvature (SeaWaves.curvature), well defined on
// the ridge itself, where the gradient vanishes and points anywhere. The
// distance from the ridge is the gradient along that direction over that
// curvature, exact on a parabola, so the line is one stroke centered on the
// crest and its half-width sets only its thickness. With every wave the
// lines break into short strokes on every crest; with the longest two alone
// they run long along the swell. A line shows where the crest rises above the
// threshold share of the highest those waves reach there, so it lengthens as
// crests meet and shortens as they part, and it narrows only near its ends.
// Calm water raises the threshold toward the top, keeping only the highest
// crests' lines (the type's minimum presence); the coast and the ice calm the
// lines with the waves. Two noises, drawn in a frame that rides the longest
// wave so they move with the crests, animate and fray the lines; they only
// run near a line. The flicker, two octaves drifting apart so it changes
// shape, hides part of the lines, which narrow where it closes, so strokes
// appear, grow, shrink, and vanish. The fray varies the width and nudges the
// line sideways, so its edges are ragged; it fades out before it gets finer
// than a few pixels. With the distance (`fade`, getSeaFoamFade()) the line
// keeps fade.x of its width and its edges widen to fade.y pixels.
float getSeaCrestLine(SeaWaves waves, vec2 xz, float oceanMask, float state, float pixel, vec2 fade) {
	if (waves.ridge.w <= 0.0) return 0.0;
	vec4 lines = mix(uSeaCrestLines[0], uSeaCrestLines[1], oceanMask);
	float presence = mix(mix(uSeaMinimum[0].x, uSeaMinimum[1].x, oceanMask), 1.0, state);
	float threshold = mix(1.0, lines.x, presence);
	float crest = smoothstep(threshold, threshold + lines.y, waves.ridge.z / waves.ridge.w);
	if (crest <= 0.0) return 0.0;
	// The curvature matrix [[xx, xz], [xz, zz]] and its smaller eigenvalue.
	vec3 curvature = waves.curvature;
	float bend = 0.5 * (curvature.x + curvature.z) - length(vec2(0.5 * (curvature.x - curvature.z), curvature.y));
	if (bend >= 0.0) return 0.0;
	vec2 across = vec2(curvature.y, bend - curvature.x);
	float acrossLength = length(across);
	across = acrossLength > 1e-8 ? across / acrossLength : (curvature.x < curvature.z ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
	float distance = dot(waves.ridge.xy, across) / -bend;
	float width = lines.z * fade.x;
	float window = pixel * fade.y;
	float halfWidth = width * sqrt(crest);
	vec2 fray = mix(uSeaCrestFray[0], uSeaCrestFray[1], oceanMask);
	if (abs(distance) > halfWidth * (1.0 + 1.5 * fray.x) + window) return 0.0;
	// The frame riding the longest wave: rest position minus its travel.
	vec4 swell = mix(uSeaWaves[0], uSeaWaves[SEA_SURFACE_WAVE_COUNT], oceanMask);
	vec2 riding = xz - swell.xy * (swell.w / max(swell.z, 1e-4) * uTime);
	vec3 flicker = mix(uSeaCrestFlicker[0], uSeaCrestFlicker[1], oceanMask);
	vec2 q = riding * flicker.y;
	float drift = uTime * flicker.z;
	float footprint = pixel * flicker.y;
	float noise = sampleNoiseTile(q + vec2(drift, -0.6 * drift), footprint).y * 0.65
		+ sampleNoiseTile(q * 2.1 + vec2(-0.8 * drift, drift) + 23.0, footprint * 2.1).z * 0.35;
	float cut = mix(-1.0, 1.0, flicker.x);
	float alive = smoothstep(cut - 0.2, cut + 0.2, noise);
	if (alive <= 0.0) return 0.0;
	halfWidth = width * sqrt(crest * alive);
	float frayDetail = fray.x * (1.0 - smoothstep(0.15, 0.35, pixel * fray.y));
	if (frayDetail > 0.0) {
		vec2 f = riding * fray.y + uTime * 0.1;
		// Two fields of one sample: the width and the sideways nudge.
		vec4 frayNoise = sampleNoiseTile(f + 57.0, pixel * fray.y);
		halfWidth *= max(1.0 + frayDetail * frayNoise.w, 0.0);
		distance += frayDetail * 0.5 * width * frayNoise.x;
	}
	float coverage = getSeaLineCoverage(abs(distance), halfWidth, window);
	return coverage * lines.w * min(waves.amount * 2.0, 1.0);
}

// Breaking foam coverage of the waves `waves` at flat world `xz`, in sea
// state `state`, for a pixel `pixel` world units wide. The crests break where
// they squeeze the surface beyond the threshold share of the largest squeeze
// the waves reach there; calm water raises the threshold toward the top, as
// for the crest lines. The foam stays where it formed while the crest moves
// on, and dissolves over the trail: it is the strongest breaking now and at
// the four lags of the recent past (SeaWaves.squeezeLag), weakened by its
// age, so it trails behind the crests. Fresh foam is solid; as it ages, a
// lace of two drifting noise octaves opens holes in it until it is gone. The
// lace is drawn on the rest position, so it rides the water's orbits, and its
// octaves drift apart, so it changes shape; far away, where it would alias,
// the foam turns into its mean coverage. The coast and the ice calm it with
// the waves, and the distance fades it by `fade` (getSeaFoamFade().x).
float getSeaBreakingFoam(SeaWaves waves, vec2 xz, float oceanMask, float state, float pixel, float fade) {
	if (waves.peak <= 0.0) return 0.0;
	vec4 breaking = mix(uSeaBreaking[0], uSeaBreaking[1], oceanMask);
	float presence = mix(mix(uSeaMinimum[0].z, uSeaMinimum[1].z, oceanMask), 1.0, state);
	float threshold = mix(1.0, breaking.x, presence);
	vec2 edges = vec2(threshold - breaking.y, threshold + breaking.y);
	float now = smoothstep(edges.x, edges.y, waves.squeeze / waves.peak);
	vec4 past = smoothstep(edges.xxxx, edges.yyyy, waves.squeezeLag / waves.peak) * vec4(0.8, 0.6, 0.4, 0.2);
	float foam = max(now, max(max(past.x, past.y), max(past.z, past.w))) * min(waves.amount * 2.0, 1.0);
	if (foam <= 0.0) return 0.0;
	float detail = 1.0 - smoothstep(0.15, 0.35, pixel * breaking.w);
	float coverage = foam;
	if (detail > 0.0) {
		vec2 p = xz * breaking.w;
		float lace = 0.5 + 0.5 * (snoise(p + uTime * vec2(0.05, 0.02)) * 0.65 + snoise(p * 2.7 + uTime * vec2(-0.04, 0.07) + 11.0) * 0.35);
		coverage = mix(foam, smoothstep(0.92 - foam, 1.08 - foam, lace), detail);
	}
	return coverage * breaking.z * fade;
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
