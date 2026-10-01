// Replaces <project_vertex>: scale, stretch, yaw, then the rigid bend around
// the curved base, matching the impostor's baked local frame.
vec3 sceneryVertex = curvedBase;
// Instances past the band collapse to their base: zero-area triangles that the
// rasterizer drops.
if (meshFade > 0.0) {
	vec3 sceneryLocal = transformed * vec3(1.0, sceneryStretch, 1.0) * sceneryScale;
	sceneryVertex += rotateAroundAxis(rotateYaw(sceneryLocal, yawCos, yawSin), bendAxis, bendCos, bendSin);
}
distanceFromCamera = baseDistance;
wPosition = sceneryVertex;
vec4 mvPosition = viewMatrix * vec4(sceneryVertex, 1.0);
gl_Position = projectionMatrix * mvPosition;
