// Biome field shared by the terrain (terrain-bands-pars.glsl) and the scenery
// palettes (scenery-instance-pars-vertex.glsl). biomeXZ is the world XZ
// position already shifted by uBiomeOffset; each BIOME_NOISE_LAYER_* define
// (BIOME_SHADER_DEFINES in src/terrainBands.js) is (frequency, weight).
// getBiomeValue() in src/biome.js mirrors it; >= 0 is temperate, below desert.
#ifndef BIOME_VALUE
#define BIOME_VALUE
float getBiomeValue(vec2 biomeXZ) {
	return snoise(biomeXZ * BIOME_NOISE_LAYER_0.x) * BIOME_NOISE_LAYER_0.y
		+ snoise(biomeXZ * BIOME_NOISE_LAYER_1.x) * BIOME_NOISE_LAYER_1.y
		+ snoise(biomeXZ * BIOME_NOISE_LAYER_2.x) * BIOME_NOISE_LAYER_2.y;
}
#endif
