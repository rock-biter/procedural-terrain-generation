// Wind on the near scenery meshes (SCENERY_WIND; rules in
// src/sceneryWindPolicy.js, uniforms written by setSceneryWindUniforms() in
// src/impostors/sceneryMeshes.js). Gusts of the baked noise travel downwind
// and bend each tree from its base; a finer noise shivers its painted parts
// (crowns and fronds). The impostors stay still, so the motion fades out
// before they take over. Follows scenery-instance-pars-vertex.glsl.
#include ./noise-texture-pars.glsl

// x: sway, y: flutter, in units at the top of a scale-1 tree with sensitivity
// 1; zw: unit XZ direction the wind blows toward.
uniform vec4 uSceneryWind;
// x: gust frequency (per world unit), y: gust speed (units per second
// downwind), z: flutter frequency (per world unit), w: flutter speed (noise
// units per second).
uniform vec4 uSceneryWindNoise;
// Eye distance to the flat base: x full motion below, y none beyond.
uniform vec2 uSceneryWindRange;
// Per type: the wind's share (0 keeps the type still) and 1 / LOD 0 height.
uniform float uSceneryWindSensitivity[IMPOSTOR_TYPE_COUNT];
uniform float uSceneryWindHeight[IMPOSTOR_TYPE_COUNT];

// Moves `offset`, a vertex of an instance of `type` relative to its flat
// world `base` (scaled, stretched, and yawed, before the bend), whose source
// height is `localY`. `size` is the instance's vertical scale, `eyeDistance`
// the eye's distance to the base, and `paint` the source's paint mask, which
// limits the flutter to the crowns and fronds.
vec3 applySceneryWind(vec3 offset, float localY, int type, vec3 base, float size, float eyeDistance, float paint) {
	float strength = uSceneryWindSensitivity[type]
		* (1.0 - smoothstep(uSceneryWindRange.x, uSceneryWindRange.y, eyeDistance));
	if (strength <= 0.0) return offset;

	vec2 direction = uSceneryWind.zw;
	// Share of the source height: the base stays put, the top moves most.
	float height = clamp(localY * uSceneryWindHeight[type], 0.0, 1.0);

	// Gusts: two octaves of a field that slides downwind, so the gusts cross
	// the woods as waves. Along the wind the tree bends and springs back
	// (along in [0, 1]); across it, it sways less.
	vec2 gustPosition = (base.xz - direction * (uTime * uSceneryWindNoise.y)) * uSceneryWindNoise.x;
	vec2 gust = sampleNoiseTile(gustPosition + 41.7, 0.0).xy * 0.65
		+ sampleNoiseTile(gustPosition * 3.1 - 13.3, 0.0).xy * 0.35;
	vec2 across = vec2(-direction.y, direction.x);
	vec2 sway = (direction * (0.5 + 0.5 * gust.x) + across * (0.35 * gust.y))
		* (uSceneryWind.x * strength * size * height * height);
	vec3 moved = offset + vec3(sway.x, 0.0, sway.y);
	// The tip of a rod of length L moved by d drops by about d² / 2L, so the
	// tree bends instead of stretching.
	moved.y -= dot(sway, sway) / (2.0 * max(offset.y, 1e-3));

	// Flutter: a finer field that also slides downwind, sampled where the
	// vertex is, so the parts of a crown shiver apart.
	if (paint > 0.0) {
		vec2 flutterPosition = (base.xz + offset.xz + vec2(offset.y, -offset.y) * 0.6) * uSceneryWindNoise.z
			- direction * (uTime * uSceneryWindNoise.w);
		vec4 flutter = sampleNoiseTile(flutterPosition + 7.9, 0.0);
		moved += vec3(flutter.z, flutter.x * 0.5, flutter.w)
			* (uSceneryWind.y * strength * size * height * paint);
	}
	return moved;
}
