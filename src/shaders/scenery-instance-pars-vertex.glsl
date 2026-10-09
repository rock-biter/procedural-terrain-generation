// Instance layout and helpers shared by impostors and near scenery meshes, so
// both draw an instance with the same transform, tint, and cross-fade.
// xyz: base position (chunk space for impostors, world space for meshes),
// w: scale.
attribute vec4 aInstanceA;
// x: yaw (also the dither seed; only the seed with SCENERY_FACE_AIRPLANE), y:
// type index, z: packed RGB tint, w: vertical stretch.
attribute vec4 aInstanceB;
// Position-based brightness variation: amount per type and a shared world
// frequency for the noise that drives it.
uniform float uImpostorVariationAmount[IMPOSTOR_TYPE_COUNT];
uniform float uImpostorVariationFrequency;
// Eye-distance band where the impostor hands over to the mesh: x start (mesh
// only below), y end (impostor only beyond). See src/sceneryMeshPolicy.js.
uniform vec2 uSceneryMeshRange;
varying vec3 vTint;
varying vec3 vSphereNormal;
// x: mesh fade (1 mesh, 0 impostor), y: per-instance dither seed.
varying vec2 vSceneryDither;
// Scenery shadow lookup (scenery-shadow-pars-fragment.glsl): flat world
// position, and the instance radius that keeps it out of its own flat caster
// quad.
varying vec3 vShadowPosition;
varying float vShadowSelfBias;

#include ./rotate-yaw.glsl
#include ./scenery-facing.glsl
#include ./curvature-bend.glsl

// Mirrors getSceneryMeshFade() in src/sceneryMeshPolicy.js.
float getSceneryMeshFade(float eyeDistance) {
	return 1.0 - smoothstep(uSceneryMeshRange.x, uSceneryMeshRange.y, eyeDistance);
}

// Unpacks the placement tint (bytes, 255 maps to 2.0) and applies the
// position-based brightness variation, sampled at the flat world base so the
// shade never shifts as the plane moves.
vec3 getSceneryTint(float packedTint, vec2 baseXZ, int type) {
	vec3 tint = vec3(
		mod(packedTint, 256.0),
		mod(floor(packedTint / 256.0), 256.0),
		floor(packedTint / 65536.0)
	) * (2.0 / 255.0);

	// Neighbouring instances share a similar shade while distant groups differ.
	vec2 variationPosition = baseXZ * uImpostorVariationFrequency;
	float variationNoise = snoise(variationPosition) * 0.7
		+ snoise(variationPosition * 4.3 + 17.0) * 0.3;
	// The summed octaves rarely exceed ±0.7; stretch them so groups reach the
	// extremes. The amount is in stops: 1 spans half to double brightness.
	variationNoise = clamp(variationNoise * 1.6, -1.0, 1.0);
	return tint * exp2(variationNoise * uImpostorVariationAmount[type]);
}

#ifdef SCENERY_PALETTE
// Palette per type (tree crowns, whole cacti and rocks), one color per
// instance picked from world-space noise, or by biome (src/sceneryPalettePolicy.js). Colors are linear and
// divided by SCENERY_PAINT_BASE, the gray the painted types are baked in.
// Unpainted types have zero weights and white colors, so both of their tints
// stay the plain tint.
uniform vec3 uSceneryPaletteColors[IMPOSTOR_TYPE_COUNT * SCENERY_PALETTE_SIZE];
// Relative share of each palette slot; 0 disables the slot.
uniform vec4 uSceneryPaletteWeights[IMPOSTOR_TYPE_COUNT];
uniform vec3 uSceneryTrunkColors[IMPOSTOR_TYPE_COUNT];
// Per type, x: patch frequency per world unit, y: random mix (0 noise patches
// only, 1 a random color per instance), z: palette index, which selects the
// noise fields (types sharing a palette share its map), w: 1 to pick the color
// by biome instead (slot 0 temperate, slot 1 desert, slot 2 ice; placement
// stores the slot in the tint, see getSceneryPaletteTints()).
uniform vec4 uSceneryPaletteNoise[IMPOSTOR_TYPE_COUNT];
// Tint of the painted parts (paint 1); vTint holds the unpainted parts' (the
// trunk's).
varying vec3 vPaintTint;

// Uniform [0, 1) hash of the instance seed (its yaw bits) and a slot. Integer
// math gives the impostor and the mesh programs the same value.
float getSceneryPaletteHash(float seed, int slot) {
	uint h = floatBitsToUint(seed) ^ (uint(slot) * 0x9E3779B9u);
	h ^= h >> 16;
	h *= 0x7FEB352Du;
	h ^= h >> 15;
	h *= 0x846CA68Bu;
	h ^= h >> 16;
	return float(h >> 8) * (1.0 / 16777216.0);
}

// Splits the instance tint into the trunk and painted tints. `tint` is the
// decoded tint (getSceneryTint()) and `packedTint` its packed value. Painted
// types (positive weights) vary in brightness only: their red channel holds
// it, and placement keeps the blue byte for the biome's palette slot
// (getPaintedTint() in src/sceneryPlacement.js), which palettes picked by
// biome (the rocks) read. The others draw a slot from noise: every slot has
// its own noise field; the slot with the largest log(value) / weight wins, a
// weighted race in which each slot's share follows its weight.
void getSceneryPaletteTints(
	vec3 tint,
	float packedTint,
	vec2 baseXZ,
	float seed,
	int type,
	out vec3 trunkTint,
	out vec3 paintTint
) {
	vec4 weights = uSceneryPaletteWeights[type];
	vec4 paletteNoise = uSceneryPaletteNoise[type];
	if (dot(weights, vec4(1.0)) > 0.0) tint = vec3(tint.r);
	if (paletteNoise.w > 0.5) {
		int biomeSlot = int(floor(packedTint / 65536.0));
		trunkTint = tint * uSceneryTrunkColors[type];
		paintTint = tint * uSceneryPaletteColors[type * SCENERY_PALETTE_SIZE + biomeSlot];
		return;
	}
	// Shifted by the seeded biome offset, so every world seed paints its own map.
	vec2 palettePosition = (baseXZ + uBiomeOffset.xy) * paletteNoise.x;
	int chosen = 0;
	float bestKey = -1e30;
	for (int slot = 0; slot < SCENERY_PALETTE_SIZE; slot++) {
		float weight = weights[slot];
		if (weight <= 0.0) continue;
		// Offsets within snoise's 289-unit period keep every palette's and slot's
		// field apart.
		float fieldIndex = paletteNoise.z * float(SCENERY_PALETTE_SIZE) + float(slot);
		vec2 offset = fract(fieldIndex * vec2(0.618034, 0.414214)) * 289.0;
		float field = clamp(snoise(palettePosition + offset) * 0.8 + 0.5, 0.0, 1.0);
		float value = mix(field, getSceneryPaletteHash(seed, slot), paletteNoise.y);
		float key = log(max(value, 1e-6)) / weight;
		if (key > bestKey) {
			bestKey = key;
			chosen = slot;
		}
	}
	trunkTint = tint * uSceneryTrunkColors[type];
	paintTint = tint * uSceneryPaletteColors[type * SCENERY_PALETTE_SIZE + chosen];
}
#endif
