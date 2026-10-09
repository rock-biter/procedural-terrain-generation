// Terrain vertex declarations beyond common.glsl: the biome and sea ice
// fields, which keep the frozen sea still (project-vertex.glsl).
#include ./biome-value.glsl
#include ./sea-ice-pars.glsl

// The ice and deep ocean fields at the vertex, interpolated for the fragment.
varying float vIceValue;
varying float vOceanValue;
