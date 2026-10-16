// Impostor shadow caster: each impostor instance is a quad facing the light
// through its bounding-sphere center, in flat world space (no curvature, bend,
// or mesh fade), textured with the baked frames closest to the light
// direction, cast into the depth cascades (src/sceneryShadows.js).
// Same layout as scenery-instance-pars-vertex.glsl.
attribute vec4 aInstanceA;
attribute vec4 aInstanceB;
// x: frame radius, y: bounding-sphere center height, per impostor type.
uniform vec2 uImpostorTypes[IMPOSTOR_TYPE_COUNT];
// World direction toward the light the cascade cameras look along.
uniform vec3 uShadowCasterLight;
varying vec4 vFrame0;
varying vec4 vFrame1;
varying vec4 vFrame2;
varying vec3 vFrameWeights;

#include ./impostor-octahedral.glsl
#include ./rotate-yaw.glsl

void main() {
	float impostorScale = aInstanceA.w;
	float impostorYaw = aInstanceB.x;
	int impostorType = int(aInstanceB.y + 0.5);
	float impostorStretch = aInstanceB.w;
	vec2 impostorInfo = uImpostorTypes[impostorType];
	float frameRadius = impostorInfo.x;

	vec3 base = (modelMatrix * vec4(aInstanceA.xyz, 1.0)).xyz;
	vec3 center = base + vec3(0.0, impostorInfo.y * impostorScale * impostorStretch, 0.0);
	vec3 lightRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
	vec3 lightUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
	float halfSize = frameRadius * impostorScale * max(impostorStretch, 1.0);
	vec3 vertex = center + (lightRight * position.x + lightUp * position.y) * halfSize;

	// World to baked local space: undo yaw, scale, and stretch.
	float yawCos = cos(impostorYaw);
	float yawSin = sin(impostorYaw);
	vec3 localScale = vec3(1.0, impostorStretch, 1.0) * max(impostorScale, 1e-4);
	vec3 lightLocal = normalize(rotateYaw(uShadowCasterLight, yawCos, -yawSin) / localScale);
	vec3 vertexLocal = rotateYaw(vertex - center, yawCos, -yawSin) / localScale;
	// A viewer far along the light makes getFrameUv() an orthographic projection.
	vec3 viewerLocal = vertexLocal + lightLocal * (frameRadius * 4.0);

	vec4 frame0;
	vec4 frame1;
	vec4 frame2;
	vec3 frameWeights;
	selectImpostorFrames(lightLocal, viewerLocal, vertexLocal, impostorType, frameRadius, frame0, frame1, frame2, frameWeights);
	vFrame0 = frame0;
	vFrame1 = frame1;
	vFrame2 = frame2;
	vFrameWeights = frameWeights;

	gl_Position = projectionMatrix * viewMatrix * vec4(vertex, 1.0);
}
