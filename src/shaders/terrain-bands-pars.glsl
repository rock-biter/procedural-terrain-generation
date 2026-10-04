// Biome field and band borders of the terrain. Every constant comes from
// src/terrainBands.js (TERRAIN_SHADER_DEFINES), which the CPU reads too.

// biomeXZ is the world XZ position already shifted by uBiomeOffset; each
// layer is (frequency, weight). getBiomeValue() in src/biome.js mirrors it.
float getBiomeValue(vec2 biomeXZ) {
	return snoise(biomeXZ * BIOME_NOISE_LAYER_0.x) * BIOME_NOISE_LAYER_0.y
		+ snoise(biomeXZ * BIOME_NOISE_LAYER_1.x) * BIOME_NOISE_LAYER_1.y
		+ snoise(biomeXZ * BIOME_NOISE_LAYER_2.x) * BIOME_NOISE_LAYER_2.y;
}

// Sand brightness on fully rocky coast (params.coastSand.shade).
uniform float uCoastSandShade;

// Rocky coast mask settings (params.coast.mask, updateCoastMaskUniforms()):
// x: frequency per world unit, y: detail frequency, z: detail weight.
uniform vec3 uCoastRockNoise;
// x: threshold, y: softness (half-width of the transition).
uniform vec2 uCoastRockEdge;

// Rocky coast mask in [0, 1] at biomeXZ (already shifted by uBiomeOffset);
// getCoastRockMask() in src/coast.js mirrors it, with the same layer order.
float getCoastRockMask(vec2 biomeXZ) {
	vec2 coastXZ = biomeXZ + COAST_ROCK_OFFSET;
	float value = snoise(coastXZ * uCoastRockNoise.x)
		+ snoise(coastXZ * uCoastRockNoise.y) * uCoastRockNoise.z;
	return smoothstep(uCoastRockEdge.x - uCoastRockEdge.y, uCoastRockEdge.x + uCoastRockEdge.y, value);
}

// The height plus a band's wave (x = frequency, y = amplitude), compared with
// the band's line and level; getBandHeight() in src/terrainBands.js.
float getTerrainBandHeight(vec3 position, vec2 wave) {
	return position.y + sin(position.x * wave.x) * wave.y + cos(position.z * wave.x) * wave.y;
}
