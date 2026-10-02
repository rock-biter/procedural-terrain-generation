// Yaw that turns an instance about +Y so its local -Z face (the clouds' front
// face, see src/impostors/cloudArchetypes.js) looks at `target` in the XZ
// plane. Mirrors getFacingYaw() in src/cloudPlacement.js. With the target
// straight above or below the base, the face keeps its starting orientation.
void getFacingYaw(vec2 base, vec2 target, out float yawCos, out float yawSin) {
	vec2 toTarget = target - base;
	float targetDistance = length(toTarget);
	vec2 direction = targetDistance > 1e-3 ? toTarget / targetDistance : vec2(0.0, -1.0);
	yawCos = -direction.y;
	yawSin = -direction.x;
}
