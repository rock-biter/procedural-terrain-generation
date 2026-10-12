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
// Screen derivatives of the interpolated climate and ice fields, for their
// world gradients at the biome separators (getFieldGradient()).
vec2 climateScreen = vec2(dFdx(vClimateNoise), dFdy(vClimateNoise));
vec2 iceScreen = vec2(dFdx(vIceValue), dFdy(vIceValue));
// Interpolated from the vertices: no noise per pixel. So is the climate
// (vClimateNoise), read only outside the ice and the deep ocean.
float iceValue = vIceValue;
float oceanValue = vOceanValue;

// The abyss color fills the deep ocean's floor: the rest of the sea (about
// -53 at most) takes at most a trace of it, so no biome is evaluated for it.
float pctAbyss = smoothstep(- uSeaAbyssDepth.x, - uSeaAbyssDepth.y, wPosition.y);
float pctDeep = smoothstep(- 24., - 40., wPosition.y);
diffuseColor.rgb = mix(mix(uSeaColors[1], uSeaColors[2], pctDeep), uSeaColors[3], pctAbyss);
float pctSea = smoothstep(- 6., - 16., wPosition.y);
diffuseColor.rgb = mix(uSeaColors[0], diffuseColor.rgb, pctSea);
// The shoreline, raw heights from 0 to the sand level, is a black ink line
// (below, after the frozen sea), except in the ice, where it stays snow: the
// ice never meets the water with a dark line.
if (wPosition.y > 0.0 && iceValue >= 0.0) diffuseColor.rgb = getTerrainColor(BIOME_ICE, 0, 0.0);
float pctSand = step(wPosition.y, TERRAIN_SAND_LEVEL);

// The frozen sea (sea-ice-pars-fragment.glsl): its coverage keeps the foam
// off the ice and picks the snow normal layer below.
float seaIce = 0.0;
if (wPosition.y < TERRAIN_SAND_LEVEL && iceValue > 0.0) {
	seaIce = applySeaIce(diffuseColor.rgb, wPosition.y, wPosition.xz, iceValue, groundPixel, heightPixel);
}

// The ink lines, the shoreline's and the bands', are computed only from here
// on, so none of their values is kept through the frozen sea. They thin away
// with the distance and their edges soften (getTerrainLineFade()).
vec2 lineFade = getTerrainLineFade(distanceFromCamera);
// The band heights' change across the pixel, from the interpolated ones
// (vBandHeights), taken in uniform control flow.
vec4 bandPixels = fwidth(vBandHeights);
// The shoreline's line (getTerrainLine()) outside the ice, which the frozen
// sea never reaches, over the sea here and on the sand below. It reaches at
// most half its window below the waterline, so the open sea skips it.
float shoreLine = 0.0;
if (iceValue < 0.0 && wPosition.y > - lineFade.y * heightPixel) {
	shoreLine = getTerrainLine(wPosition.y, heightPixel, TERRAIN_SAND_LEVEL, TERRAIN_SAND_LEVEL, lineFade);
	diffuseColor.rgb *= 1.0 - shoreLine;
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
	float climateNoise = iceValue < 0.0 && !inOcean ? vClimateNoise : 0.0;
	float climateValue = getClimateValue(climateNoise, iceValue);
	int biome = getBiome(climateValue, iceValue, oceanValue);

	// Biome separators with a constant world-space width (getBiomeSeparator()),
	// only near a border: the climate border outside the ice and the deep
	// ocean, and the ice border. The gradients come from the interpolated
	// fields' screen derivatives (getFieldGradient()), with no noise. Along the
	// forest ring the effective climate follows the ice field, so its gradient
	// does too.
	// uBiomeClimate.z and uBiomeIce.w bound the fields' slopes; the extra
	// pixels keep the search wide enough for the antialiasing. The deep ocean
	// border needs none: its slope sinks all land before it.
	float biomeBoundary = 0.0;
	float borderReach = BIOME_LINE_HALF_WIDTH + 2.0 * groundPixel;
	if (iceValue < 0.0 && !inOcean && abs(climateValue) < borderReach * uBiomeClimate.z) {
		vec2 gradient;
		bool ringDriven = climateNoise < iceValue + uBiomeIce.z;
		if (!getFieldGradient(ringDriven ? iceScreen : climateScreen, groundDx, groundDy, gradient)) {
			gradient = ringDriven ? getIceGradient(biomeXZ) : getClimateGradient(biomeXZ);
		}
		biomeBoundary = getBiomeSeparator(climateValue, gradient, groundDx, groundDy);
	}
	if (abs(iceValue) < borderReach * uBiomeIce.w) {
		vec2 iceGradient;
		if (!getFieldGradient(iceScreen, groundDx, groundDy, iceGradient)) iceGradient = getIceGradient(biomeXZ);
		biomeBoundary = max(biomeBoundary, getBiomeSeparator(iceValue, iceGradient, groundDx, groundDy));
	}

	// The biome's palette (src/terrainPalettePolicy.js). The slow variation
	// noise (two fields of the baked noise, noise-texture-pars.glsl) drifts the
	// bands that ask for it (the forest's grass, land, and rocks).
	vec3 terrainStyle = uTerrainStyles[biome];
	float biomeVariation = 0.0;
	if (terrainStyle.z > 0.0) {
		biomeVariation = sampleNoiseTile(biomeXZ * 0.001, groundPixel * 0.001).z * 0.3 + 0.6
			+ sampleNoiseTile(biomeXZ * 0.01, groundPixel * 0.01).w * 0.3;
	}
	// 1 leaves the band lines black, 0 removes them.
	float lineDarkness = terrainStyle.y;

	vec3 sandColor = getTerrainColor(biome, 0, biomeVariation);
	// Rocky coast (src/coast.js) darkens the sand gradually, outside the ice
	// and the deep ocean, whose islets keep their bright beaches. The mask is
	// only evaluated where the grass band, wave included, may not yet cover
	// it.
	if (biome != BIOME_ICE && biome != BIOME_DEEP_OCEAN && wPosition.y < TERRAIN_GRASS_LEVEL + 2.0 * TERRAIN_GRASS_WAVE.y) {
		sandColor *= mix(1.0, uCoastSandShade, getCoastRockMask(biomeXZ));
	}
	// The shoreline's upper edge reaches onto the sand.
	diffuseColor.rgb = mix(sandColor * (1.0 - shoreLine), diffuseColor.rgb, pctSand);

	// Each band covers the color below it above its border, then its ink line
	// darkens the color just below the border, both antialiased and the line
	// thinning away with the distance (getTerrainBandBorder()).
	// grass
	float bandHeight = getTerrainBandHeight(wPosition, TERRAIN_GRASS_WAVE);
	vec2 border = getTerrainBandBorder(bandHeight, bandPixels.x, TERRAIN_GRASS_LINE, TERRAIN_GRASS_LEVEL, lineFade);
	pct = 1.0 - border.x;
	diffuseColor.rgb = mix(getTerrainColor(biome, 1, biomeVariation), diffuseColor.rgb, pct);
	diffuseColor.rgb *= 1.0 - lineDarkness * border.y;

	// land
	bandHeight = getTerrainBandHeight(wPosition, TERRAIN_LAND_WAVE);
	border = getTerrainBandBorder(bandHeight, bandPixels.y, TERRAIN_LAND_LINE, TERRAIN_LAND_LEVEL, lineFade);
	pct2 = 1.0 - border.x;
	diffuseColor.rgb = mix(getTerrainColor(biome, 2, biomeVariation), diffuseColor.rgb, pct2);
	diffuseColor.rgb *= 1.0 - lineDarkness * border.y;

	// rocks
	bandHeight = getTerrainBandHeight(wPosition, TERRAIN_ROCKS_WAVE);
	border = getTerrainBandBorder(bandHeight, bandPixels.z, TERRAIN_ROCKS_LINE, TERRAIN_ROCKS_LEVEL, lineFade);
	pctRock = 1.0 - border.x;
	diffuseColor.rgb = mix(getTerrainColor(biome, 3, biomeVariation), diffuseColor.rgb, pctRock);
	diffuseColor.rgb *= 1.0 - lineDarkness * border.y;

	// snow
	bandHeight = getTerrainBandHeight(wPosition, TERRAIN_SNOW_WAVE);
	border = getTerrainBandBorder(bandHeight, bandPixels.w, TERRAIN_SNOW_LINE, TERRAIN_SNOW_LEVEL, lineFade);
	pct3 = 1.0 - border.x;
	diffuseColor.rgb = mix(getTerrainColor(biome, 4, biomeVariation), diffuseColor.rgb, pct3);
	diffuseColor.rgb *= 1.0 - lineDarkness * border.y;

	// Soft lighter patches, scaled per biome, and the biome separator, on land
	// only.
	if (terrainStyle.x > 0.0) {
		diffuseColor.rgb *= 1.0 + (getTerrainColorShade(biomeXZ, groundPixel) - 1.0) * terrainStyle.x;
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

// The moving sea (sea-surface-pars.glsl): its waves, calm toward the coast
// and still under the frozen sea's sheet, tilt the normals
// (normal-fragment-map.glsl), the floes' too where the waves reach under them
// (getSeaIceStill()), and draw foam lines along their highest crests, a few
// even in calm water, never on the ice. The deep ocean's settings take over
// inside its border.
float seaState = vSeaState;
float seaOceanMask = getSeaOceanMask(oceanValue);
SeaWaves seaWaves = SeaWaves(vec3(0.0), vec2(0.0), vec4(0.0), vec3(0.0), 0.0, vec4(0.0), 0.0, 0.0);
if (wPosition.y < 0.0) {
	float seaStill = iceValue > 0.0 ? getSeaIceStill(wPosition.y, iceValue) : 0.0;
	seaWaves = getSeaWaves(wPosition.xz, -wPosition.y, seaOceanMask, seaState, seaStill, groundPixel, vSeaWaveNoise);
	int crestFoamStyle = int(uSeaCrestFoam + 0.5);
	float crestFoam = crestFoamStyle != 1 ? getSeaCrestLine(seaWaves, wPosition.xz, seaOceanMask, seaState, groundPixel) : 0.0;
	if (crestFoamStyle > 0) crestFoam = max(crestFoam, getSeaBreakingFoam(seaWaves, wPosition.xz, seaOceanMask, seaState, groundPixel));
	diffuseColor.rgb = mix(diffuseColor.rgb, uSeaFoamColor, crestFoam * (1.0 - seaIce));
}
vec3 seaWaveNormal = getSeaWaveNormal(seaWaves);

// Foam lines (sea-ripple-pars-fragment.glsl) on one sea height: the raw
// height fused with the sea rocks' virtual height from the foam map, whose
// change across the pixel is taken here, in uniform control flow. The ice
// stills them; they mix toward the foam color like the crest lines.
float seaFoamHeight = getSeaFoamHeight(wPosition.y, wPosition.xz);
float seaFoamHeightPixel = 0.5 * (abs(dFdx(seaFoamHeight)) + abs(dFdy(seaFoamHeight)));
float onda = getSeaRipple(seaFoamHeight, seaFoamHeightPixel, wPosition.xz, seaOceanMask, seaState, groundPixel) * (1.0 - seaIce);
diffuseColor.rgb = mix(diffuseColor.rgb, uSeaFoamColor, onda);

int seaDebugView = int(uSeaSurface.w + 0.5);
if (seaDebugView > 0 && wPosition.y < 0.0) {
	diffuseColor.rgb = getSeaSurfaceDebug(seaDebugView, seaState, seaOceanMask, seaWaves);
}

// Distant terrain is capped by the day/night atmosphere color.
diffuseColor.rgb = mix(min(uAtmosphere, diffuseColor.rgb), diffuseColor.rgb, smoothstep(700., 200., distanceFromCamera));
