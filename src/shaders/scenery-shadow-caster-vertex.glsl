// Impostor shadow caster: each impostor instance is a quad facing the light
// through its bounding-sphere center, in flat world space (no curvature, bend,
// or mesh fade), textured with the baked frames closest to the light
// direction. Scenery casts into the depth cascades (src/sceneryShadows.js),
// clouds into the coverage map (src/cloudShadows.js).
// Same layout as scenery-instance-pars-vertex.glsl.
attribute vec4 aInstanceA;
attribute vec4 aInstanceB;
// x: frame radius, y: bounding-sphere center height, per impostor type.
uniform vec2 uImpostorTypes[IMPOSTOR_TYPE_COUNT];
// World direction toward the light the cascade cameras look along.
uniform vec3 uShadowCasterLight;
#ifdef SCENERY_FACE_AIRPLANE
// Airplane XZ the clouds face when the map renders (src/cloudShadows.js).
uniform vec2 uShadowCasterFacing;
#endif
varying vec4 vFrame0;
varying vec4 vFrame1;
varying vec4 vFrame2;
varying vec3 vFrameWeights;

#include ./impostor-octahedral.glsl
#include ./scenery-facing.glsl

vec3 rotateYaw(vec3 v, float c, float s) {
	return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

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

	// World to baked local space: undo yaw, scale, and stretch. Clouds turn to
	// face the airplane, as they are drawn.
#ifdef SCENERY_FACE_AIRPLANE
	float yawCos;
	float yawSin;
	getFacingYaw(base.xz, uShadowCasterFacing, yawCos, yawSin);
#else
	float yawCos = cos(impostorYaw);
	float yawSin = sin(impostorYaw);
#endif
	vec3 localScale = vec3(1.0, impostorStretch, 1.0) * max(impostorScale, 1e-4);
	vec3 lightLocal = normalize(rotateYaw(uShadowCasterLight, yawCos, -yawSin) / localScale);
#ifdef IMPOSTOR_LOWER_HEMISPHERE
	// A lower-hemisphere atlas has no view from the light above. An orthographic
	// silhouette is the same from both ends of the light ray, so look from below
	// along it instead.
	lightLocal = -lightLocal;
#endif
	vec3 vertexLocal = rotateYaw(vertex - center, yawCos, -yawSin) / localScale;
	// A viewer far along the light makes getFrameUv() an orthographic projection.
	vec3 viewerLocal = vertexLocal + lightLocal * (frameRadius * 4.0);

	float lastFrame = float(IMPOSTOR_FRAMES - 1);
	vec2 frameGrid = clamp((encodeHemiOct(lightLocal) * 0.5 + 0.5) * lastFrame, 0.0, lastFrame);
	vec2 baseFrame = min(floor(frameGrid), vec2(lastFrame - 1.0));
	vec2 frameFraction = frameGrid - baseFrame;
	vec2 middleFrame;
	if (frameFraction.x > frameFraction.y) {
		middleFrame = baseFrame + vec2(1.0, 0.0);
		vFrameWeights = vec3(1.0 - frameFraction.x, frameFraction.x - frameFraction.y, frameFraction.y);
	} else {
		middleFrame = baseFrame + vec2(0.0, 1.0);
		vFrameWeights = vec3(1.0 - frameFraction.y, frameFraction.y - frameFraction.x, frameFraction.x);
	}
	vec2 farFrame = baseFrame + 1.0;

	float typeIndex = float(impostorType);
	vec2 typeCell = vec2(
		mod(typeIndex, float(IMPOSTOR_ATLAS_COLUMNS)),
		floor(typeIndex / float(IMPOSTOR_ATLAS_COLUMNS))
	) * float(IMPOSTOR_FRAMES);
	vFrame0 = vec4(typeCell + baseFrame, getFrameUv(viewerLocal, vertexLocal, baseFrame, frameRadius));
	vFrame1 = vec4(typeCell + middleFrame, getFrameUv(viewerLocal, vertexLocal, middleFrame, frameRadius));
	vFrame2 = vec4(typeCell + farFrame, getFrameUv(viewerLocal, vertexLocal, farFrame, frameRadius));

	gl_Position = projectionMatrix * viewMatrix * vec4(vertex, 1.0);
}
