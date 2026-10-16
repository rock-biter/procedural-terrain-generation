// The horizon clouds' shape (rules in src/horizonCloudsPolicy.js, uniforms
// written by src/horizonClouds.js): banks of toon cumulus on a ring around the
// eye, evaluated per view direction in angular coordinates, the azimuth around
// the eye and the elevation above the curved world's visible edge, both in
// radians. The sky (horizon-clouds-shading.glsl) shades them; the lens
// flare's occlusion and the aurora read only their coverage. Self-contained
// (no <common>) and guarded: several shaders include it. Their materials add
// HORIZON_CLOUD_SHADER_DEFINES (src/horizonCloudsPolicy.js):
// HORIZON_CLOUD_ABS_MEAN, the noise's mean absolute value, which the billow
// lobes subtract so they average to zero.
#ifndef HORIZON_CLOUDS_PARS
#define HORIZON_CLOUDS_PARS

// The baked noise tile (src/noiseTexture.js), shared with
// noise-texture-pars.glsl.
#ifndef NOISE_TEXTURE_SAMPLER
#define NOISE_TEXTURE_SAMPLER
uniform sampler2D uNoiseTexture;
#endif

// x: the visible edge's dip below the horizontal, y and z: the lowest and
// highest elevation above it a cloud pixel can reach, w: 1 while the clouds
// show.
uniform vec4 uHorizonCloudFrame;
// x: the radius (tile units) of the circle the bank layer follows in the
// tile, which closes on itself over a turn; yzw: the billow octaves' tile
// repeats per turn, whole numbers so the ring has no seam.
uniform vec4 uHorizonCloudRepeats;
// Tile coordinate offsets: [0].xy the bank circle's center, [0].zw the first
// billow octave, [1].xy the second, [1].zw the third (each rising with time).
uniform vec4 uHorizonCloudOffsets[2];
// x: the wind's turn of the ring, y: billow octaves of the shape, z: of the
// light sample, w: the most the billows lift a top (radians).
uniform vec4 uHorizonCloudMotion;
// (cos, sin) of the morph angles: xy the bank's, zw the billows'. Each layer
// mixes two independent channels with them, which keeps their spread.
uniform vec4 uHorizonCloudMorph;
// x: the coverage threshold, y: the noise rise above it to a bank's full
// height, z and w: the lowest and highest full height above the flat base
// (radians).
uniform vec4 uHorizonCloudShape;
// x: the first octave's lobe height (radians), y: each octave's share of the
// previous one, z: how much smaller the lobes are at the base, w: the flat
// base's depth below the visible edge (radians).
uniform vec4 uHorizonCloudBillow;
// x: the outline's softness (radians), y: the extra softness of lost edges
// (a share), z: the dry-brush roughness (radians), w: the antialias width in
// pixels.
uniform vec4 uHorizonCloudEdge;

const float HORIZON_CLOUD_TURN = 6.28318531;

// The tile's four channels, about [-1, 1], at tile coordinates `uv` of a
// layer that spans `tilesPerRadian`, seen through pixels of `pixelAngle`
// radians. The mip level comes from that footprint: the callers sit in
// non-uniform control flow, and the azimuth jumps by a turn across its seam.
vec4 sampleHorizonCloudTile(vec2 uv, float tilesPerRadian, float pixelAngle, out float lod) {
	lod = log2(max(pixelAngle * tilesPerRadian * float(textureSize(uNoiseTexture, 0).x), 1e-4));
	return textureLod(uNoiseTexture, uv, lod) * 2.0 - 1.0;
}

// The bank at `azimuth` (radians, the wind applied): x its top above the flat
// base (radians), y its presence (0 between banks, 1 inside one), z its tower
// noise (0 low, 1 tall), w unused. A bank rises where the noise passes the
// coverage threshold, as a dome (the square root of the noise above it),
// toward a full height from a second field. The layer follows a circle in
// the periodic tile, which closes over a turn whatever its size: the banks
// can be wider than a whole tile per turn allows.
vec4 getHorizonCloudBank(float azimuth, float pixelAngle) {
	float radius = uHorizonCloudRepeats.x;
	float lod;
	vec2 uv = uHorizonCloudOffsets[0].xy + radius * vec2(cos(azimuth), sin(azimuth));
	vec4 noise = sampleHorizonCloudTile(uv, radius, pixelAngle, lod);
	float rise = clamp((dot(noise.xy, uHorizonCloudMorph.xy) - uHorizonCloudShape.x) / uHorizonCloudShape.y, 0.0, 1.0);
	float tower = smoothstep(-0.55, 0.55, dot(noise.zw, uHorizonCloudMorph.xy));
	float top = sqrt(rise) * mix(uHorizonCloudShape.z, uHorizonCloudShape.w, tower);
	return vec4(top, smoothstep(0.0, 0.2, rise), tower, 0.0);
}

// One billow octave at `p`: rounded lobes with sharp creases between them
// (the noise's absolute value less its mean), faded out once the octave is
// finer than the pixels, where the mips average it away. `spare` returns its
// two other channels.
float getHorizonCloudOctave(vec2 p, float repeats, vec2 offset, float pixelAngle, out vec2 spare) {
	float lod;
	float tilesPerRadian = repeats / HORIZON_CLOUD_TURN;
	vec4 noise = sampleHorizonCloudTile(p * tilesPerRadian + offset, tilesPerRadian, pixelAngle, lod);
	spare = noise.zw;
	float lobes = abs(dot(noise.xy, uHorizonCloudMorph.zw)) - HORIZON_CLOUD_ABS_MEAN;
	return lobes * (1.0 - smoothstep(1.0, 3.0, lod));
}

// Signed density of the clouds at `p` (x the azimuth with the wind, y the
// elevation above the visible edge, in radians) for the bank there: positive
// inside, about the angular distance to the outline. The top is the bank's
// plus `octaves` billow octaves, which grow toward it; the base is flat.
// `spare` returns the first octave's spare channels (xy) and the last one's
// (zw).
float getHorizonCloudDensity(vec2 p, vec4 bank, float pixelAngle, float octaves, out vec4 spare) {
	float height = p.y + uHorizonCloudBillow.w;
	float topShare = clamp(height / max(bank.x, 1e-4), 0.0, 1.0);
	float amplitude = uHorizonCloudBillow.x * bank.y * (1.0 - uHorizonCloudBillow.z * (1.0 - topShare));

	vec2 octaveSpare;
	vec2 firstSpare = vec2(0.0);
	vec2 lastSpare = vec2(0.0);
	float billow = 0.0;
	float weight = 1.0;
	if (octaves > 0.5) {
		billow = getHorizonCloudOctave(p, uHorizonCloudRepeats.y, uHorizonCloudOffsets[0].zw, pixelAngle, octaveSpare);
		firstSpare = octaveSpare;
		lastSpare = octaveSpare;
	}
	weight *= uHorizonCloudBillow.y;
	if (octaves > 1.5) {
		billow += weight * getHorizonCloudOctave(p, uHorizonCloudRepeats.z, uHorizonCloudOffsets[1].xy, pixelAngle, octaveSpare);
		lastSpare = octaveSpare;
	}
	weight *= uHorizonCloudBillow.y;
	if (octaves > 2.5) {
		billow += weight * getHorizonCloudOctave(p, uHorizonCloudRepeats.w, uHorizonCloudOffsets[1].zw, pixelAngle, octaveSpare);
		lastSpare = octaveSpare;
	}

	spare = vec4(firstSpare, lastSpare);
	return min(bank.x + billow * amplitude - height, height);
}

// Coverage of a density: a soft outline, softer on the lost edges
// (`lostEdge` 0 to 1), never sharper than the antialias width.
float getHorizonCloudAlpha(float density, float lostEdge, float pixelAngle) {
	float softness = uHorizonCloudEdge.x * (1.0 + uHorizonCloudEdge.y * lostEdge);
	return smoothstep(0.0, max(softness, pixelAngle * uHorizonCloudEdge.w), density);
}

// Elevation of a view direction above the visible edge, in radians.
float getHorizonCloudElevation(vec3 direction) {
	return asin(clamp(direction.y, -1.0, 1.0)) + uHorizonCloudFrame.x;
}

// True where a cloud may cover an elevation: the clouds show and it lies in
// their band.
bool isInHorizonCloudBand(float elevation) {
	return uHorizonCloudFrame.w > 0.5 && elevation > uHorizonCloudFrame.y && elevation < uHorizonCloudFrame.z;
}

// The share of a view direction the clouds cover, 0 to 1, for pixels of
// `pixelAngle` radians: the shape without its light.
float getHorizonCloudCoverage(vec3 direction, float pixelAngle) {
	float elevation = getHorizonCloudElevation(direction);
	if (!isInHorizonCloudBand(elevation)) return 0.0;
	vec2 p = vec2(atan(direction.z, direction.x) - uHorizonCloudMotion.x, elevation);
	vec4 bank = getHorizonCloudBank(p.x, pixelAngle);
	if (bank.y <= 0.0 || p.y + uHorizonCloudBillow.w > bank.x + uHorizonCloudMotion.w * bank.y) return 0.0;
	vec4 spare;
	float density = getHorizonCloudDensity(p, bank, pixelAngle, uHorizonCloudMotion.y, spare);
	density += uHorizonCloudEdge.z * spare.z;
	return getHorizonCloudAlpha(density, smoothstep(-0.3, 0.6, spare.x), pixelAngle);
}

#endif
