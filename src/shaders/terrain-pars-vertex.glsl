// Terrain vertex declarations beyond common.glsl: the biome and sea ice
// fields, which keep the frozen sea still (project-vertex.glsl).
#include ./biome-value.glsl
#include ./sea-ice-pars.glsl

// The ice field at the vertex, interpolated for the fragment.
varying float vIceValue;
