#include <color_fragment>

// Mirrored by getBiomeValue() in src/biome.js; keep both in sync.
vec2 biomeXZ = wPosition.xz + uBiomeOffset;
float biomeNoise = snoise(biomeXZ * 0.00035);
float biomeEdgeNoise = snoise(biomeXZ * 0.0035) * 0.22;
biomeEdgeNoise += snoise(biomeXZ * 0.012) * 0.06;
float biomeValue = biomeNoise + biomeEdgeNoise;
float biomeBlend = step(0.0, biomeValue);
float biomePixelWidth = max(fwidth(biomeValue), 0.00001);
float biomeBoundary = 1.0 - smoothstep(biomePixelWidth, biomePixelWidth * 2.0, abs(biomeValue));
float currentBiomeVariation = snoise(biomeXZ * 0.001) * 0.3 + 0.6 + snoise(biomeXZ * 0.01) * 0.3;

vec3 currentSand = vec3(0.9, 0.8, 0.5);
vec3 currentGrass = mix(uGrass, vec3(0.33, 0.2, 0.0), currentBiomeVariation * 0.5);
vec3 currentLand = mix(uLand, vec3(0.1, 0.25, 0.1), currentBiomeVariation * 0.5);
vec3 currentRocks = mix(uRocks, vec3(0.01, 0.0, 0.01), currentBiomeVariation);
vec3 currentSnow = vec3(0.4, 0.8, 0.9);

vec3 sandBiomes = mix(vec3(0.92, 0.72, 0.42), currentSand, biomeBlend);
vec3 grassBiomes = mix(vec3(0.76, 0.48, 0.2), currentGrass, biomeBlend);
vec3 landBiomes = mix(vec3(0.68, 0.3, 0.1), currentLand, biomeBlend);
vec3 rocksBiomes = mix(vec3(0.35, 0.16, 0.07), currentRocks, biomeBlend);
vec3 snowBiomes = mix(vec3(0.18, 0.08, 0.035), currentSnow, biomeBlend);

float pctDeep = smoothstep(- 24., - 40., wPosition.y);
diffuseColor.rgb = mix(vec3(0.0, 0., 0.5), vec3(0.0, 0., 0.02), pctDeep);
float pctSea = smoothstep(- 6., - 16., wPosition.y);
diffuseColor.rgb = mix(vec3(0., 0.2, .6), diffuseColor.rgb, pctSea);
diffuseColor.rgb = mix(vec3(0., 0., 0.), diffuseColor.rgb, step(wPosition.y, 0.));
float pctSand = step(wPosition.y, 0.1);
diffuseColor.rgb = mix(sandBiomes, diffuseColor.rgb, pctSand);

		// green
float pctLine = step(wPosition.y + sin(wPosition.x * 0.3) * 0.6 + cos(wPosition.z * 0.3) * 0.6, 1.6);
float pct = step(wPosition.y + sin(wPosition.x * 0.3) * 0.6 + cos(wPosition.z * 0.3) * 0.6, 1.7);

diffuseColor.rgb = mix(vec3(0., 0., 0.), diffuseColor.rgb, pctLine);
	  // diffuseColor.rgb = mix(vec3(0.1,0.4,0.),diffuseColor.rgb,pct);
diffuseColor.rgb = mix(grassBiomes, diffuseColor.rgb, pct);

		// orange
pctLine = step(wPosition.y + sin(wPosition.x * 0.1) * 1.6 + cos(wPosition.z * 0.1) * 1.6, 14.);
float pct2 = step(wPosition.y + sin(wPosition.x * 0.1) * 1.6 + cos(wPosition.z * 0.1) * 1.6, 14.1);
diffuseColor.rgb = mix(vec3(0., 0., 0.), diffuseColor.rgb, pctLine);
	  // diffuseColor.rgb = mix(vec3(0.8,0.3,0.),diffuseColor.rgb,pct2);
diffuseColor.rgb = mix(landBiomes, diffuseColor.rgb, pct2);

		// brown
pctLine = step(wPosition.y + sin(wPosition.x * 0.15) * 2.5 + cos(wPosition.z * 0.15) * 2.5, 22.);
float pctRock = step(wPosition.y + sin(wPosition.x * 0.15) * 2.5 + cos(wPosition.z * 0.15) * 2.5, 22.2);
diffuseColor.rgb = mix(vec3(0.0, 0.0, 0.0), diffuseColor.rgb, pctLine);
	  // diffuseColor.rgb = mix(vec3(0.09,0.05,0.01),diffuseColor.rgb,pctRock);
diffuseColor.rgb = mix(rocksBiomes, diffuseColor.rgb, pctRock);

		// snow
pctLine = step(wPosition.y + sin(wPosition.x * 0.15) * 5. + cos(wPosition.z * 0.15) * 5., 40.);
float pct3 = step(wPosition.y + sin(wPosition.x * 0.15) * 5. + cos(wPosition.z * 0.15) * 5., 40.2);
diffuseColor.rgb = mix(vec3(0., 0., 0.), diffuseColor.rgb, pctLine);
diffuseColor.rgb = mix(snowBiomes, diffuseColor.rgb, pct3);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.0), biomeBoundary * step(0.1, wPosition.y));

float onda = sin(wPosition.y * 8. - uTime * 4. + sin(wPosition.x * 0.5) + sin(wPosition.z * 0.5)) * 0.5 + 0.5;
onda *= onda * onda * onda;
float d = - 3.5;
onda *= smoothstep(d, d - 1.5, wPosition.y) - smoothstep(d - 3., d - 4., wPosition.y);
		// float dash = sin(wPosition.x * .35) * 0.5 + 0.5;
		// onda = mix(onda,0.,sin(wPosition.y * 0.2 + sin(wPosition.x * 0.02) * 5. + sin(wPosition.z * 0.02) * 5.) * 0.5 + 0.5);
onda = mix(onda * 0.5, 0., sin(wPosition.y + wPosition.x * 0.2));
diffuseColor.rgb = mix(vec3(onda), diffuseColor.rgb, 1. - onda);

// Distant terrain is capped by the day/night atmosphere color.
diffuseColor.rgb = mix(min(uAtmosphere, diffuseColor.rgb), diffuseColor.rgb, smoothstep(700., 200., distanceFromCamera));