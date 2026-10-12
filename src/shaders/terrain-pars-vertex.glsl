// Terrain vertex declarations beyond common.glsl: the biome and sea ice
// fields, which keep the frozen sea still, and the moving sea surface
// (project-vertex.glsl).
#include ./biome-value.glsl
#include ./sea-ice-pars.glsl
#include ./sea-surface-pars.glsl
#include ./terrain-band-height.glsl

// The ice and deep ocean fields and the climate at the vertex, interpolated
// for the fragment.
varying float vIceValue;
varying float vOceanValue;
varying float vClimateNoise;
// The sea state (getSeaState()) and the ripples' phase noise
// (getSeaRippleNoise()), as broad, interpolated for the fragment.
varying float vSeaState;
varying float vSeaRippleNoise;
// The waves' irregularity fields (getSeaWaveNoise()), as broad.
varying vec2 vSeaWaveNoise;
// The band heights (getTerrainBandHeight()) of grass, land, rocks, and snow,
// interpolated for their change across the pixel (color-fragment.glsl).
varying vec4 vBandHeights;
