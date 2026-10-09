// The moving sea surface, shared by the terrain's vertex (moving vertices,
// project-vertex.glsl) and fragment (normals and whitecaps,
// color-fragment.glsl) shaders and by the boats floating on it
// (scenery-instance-pars-vertex.glsl). The settings are params.seaSurface,
// written by updateSeaSurfaceUniforms() (src/sharedUniforms.js); the rules
// are in src/seaSurfacePolicy.js. common.glsl must be included before.
#ifndef SEA_SURFACE_PARS
#define SEA_SURFACE_PARS

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
// Per type, x, y: wave scale in the calmest and roughest regions, z, w:
// depths where the waves start and are full toward the coast.
uniform vec4 uSeaWaveShape[SEA_SURFACE_TYPE_COUNT];
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
	// How much the crests compress the surface: 1 minus the Jacobian of the
	// horizontal displacement, at most the steepness.
	float squeeze;
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

// The waves of sea type `type` at flat world `xz`, `depth` world units deep
// (the raw height's opposite), in sea state `state`, `still` being the frozen
// sea's stillness (getSeaIceStill()). `pixel` is the pixel's size on the
// ground: components shorter than a few pixels fade instead of aliasing (0
// keeps them all).
SeaWaves getSeaTypeWaves(int type, vec2 xz, float depth, float state, float still, float pixel) {
	SeaWaves waves = SeaWaves(vec3(0.0), vec2(0.0), 0.0, 0.0);
	vec4 shape = uSeaWaveShape[type];
	waves.amount = smoothstep(shape.z, shape.w, depth) * (1.0 - still);
	if (waves.amount <= 0.0) return waves;
	float scale = mix(shape.x, shape.y, state);
	float height = waves.amount * scale;
	// The steepness is reached in the roughest regions.
	float reach = waves.amount * min(scale / max(shape.y, 1e-4), 1.0);
	for (int i = 0; i < SEA_SURFACE_WAVE_COUNT; i++) {
		int index = type * SEA_SURFACE_WAVE_COUNT + i;
		vec4 wave = uSeaWaves[index];
		vec2 size = uSeaWaveSizes[index];
		float detail = 1.0 - smoothstep(1.0, 2.5, pixel * wave.z);
		float theta = wave.z * dot(wave.xy, xz) - wave.w * uTime;
		float c = cos(theta);
		float s = sin(theta);
		float a = size.x * height * detail;
		float h = size.y * reach * detail;
		waves.offset += vec3(wave.x * h * c, a * s, wave.y * h * c);
		waves.slope += wave.xy * (wave.z * a * c);
		waves.squeeze += wave.z * h * s;
	}
	return waves;
}

// The waves at flat world `xz`, blending the sea's and the deep ocean's by
// `oceanMask` (getSeaOceanMask()); the other arguments as getSeaTypeWaves().
SeaWaves getSeaWaves(vec2 xz, float depth, float oceanMask, float state, float still, float pixel) {
	if (oceanMask <= 0.0) return getSeaTypeWaves(0, xz, depth, state, still, pixel);
	SeaWaves ocean = getSeaTypeWaves(1, xz, depth, state, still, pixel);
	if (oceanMask >= 1.0) return ocean;
	SeaWaves sea = getSeaTypeWaves(0, xz, depth, state, still, pixel);
	return SeaWaves(
		mix(sea.offset, ocean.offset, oceanMask),
		mix(sea.slope, ocean.slope, oceanMask),
		mix(sea.squeeze, ocean.squeeze, oceanMask),
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
// vertices, it rests beyond uSeaSurface.y from the airplane.
void getSeaFloatPose(vec2 xz, float depth, out vec3 offset, out vec3 normal) {
	offset = vec3(0.0);
	normal = vec3(0.0, 1.0, 0.0);
	float fade = getSeaVertexFade(xz);
	if (fade <= 0.0) return;
	SeaWaves waves = getSeaTypeWaves(0, xz, depth, getSeaState(xz), 0.0, 0.0);
	offset = waves.offset * fade;
	normal = normalize(vec3(-waves.slope.x * fade, 1.0 - waves.squeeze * fade, -waves.slope.y * fade));
}
#endif
