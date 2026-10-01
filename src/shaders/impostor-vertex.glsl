// Replaces <project_vertex>: builds a camera-facing quad on the curved world
// and selects the three baked frames closest to the view direction.
float impostorScale = aInstanceA.w;
float impostorYaw = aInstanceB.x;
int impostorType = int(aInstanceB.y + 0.5);
float impostorStretch = aInstanceB.w;
vec2 impostorInfo = uImpostorTypes[impostorType];
float frameRadius = impostorInfo.x;

vec3 impostorBase = (modelMatrix * vec4(aInstanceA.xyz, 1.0)).xyz;
float baseDistance;
vec3 curvedBase;
vec3 sphereNormal;
vec3 bendAxis;
float bendCos;
float bendSin;
getSceneryBend(impostorBase, baseDistance, curvedBase, sphereNormal, bendAxis, bendCos, bendSin);
distanceFromCamera = baseDistance;
// Shrink into the fog before the scenery LOD limit removes the chunk.
impostorScale *= smoothstep(950.0, 800.0, baseDistance);
// Near the eye the real mesh takes over (src/impostors/sceneryMeshes.js): the
// fragment dither keeps only the pixels the mesh discards, and a fully faded
// impostor collapses so it costs no fragments.
float meshFade = getSceneryMeshFade(length(impostorBase - cameraPosition));
vSceneryDither = vec2(meshFade, impostorYaw);
if (meshFade >= 1.0) impostorScale = 0.0;
vec3 impostorCenter = curvedBase + sphereNormal * impostorInfo.y * impostorScale * impostorStretch;

vec3 cameraRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
vec3 cameraUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
float halfSize = frameRadius * impostorScale * max(impostorStretch, 1.0);
vec3 impostorVertex = impostorCenter + (cameraRight * position.x + cameraUp * position.y) * halfSize;

// World to baked local space: undo bend, yaw, scale, and stretch.
float yawCos = cos(impostorYaw);
float yawSin = sin(impostorYaw);
vec3 localScale = vec3(1.0, impostorStretch, 1.0) * max(impostorScale, 1e-4);
vec3 cameraLocal = rotateYaw(rotateAroundAxis(cameraPosition - impostorCenter, bendAxis, bendCos, -bendSin), yawCos, -yawSin) / localScale;
vec3 vertexLocal = rotateYaw(rotateAroundAxis(impostorVertex - impostorCenter, bendAxis, bendCos, -bendSin), yawCos, -yawSin) / localScale;

float lastFrame = float(IMPOSTOR_FRAMES - 1);
vec2 frameGrid = clamp((encodeHemiOct(normalize(cameraLocal)) * 0.5 + 0.5) * lastFrame, 0.0, lastFrame);
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
vFrame0 = vec4(typeCell + baseFrame, getFrameUv(cameraLocal, vertexLocal, baseFrame, frameRadius));
vFrame1 = vec4(typeCell + middleFrame, getFrameUv(cameraLocal, vertexLocal, middleFrame, frameRadius));
vFrame2 = vec4(typeCell + farFrame, getFrameUv(cameraLocal, vertexLocal, farFrame, frameRadius));

// Normals transform with the inverse transpose of the stretch.
mat3 viewRotation = mat3(viewMatrix);
vImpostorNormalX = viewRotation * rotateAroundAxis(rotateYaw(vec3(1.0, 0.0, 0.0), yawCos, yawSin), bendAxis, bendCos, bendSin);
vImpostorNormalY = viewRotation * rotateAroundAxis(vec3(0.0, 1.0 / impostorStretch, 0.0), bendAxis, bendCos, bendSin);
vImpostorNormalZ = viewRotation * rotateAroundAxis(rotateYaw(vec3(0.0, 0.0, 1.0), yawCos, yawSin), bendAxis, bendCos, bendSin);
vSphereNormal = normalize(viewRotation * sphereNormal);

vTint = getSceneryTint(aInstanceB.z, impostorBase.xz, impostorType);

wPosition = impostorVertex;
vec4 mvPosition = viewMatrix * vec4(impostorVertex, 1.0);
gl_Position = projectionMatrix * mvPosition;
