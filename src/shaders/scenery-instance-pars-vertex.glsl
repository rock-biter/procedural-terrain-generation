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

vec3 rotateYaw(vec3 v, float c, float s) {
	return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

#include ./scenery-facing.glsl

// Mirrors getSceneryMeshFade() in src/sceneryMeshPolicy.js.
float getSceneryMeshFade(float eyeDistance) {
	return 1.0 - smoothstep(uSceneryMeshRange.x, uSceneryMeshRange.y, eyeDistance);
}

// Same curvature and bend as project-vertex.glsl, evaluated once at the flat
// world base so the whole instance tilts rigidly with the sphere.
void getSceneryBend(
	vec3 base,
	out float baseDistance,
	out vec3 curvedBase,
	out vec3 sphereNormal,
	out vec3 bendAxis,
	out float bendCos,
	out float bendSin
) {
	baseDistance = length(base - uCamera);
	sphereNormal = vec3(0.0, 1.0, 0.0);
	bendAxis = vec3(1.0, 0.0, 0.0);
	bendCos = 1.0;
	bendSin = 0.0;
	vec2 horizontalOffset = base.xz - uCamera.xz;
	float horizontalLength = length(horizontalOffset);
	if (horizontalLength > 0.0001) {
		vec3 awayDirection = vec3(horizontalOffset.x, 0.0, horizontalOffset.y) / horizontalLength;
		bendAxis = cross(vec3(0.0, 1.0, 0.0), awayDirection);
		float bendAngle = baseDistance / uCurvature;
		bendCos = cos(bendAngle);
		bendSin = sin(bendAngle);
		sphereNormal = vec3(0.0, bendCos, 0.0) + awayDirection * bendSin;
	}
	curvedBase = base;
	curvedBase.y -= uCurvature * (1.0 - cos(baseDistance / uCurvature));
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
