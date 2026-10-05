// Biome fields of the terrain, shared by its fragment (terrain-bands-pars.glsl)
// and its vertex waves (project-vertex.glsl). The scenery reads the biome
// placement chose from its instance tint instead (getSceneryPaletteTints() in
// scenery-instance-pars-vertex.glsl). biomeXZ is the world XZ position
// already shifted by uBiomeOffset.xy; each BIOME_*_LAYER_* define
// (BIOME_SHADER_DEFINES in src/terrainBands.js) is (frequency, weight).
// src/biome.js mirrors every function with the same summation order: the
// climate splits temperate (>= 0) and desert, and the ice field, >= 0 inside
// the ice, overrides both.
#ifndef BIOME_VALUE
#define BIOME_VALUE

// params.biomes, written by updateBiomeUniforms() (src/sharedUniforms.js).
// x: 1 / size (scales every climate frequency), y: desert bias, z: upper
// bound of the effective climate's gradient per world unit, w: unused.
uniform vec4 uBiomeClimate;
// x: 1 / ice size, y: ice threshold, z: forest ring, w: upper bound of the ice
// field's gradient per world unit.
uniform vec4 uBiomeIce;

// The climate before the forest ring; getClimateNoise() in src/biome.js.
float getClimateNoise(vec2 biomeXZ) {
	return snoise(biomeXZ * (BIOME_CLIMATE_LAYER_0.x * uBiomeClimate.x)) * BIOME_CLIMATE_LAYER_0.y
		+ snoise(biomeXZ * (BIOME_CLIMATE_LAYER_1.x * uBiomeClimate.x)) * BIOME_CLIMATE_LAYER_1.y
		+ snoise(biomeXZ * (BIOME_CLIMATE_LAYER_2.x * uBiomeClimate.x)) * BIOME_CLIMATE_LAYER_2.y
		- uBiomeClimate.y;
}

// The ice field's base layer minus the threshold, sampled in its own noise
// space (uBiomeOffset.zw).
float getIceBase(vec2 biomeXZ) {
	return snoise(biomeXZ * (BIOME_ICE_LAYER_0.x * uBiomeIce.x) + uBiomeOffset.zw) * BIOME_ICE_LAYER_0.y
		- uBiomeIce.y;
}

float getIceDetail(vec2 biomeXZ) {
	return snoise(biomeXZ * (BIOME_ICE_LAYER_1.x * uBiomeIce.x) + uBiomeOffset.zw) * BIOME_ICE_LAYER_1.y;
}

// The ice field; getIceValue() in src/biome.js. Its layers are broad (the
// finest about 670 units at the default size), so the terrain evaluates it
// per vertex and interpolates it (vIceValue, project-vertex.glsl); only the
// separator's gradient samples it per pixel.
float getIceValue(vec2 biomeXZ) {
	return getIceBase(biomeXZ) + getIceDetail(biomeXZ);
}

// The effective climate: within the forest ring of the ice it is temperate,
// so the desert never touches the ice.
float getClimateValue(float climateNoise, float iceValue) {
	return max(climateNoise, iceValue + uBiomeIce.z);
}

// BIOME_DESERT, BIOME_TEMPERATE, or BIOME_ICE; getBiome() in src/biome.js.
int getBiome(float climateValue, float iceValue) {
	if (iceValue >= 0.0) return BIOME_ICE;
	return climateValue >= 0.0 ? BIOME_TEMPERATE : BIOME_DESERT;
}
#endif
