// Replaces <project_vertex>: scale, stretch, yaw, a floating boat's tilt, a
// tree's sway in the wind, then the rigid bend around the curved base,
// matching the impostor's baked local frame (the wind has faded out where the
// impostor takes over).
vec3 sceneryVertex = curvedBase;
vec3 sceneryOffset = rotateAroundAxis(
	rotateYaw(transformed * vec3(1.0, sceneryStretch, 1.0) * sceneryScale, yawCos, yawSin),
	sceneryTiltAxis,
	sceneryTiltCos,
	sceneryTiltSin
);
#ifdef SCENERY_WIND
// The trees sway in the wind near the eye (scenery-wind-pars-vertex.glsl).
#ifdef SCENERY_PALETTE
float sceneryWindPaint = paint;
#else
float sceneryWindPaint = 0.0;
#endif
sceneryOffset = applySceneryWind(sceneryOffset, transformed.y, sceneryType, sceneryBase, sceneryScale * sceneryStretch, eyeDistance, sceneryWindPaint);
#endif
// Instances this level does not draw collapse to their base: zero-area
// triangles that the rasterizer drops.
if (levelShare > 0.0) {
	sceneryVertex += rotateAroundAxis(sceneryOffset, bendAxis, bendCos, bendSin);
}
// Shadows use the flat instance (no bend), like the shadow casters.
vShadowPosition = sceneryBase + sceneryOffset;
vShadowSelfBias = uSceneryBoundRadius[sceneryType] * sceneryScale * max(sceneryStretch, 1.0);
distanceFromCamera = baseDistance;
wPosition = sceneryVertex;
vec4 mvPosition = viewMatrix * vec4(sceneryVertex, 1.0);
gl_Position = projectionMatrix * mvPosition;
