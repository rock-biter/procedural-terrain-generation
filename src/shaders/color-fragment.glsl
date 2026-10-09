#include <color_fragment>

vec2 biomeXZ = wPosition.xz + uBiomeOffset.xy;
// Derivatives need uniform control flow, so they are taken here, from the
// position alone: the biome separators and the sea ice antialias with them,
// and neither biome field has to be evaluated outside the branches below.
vec2 groundDx = dFdx(wPosition.xz);
vec2 groundDy = dFdy(wPosition.xz);
// The pixel's size on the ground, and the raw height change across it.
float groundPixel = 0.5 * (length(groundDx) + length(groundDy));
float heightPixel = fwidth(wPosition.y);
// Interpolated from the vertices: no noise per pixel.
float iceValue = vIceValue;
float oceanValue = vOceanValue;

// The abyss color fills the deep ocean's floor: the rest of the sea never
// reaches its depths (about -53 at most), so no biome is evaluated for it.
float pctAbyss = smoothstep(- uSeaAbyssDepth.x, - uSeaAbyssDepth.y, wPosition.y);
float pctDeep = smoothstep(- 24., - 40., wPosition.y);
diffuseColor.rgb = mix(mix(uSeaColors[1], uSeaColors[2], pctDeep), uSeaColors[3], pctAbyss);
float pctSea = smoothstep(- 6., - 16., wPosition.y);
diffuseColor.rgb = mix(uSeaColors[0], diffuseColor.rgb, pctSea);
// The shoreline, raw heights from 0 to the sand level, is a black ink line,
// except in the ice, where it stays snow: the ice never meets the water with
// a dark line.
if (wPosition.y > 0.0) diffuseColor.rgb = iceValue >= 0.0 ? getTerrainColor(BIOME_ICE, 0, 0.0) : vec3(0.0);
float pctSand = step(wPosition.y, TERRAIN_SAND_LEVEL);

// The frozen sea (sea-ice-pars-fragment.glsl): its coverage also stills the
// ripples and picks the snow normal layer below.
float seaIce = 0.0;
if (wPosition.y < TERRAIN_SAND_LEVEL && iceValue > 0.0) {
	seaIce = applySeaIce(diffuseColor.rgb, wPosition.y, wPosition.xz, iceValue, groundPixel, heightPixel);
}

// Height bands (src/terrainBands.js): 1.0 keeps the color below the band.
// Below the sand level no band, biome color, separator, or color noise
// reaches the output, so the sea (most of the world) skips their noise
// evaluations.
float pct = 1.0;
float pct2 = 1.0;
float pctRock = 1.0;
float pct3 = 1.0;
if (wPosition.y >= TERRAIN_SAND_LEVEL) {
	// The ice and the deep ocean's islets need no climate.
	bool inOcean = oceanValue >= 0.0;
	float climateNoise = iceValue < 0.0 && !inOcean ? getClimateNoise(biomeXZ) : 0.0;
	float climateValue = getClimateValue(climateNoise, iceValue);
	int biome = getBiome(climateValue, iceValue, oceanValue);

	// Biome separators with a constant world-space width (getBiomeSeparator()),
	// their gradients evaluated only near a border: the climate border outside
	// the ice and the deep ocean, and the ice border. Along the forest ring the
	// effective climate follows the ice field, so its gradient does too.
	// uBiomeClimate.z and uBiomeIce.w bound the fields' slopes; the extra
	// pixels keep the search wide enough for the antialiasing. The deep ocean
	// border needs none: its slope sinks all land before it.
	float biomeBoundary = 0.0;
	float borderReach = BIOME_LINE_HALF_WIDTH + 2.0 * groundPixel;
	if (iceValue < 0.0 && !inOcean && abs(climateValue) < borderReach * uBiomeClimate.z) {
		vec2 gradient;
		if (climateNoise >= iceValue + uBiomeIce.z) {
			gradient = (vec2(
				getClimateNoise(biomeXZ + vec2(BIOME_CLIMATE_GRADIENT_STEP, 0.0)),
				getClimateNoise(biomeXZ + vec2(0.0, BIOME_CLIMATE_GRADIENT_STEP))
			) - climateNoise) / BIOME_CLIMATE_GRADIENT_STEP;
		} else {
			gradient = getIceGradient(biomeXZ);
		}
		biomeBoundary = getBiomeSeparator(climateValue, gradient, groundDx, groundDy);
	}
	if (abs(iceValue) < borderReach * uBiomeIce.w) {
		biomeBoundary = max(biomeBoundary, getBiomeSeparator(iceValue, getIceGradient(biomeXZ), groundDx, groundDy));
	}

	// The biome's palette (src/terrainPalettePolicy.js). The slow variation
	// noise drifts the bands that ask for it (the forest's grass, land, and
	// rocks).
	vec3 terrainStyle = uTerrainStyles[biome];
	float biomeVariation = 0.0;
	if (terrainStyle.z > 0.0) {
		biomeVariation = snoise(biomeXZ * 0.001) * 0.3 + 0.6 + snoise(biomeXZ * 0.01) * 0.3;
	}
	// 0 leaves the band lines black, 1 removes them.
	float lineShade = 1.0 - terrainStyle.y;

	vec3 sandColor = getTerrainColor(biome, 0, biomeVariation);
	// Rocky coast (src/coast.js) darkens the sand gradually, outside the ice
	// and the deep ocean, whose islets keep their bright beaches. The mask is
	// only evaluated where the grass band, wave included, may not yet cover
	// it.
	if (biome != BIOME_ICE && biome != BIOME_DEEP_OCEAN && wPosition.y < TERRAIN_GRASS_LEVEL + 2.0 * TERRAIN_GRASS_WAVE.y) {
		sandColor *= mix(1.0, uCoastSandShade, getCoastRockMask(biomeXZ));
	}
	diffuseColor.rgb = mix(sandColor, diffuseColor.rgb, pctSand);

	// grass
	float bandHeight = getTerrainBandHeight(wPosition, TERRAIN_GRASS_WAVE);
	float pctLine = step(bandHeight, TERRAIN_GRASS_LINE);
	pct = step(bandHeight, TERRAIN_GRASS_LEVEL);
	diffuseColor.rgb = mix(diffuseColor.rgb * lineShade, diffuseColor.rgb, pctLine);
	diffuseColor.rgb = mix(getTerrainColor(biome, 1, biomeVariation), diffuseColor.rgb, pct);

	// land
	bandHeight = getTerrainBandHeight(wPosition, TERRAIN_LAND_WAVE);
	pctLine = step(bandHeight, TERRAIN_LAND_LINE);
	pct2 = step(bandHeight, TERRAIN_LAND_LEVEL);
	diffuseColor.rgb = mix(diffuseColor.rgb * lineShade, diffuseColor.rgb, pctLine);
	diffuseColor.rgb = mix(getTerrainColor(biome, 2, biomeVariation), diffuseColor.rgb, pct2);

	// rocks
	bandHeight = getTerrainBandHeight(wPosition, TERRAIN_ROCKS_WAVE);
	pctLine = step(bandHeight, TERRAIN_ROCKS_LINE);
	pctRock = step(bandHeight, TERRAIN_ROCKS_LEVEL);
	diffuseColor.rgb = mix(diffuseColor.rgb * lineShade, diffuseColor.rgb, pctLine);
	diffuseColor.rgb = mix(getTerrainColor(biome, 3, biomeVariation), diffuseColor.rgb, pctRock);

	// snow
	bandHeight = getTerrainBandHeight(wPosition, TERRAIN_SNOW_WAVE);
	pctLine = step(bandHeight, TERRAIN_SNOW_LINE);
	pct3 = step(bandHeight, TERRAIN_SNOW_LEVEL);
	diffuseColor.rgb = mix(diffuseColor.rgb * lineShade, diffuseColor.rgb, pctLine);
	diffuseColor.rgb = mix(getTerrainColor(biome, 4, biomeVariation), diffuseColor.rgb, pct3);

	// Soft lighter patches, scaled per biome, and the biome separator, on land
	// only.
	if (terrainStyle.x > 0.0) {
		diffuseColor.rgb *= 1.0 + (getTerrainColorShade(biomeXZ) - 1.0) * terrainStyle.x;
	}
	diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.0), biomeBoundary);
}

// Layer for normal-fragment-map.glsl, indexed like TERRAIN_BANDS in
// src/terrainBands.js. Same priority as the color mixes above; the frozen sea
// takes the snow's.
int terrainBand = TERRAIN_BAND_SEA;
if (pctSand < 0.5) terrainBand = TERRAIN_BAND_SAND;
if (pct < 0.5) terrainBand = TERRAIN_BAND_GRASS;
if (pct2 < 0.5) terrainBand = TERRAIN_BAND_LAND;
if (pctRock < 0.5) terrainBand = TERRAIN_BAND_ROCKS;
if (pct3 < 0.5) terrainBand = TERRAIN_BAND_SNOW;
if (seaIce > 0.5) terrainBand = TERRAIN_BAND_SNOW;

// Sea ripples (sea-ripple-pars-fragment.glsl) on one sea height: the raw
// height fused with the sea rocks' virtual height from the foam map. The ice
// stills them.
float onda = getSeaRipple(getSeaFoamHeight(wPosition.y, wPosition.xz), wPosition.xz) * (1.0 - seaIce);
diffuseColor.rgb = mix(vec3(onda), diffuseColor.rgb, 1. - onda);

// Distant terrain is capped by the day/night atmosphere color.
diffuseColor.rgb = mix(min(uAtmosphere, diffuseColor.rgb), diffuseColor.rgb, smoothstep(700., 200., distanceFromCamera));
