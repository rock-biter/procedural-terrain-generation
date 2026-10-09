// Terrain vertex declarations beyond common.glsl: the biome and sea ice
// fields, which keep the frozen sea still, and the moving sea surface
// (project-vertex.glsl).
#include ./biome-value.glsl
#include ./sea-ice-pars.glsl
#include ./sea-surface-pars.glsl

// The ice and deep ocean fields at the vertex, interpolated for the fragment.
varying float vIceValue;
varying float vOceanValue;
// The sea state (getSeaState()) and the ripples' phase noise
// (getSeaRippleNoise()), as broad, interpolated for the fragment.
varying float vSeaState;
varying float vSeaRippleNoise;
