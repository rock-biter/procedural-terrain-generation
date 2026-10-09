// Same curvature and bend as project-vertex.glsl, evaluated once at a flat
// world `base` so a whole object tilts rigidly with the sphere: its distance
// from the airplane, the base dropped onto the sphere, the sphere normal
// there, and the rotation (axis, cosine, sine) from flat to curved. Shared by
// the scenery instances (scenery-instance-pars-vertex.glsl) and the aurora
// (aurora.vert.glsl); common.glsl must be included before.
#ifndef CURVATURE_BEND
#define CURVATURE_BEND
void getCurvatureBend(
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
	curvedBase.y -= getCurvatureDrop(baseDistance);
}
#endif
