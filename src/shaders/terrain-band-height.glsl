// The height plus a band's wave (x = frequency, y = amplitude), compared with
// the band's line and level; getBandHeight() in src/terrainBands.js. The
// terrain's vertex (project-vertex.glsl) and fragment (color-fragment.glsl)
// shaders both evaluate it.
#ifndef TERRAIN_BAND_HEIGHT
#define TERRAIN_BAND_HEIGHT
float getTerrainBandHeight(vec3 position, vec2 wave) {
	return position.y + sin(position.x * wave.x) * wave.y + cos(position.z * wave.x) * wave.y;
}
#endif
