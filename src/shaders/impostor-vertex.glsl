// Replaces <project_vertex>: builds a camera-facing quad on the curved world
// and selects the three baked frames closest to the view direction.
float impostorScale = aInstanceA.w;
float impostorYaw = aInstanceB.x;
int impostorType = int(aInstanceB.y + 0.5);
float impostorStretch = aInstanceB.w;
vec2 impostorInfo = uImpostorTypes[impostorType];
float frameRadius = impostorInfo.x;

vec3 impostorBase = (modelMatrix * vec4(aInstanceA.xyz, 1.0)).xyz;
// Boats bob with the sea waves like their near meshes
// (scenery-mesh-normal-vertex.glsl), without the tilt the baked frames cannot
// show.
vec3 impostorFloatOffset;
vec3 impostorTiltAxis;
float impostorTiltCos;
float impostorTiltSin;
getSceneryFloat(impostorType, impostorBase, aInstanceB.z, impostorFloatOffset, impostorTiltAxis, impostorTiltCos, impostorTiltSin);
impostorBase += impostorFloatOffset;
float baseDistance;
vec3 curvedBase;
vec3 sphereNormal;
vec3 bendAxis;
float bendCos;
float bendSin;
getCurvatureBend(impostorBase, baseDistance, curvedBase, sphereNormal, bendAxis, bendCos, bendSin);
distanceFromCamera = baseDistance;
// Shrink into the fog before the instance leaves its streaming range (the
// scenery LOD limit, or the cloud field radius).
impostorScale *= 1.0 - smoothstep(uImpostorFarFade.x, uImpostorFarFade.y, baseDistance);
// Near the eye the real mesh takes over (src/impostors/sceneryMeshes.js): the
// fragment dither keeps only the pixels the mesh discards, and a fully faded
// impostor collapses so it costs no fragments.
float meshFade = getSceneryMeshFade(length(impostorBase - cameraPosition));
vSceneryDither = vec2(meshFade, impostorYaw);
if (meshFade >= 1.0) impostorScale = 0.0;
vec3 impostorCenter = curvedBase + sphereNormal * impostorInfo.y * impostorScale * impostorStretch;

// The quad faces the eye: it lies perpendicular to the ray through the
// impostor center, not parallel to the image plane. A quad parallel to the
// image plane cuts instances away from the screen center, where the bounding
// sphere projects up to 1 / cos(angle off axis) larger onto it. The half-size
// is the radius of the sphere's tangent cone in that plane, so the whole
// silhouette fits at any distance and screen position.
vec3 cameraRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
vec3 cameraUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
vec3 toEye = cameraPosition - impostorCenter;
float eyeDistance = length(toEye);
toEye /= max(eyeDistance, 1e-4);
vec3 quadRight = cross(cameraUp, toEye);
float quadRightLength = length(quadRight);
// Only an instance 90 degrees off axis, never on screen, is degenerate.
quadRight = quadRightLength > 1e-4 ? quadRight / quadRightLength : cameraRight;
vec3 quadUp = cross(toEye, quadRight);
float sphereRadius = frameRadius * impostorScale * max(impostorStretch, 1.0);
float coneSquared = max(eyeDistance * eyeDistance - sphereRadius * sphereRadius, max(sphereRadius * sphereRadius * 0.0625, 1e-8));
float halfSize = sphereRadius * min(eyeDistance * inversesqrt(coneSquared), 4.0);
vec3 impostorVertex = impostorCenter + (quadRight * position.x + quadUp * position.y) * halfSize;

// World to baked local space: undo bend, yaw, scale, and stretch. Clouds
// (SCENERY_FACE_AIRPLANE) turn to face the airplane from their flat base, like
// their near meshes; their yaw slot only seeds the dither.
#ifdef SCENERY_FACE_AIRPLANE
float yawCos;
float yawSin;
getFacingYaw(impostorBase.xz, uCamera.xz, yawCos, yawSin);
#else
float yawCos = cos(impostorYaw);
float yawSin = sin(impostorYaw);
#endif
vec3 localScale = vec3(1.0, impostorStretch, 1.0) * max(impostorScale, 1e-4);
vec3 cameraLocal = rotateYaw(rotateAroundAxis(cameraPosition - impostorCenter, bendAxis, bendCos, -bendSin), yawCos, -yawSin) / localScale;
vec3 vertexLocal = rotateYaw(rotateAroundAxis(impostorVertex - impostorCenter, bendAxis, bendCos, -bendSin), yawCos, -yawSin) / localScale;

vec4 frame0;
vec4 frame1;
vec4 frame2;
vec3 frameWeights;
selectImpostorFrames(normalize(cameraLocal), cameraLocal, vertexLocal, impostorType, frameRadius, frame0, frame1, frame2, frameWeights);
vFrame0 = frame0;
vFrame1 = frame1;
vFrame2 = frame2;
vFrameWeights = frameWeights;

// Normals transform with the inverse transpose of the stretch.
mat3 viewRotation = mat3(viewMatrix);
vImpostorNormalX = viewRotation * rotateAroundAxis(rotateYaw(vec3(1.0, 0.0, 0.0), yawCos, yawSin), bendAxis, bendCos, bendSin);
vImpostorNormalY = viewRotation * rotateAroundAxis(vec3(0.0, 1.0 / impostorStretch, 0.0), bendAxis, bendCos, bendSin);
vImpostorNormalZ = viewRotation * rotateAroundAxis(rotateYaw(vec3(0.0, 0.0, 1.0), yawCos, yawSin), bendAxis, bendCos, bendSin);
vSphereNormal = normalize(viewRotation * sphereNormal);

vec3 impostorTint = getSceneryTint(aInstanceB.z, impostorBase.xz, impostorType);
#ifdef SCENERY_PALETTE
// Trunk tint in vTint, painted tint in vPaintTint; the fragment mixes them by
// the baked paint mask.
vec3 impostorTrunkTint;
vec3 impostorPaintTint;
getSceneryPaletteTints(impostorTint, aInstanceB.z, impostorBase.xz, impostorYaw, impostorType, impostorTrunkTint, impostorPaintTint);
vTint = impostorTrunkTint;
vPaintTint = impostorPaintTint;
#else
vTint = impostorTint;
#endif

// Shadows use flat world space: undo the bend around the curved center. The
// map is affine, so the quad position interpolates exactly.
vec3 flatCenter = impostorBase + vec3(0.0, impostorInfo.y * impostorScale * impostorStretch, 0.0);
vShadowPosition = flatCenter + rotateAroundAxis(impostorVertex - impostorCenter, bendAxis, bendCos, -bendSin);
vShadowView = rotateAroundAxis(normalize(cameraPosition - impostorCenter), bendAxis, bendCos, -bendSin);
vShadowDepthScale = frameRadius * impostorScale;
vShadowSelfBias = sphereRadius;

wPosition = impostorVertex;
vec4 mvPosition = viewMatrix * vec4(impostorVertex, 1.0);
gl_Position = projectionMatrix * mvPosition;
