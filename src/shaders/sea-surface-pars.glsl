// The moving sea surface, shared by the terrain's vertex (moving vertices,
// project-vertex.glsl) and fragment (normals and crest lines,
// color-fragment.glsl) shaders and by the boats floating on it
// (scenery-instance-pars-vertex.glsl). The settings are params.seaSurface,
// written by updateSeaSurfaceUniforms() (src/sharedUniforms.js); the rules
// are in src/seaSurfacePolicy.js. common.glsl must be included before.
#ifndef SEA_SURFACE_PARS
#define SEA_SURFACE_PARS

// The airplane's wake, which every reader of the waves adds to them.
#include ./sea-wake-pars.glsl

#define SEA_SURFACE_WAVE_COUNT 4
// Two sea types: 0 the sea, 1 the deep ocean.
#define SEA_SURFACE_TYPE_COUNT 2
// Decorrelates the regions from the climate, which shares uBiomeOffset.xy.
#define SEA_SURFACE_REGION_OFFSET vec2(-4137.2, 2291.7)

// Gerstner components, SEA_SURFACE_WAVE_COUNT per type: x, y: unit direction
// on the ground (world x, z), z: wavenumber, w: angular speed.
uniform vec4 uSeaWaves[SEA_SURFACE_TYPE_COUNT * SEA_SURFACE_WAVE_COUNT];
// Per component, x: amplitude, y: horizontal reach at full steepness (world
// units).
uniform vec2 uSeaWaveSizes[SEA_SURFACE_TYPE_COUNT * SEA_SURFACE_WAVE_COUNT];
// Per component, the cosine and sine of its phase change over the four lags
// of the breaking foam's trail (getSeaBreakingFoam()), so the squeeze of the
// recent past costs no trigonometry: sin(θ + ωΔ) = sin θ cos ωΔ + cos θ sin ωΔ.
uniform vec4 uSeaWaveLagCos[SEA_SURFACE_TYPE_COUNT * SEA_SURFACE_WAVE_COUNT];
uniform vec4 uSeaWaveLagSin[SEA_SURFACE_TYPE_COUNT * SEA_SURFACE_WAVE_COUNT];
// Per type, x, y: wave scale in the calmest and roughest regions, z, w:
// depths where the waves start and are full toward the coast.
uniform vec4 uSeaWaveShape[SEA_SURFACE_TYPE_COUNT];
// Per type, the irregularity of the components (getSeaTypeWaves()). x:
// how far their crests wander (world units), y: the frequency of its noise
// (per world unit), z: the wave groups' amplitude variation (share).
uniform vec3 uSeaWaveVariation[SEA_SURFACE_TYPE_COUNT];
// Per type, how many of the longest waves carry the crest lines
// (SeaWaves.ridge, getSeaCrestLine()).
uniform float uSeaCrestWaves[SEA_SURFACE_TYPE_COUNT];
// Regions, x: 1 / wavelength, y: contrast, z, w: drift (world units per
// second).
uniform vec4 uSeaRegions;
// Ripples of the sea's normal map, per type. x: frequency of their phase
// noise (per world unit, vSeaRippleNoise), y: sea state boost of the map's
// strength (±).
uniform vec2 uSeaRippleDetail[SEA_SURFACE_TYPE_COUNT];
// x, y: horizontal distances from the airplane where the vertices start and
// stop moving, z: deep ocean field over which the deep ocean's settings take
// over, w: debug view (SEA_SURFACE_DEBUG_VIEWS).
uniform vec4 uSeaSurface;

// The waves at one point of the sea.
struct SeaWaves {
	// Displacement of the surface point (world units).
	vec3 offset;
	// Height gradient along world x and z.
	vec2 slope;
	// The longest waves that carry the crest lines (uSeaCrestWaves), alone:
	// their height gradient (xy), height (z), and the highest they rise here,
	// when their crests meet (w), so z / w places the point on them whatever
	// their size.
	vec4 ridge;
	// Their second derivatives of the height: xx, xz, zz.
	vec3 curvature;
	// How much the crests compress the surface: 1 minus the Jacobian of the
	// horizontal displacement, at most the steepness.
	float squeeze;
	// The same squeeze at the four lags of the breaking foam's trail, in the
	// recent past (uSeaWaveLagCos, uSeaWaveLagSin).
	vec4 squeezeLag;
	// The largest squeeze the waves reach here, when every crest meets.
	float peak;
	// Share of the full waves the coast and the frozen sea leave.
	float amount;
};

// Sea state at flat world `xz`: 0 in the calmest regions, 1 in the roughest.
float getSeaState(vec2 xz) {
	vec2 p = (xz + uBiomeOffset.xy + SEA_SURFACE_REGION_OFFSET - uSeaRegions.zw * uTime) * uSeaRegions.x;
	float noise = snoise(p) * 0.7 + snoise(p * 2.3 + 17.0) * 0.3;
	return clamp(0.5 + 0.5 * noise * uSeaRegions.y, 0.0, 1.0);
}

// Share of the deep ocean's settings at deep ocean field value `oceanValue`:
// 0 outside its border, 1 once inside by uSeaSurface.z.
float getSeaOceanMask(float oceanValue) {
	return smoothstep(0.0, uSeaSurface.z, oceanValue);
}

// The ripples' phase noise at flat world `xz` (getSeaRippleWarp()), about 50
// world units wide, so the terrain evaluates it per vertex.
float getSeaRippleNoise(vec2 xz, float oceanMask) {
	return snoise(xz * mix(uSeaRippleDetail[0].x, uSeaRippleDetail[1].x, oceanMask));
}

// Share of the waves that moves the vertices at flat world `xz`: 1 near the
// airplane, 0 beyond uSeaSurface.y.
float getSeaVertexFade(vec2 xz) {
	return 1.0 - smoothstep(uSeaSurface.x, uSeaSurface.y, length(xz - uCamera.xz));
}

// The waves' irregularity of sea type `type` at flat world `xz`: two slow
// simplex fields n1, n2 (getSeaTypeWaves() turns them into each component's
// crest shift and amplitude gain). They drift with the wave groups, along the
// longest wave at half its speed (deep water group velocity), so the crests
// run through them. They are hundreds of units wide: the terrain evaluates
// them per vertex and the fragment reads them interpolated. Two simplex
// fields, not one per component or the baked tile: the terrain's vertex
// shader weighs on the frame, and a texture read or eight noises there cost
// a sixth of it (the wake's one read is limited to the rectangle it
// occupies, getSeaWake()).
vec2 getSeaTypeWaveNoise(int type, vec2 xz) {
	vec4 swell = uSeaWaves[type * SEA_SURFACE_WAVE_COUNT];
	vec2 p = (xz - swell.xy * (0.5 * swell.w / max(swell.z, 1e-4) * uTime)) * uSeaWaveVariation[type].y;
	return vec2(snoise(p), snoise(p + vec2(31.7, -17.3)));
}

// The irregularity's fields at flat world `xz`, blending the sea's and the
// deep ocean's by `oceanMask` (getSeaOceanMask()), so one pair serves both
// types.
vec2 getSeaWaveNoise(vec2 xz, float oceanMask) {
	if (oceanMask <= 0.0) return getSeaTypeWaveNoise(0, xz);
	vec2 ocean = getSeaTypeWaveNoise(1, xz);
	if (oceanMask >= 1.0) return ocean;
	return mix(getSeaTypeWaveNoise(0, xz), ocean, oceanMask);
}

// The waves of sea type `type` at flat world `xz`, `depth` world units deep
// (the raw height's opposite), in sea state `state`, `still` being the frozen
// sea's stillness (getSeaIceStill()). `pixel` is the pixel's size on the
// ground: components shorter than a few pixels fade instead of aliasing (0
// keeps them all). `noise` holds the irregularity's fields n1, n2
// (getSeaWaveNoise()), so the components meet differently everywhere instead
// of repeating one lattice of crests. Each component's crests wander along
// its direction (the phase offset is the shift times the wavenumber, so the
// short waves bend as much as the long ones) by (n1, n2, -n1, -n2) times
// uSeaWaveVariation.x: every pair drifts out of phase by its own mix of the
// two (the longest and the third by (k0 + k2) n1, the longest and the second
// by k0 n1 - k1 n2, ...). Their amplitudes take the gains 1 + (n2, n1, -n2,
// -n1) times uSeaWaveVariation.z, the wave groups, trading swell for chop; a
// gain lifts the amplitude alone, never the horizontal reach beyond its own,
// so the crests never fold over. The fields are slow enough that their own
// slope is left out of the normals and the squeeze.
SeaWaves getSeaTypeWaves(int type, vec2 xz, float depth, float state, float still, float pixel, vec2 noise) {
	SeaWaves waves = SeaWaves(vec3(0.0), vec2(0.0), vec4(0.0), vec3(0.0), 0.0, vec4(0.0), 0.0, 0.0);
	vec4 shape = uSeaWaveShape[type];
	waves.amount = smoothstep(shape.z, shape.w, depth) * (1.0 - still);
	if (waves.amount <= 0.0) return waves;
	float scale = mix(shape.x, shape.y, state);
	float height = waves.amount * scale;
	// The steepness is reached in the roughest regions.
	float reach = waves.amount * min(scale / max(shape.y, 1e-4), 1.0);
	float ridgeWaves = uSeaCrestWaves[type];
	vec3 variation = uSeaWaveVariation[type];
	vec4 shifts = vec4(noise, -noise) * variation.x;
	vec4 gains = max(1.0 + vec4(noise.y, noise.x, -noise.y, -noise.x) * variation.z, 0.0);
	for (int i = 0; i < SEA_SURFACE_WAVE_COUNT; i++) {
		int index = type * SEA_SURFACE_WAVE_COUNT + i;
		vec4 wave = uSeaWaves[index];
		vec2 size = uSeaWaveSizes[index];
		float detail = 1.0 - smoothstep(1.0, 2.5, pixel * wave.z);
		float theta = wave.z * (dot(wave.xy, xz) + shifts[i]) - wave.w * uTime;
		float c = cos(theta);
		float s = sin(theta);
		float a = size.x * height * detail * gains[i];
		float h = size.y * reach * detail * min(gains[i], 1.0);
		vec2 wavevector = wave.xy * wave.z;
		waves.offset += vec3(wave.x * h * c, a * s, wave.y * h * c);
		waves.slope += wavevector * (a * c);
		waves.squeeze += wave.z * h * s;
		waves.squeezeLag += (wave.z * h) * (s * uSeaWaveLagCos[index] + c * uSeaWaveLagSin[index]);
		waves.peak += wave.z * h;
		if (float(i) < ridgeWaves) {
			waves.ridge += vec4(wavevector * (a * c), a * s, a);
			waves.curvature -= vec3(wavevector.x * wavevector.x, wavevector.x * wavevector.y, wavevector.y * wavevector.y) * (a * s);
		}
	}
	return waves;
}

// The waves at flat world `xz`, blending the sea's and the deep ocean's by
// `oceanMask` (getSeaOceanMask()); the other arguments as getSeaTypeWaves().
SeaWaves getSeaWaves(vec2 xz, float depth, float oceanMask, float state, float still, float pixel, vec2 noise) {
	if (oceanMask <= 0.0) return getSeaTypeWaves(0, xz, depth, state, still, pixel, noise);
	SeaWaves ocean = getSeaTypeWaves(1, xz, depth, state, still, pixel, noise);
	if (oceanMask >= 1.0) return ocean;
	SeaWaves sea = getSeaTypeWaves(0, xz, depth, state, still, pixel, noise);
	return SeaWaves(
		mix(sea.offset, ocean.offset, oceanMask),
		mix(sea.slope, ocean.slope, oceanMask),
		mix(sea.ridge, ocean.ridge, oceanMask),
		mix(sea.curvature, ocean.curvature, oceanMask),
		mix(sea.squeeze, ocean.squeeze, oceanMask),
		mix(sea.squeezeLag, ocean.squeezeLag, oceanMask),
		mix(sea.peak, ocean.peak, oceanMask),
		mix(sea.amount, ocean.amount, oceanMask)
	);
}

// World normal of the waved surface.
vec3 getSeaWaveNormal(SeaWaves waves) {
	return normalize(vec3(-waves.slope.x, 1.0 - waves.squeeze, -waves.slope.y));
}

// Rigid pose of an object floating on the sea (never the deep ocean, which
// the boats keep out of) at flat world `xz`, `depth` world units deep: the
// offset of its base and the surface normal there. Like the terrain's
// vertices, it rests beyond uSeaSurface.y from the airplane. The airplane's
// wake heaves and tilts it too (uSeaWakeBoat).
void getSeaFloatPose(vec2 xz, float depth, out vec3 offset, out vec3 normal) {
	offset = vec3(0.0);
	vec2 slope = vec2(0.0);
	float squeeze = 0.0;
	float fade = getSeaVertexFade(xz);
	if (fade > 0.0) {
		SeaWaves waves = getSeaTypeWaves(0, xz, depth, getSeaState(xz), 0.0, 0.0, getSeaTypeWaveNoise(0, xz));
		offset = waves.offset * fade;
		slope = waves.slope * fade;
		squeeze = waves.squeeze * fade;
	}
	float wakeFade;
	vec4 wake = getSeaWake(xz, depth, wakeFade);
	if (wakeFade > 0.0) {
		offset.y += clamp(wake.z, -1.0, 1.0) * uSeaWakeBoat.x;
		slope += wake.xy * (uSeaWakeShape.y * uSeaWakeBoat.y);
	}
	normal = normalize(vec3(-slope.x, 1.0 - squeeze, -slope.y));
}
#endif
