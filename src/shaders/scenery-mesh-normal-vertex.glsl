// Replaces <beginnormal_vertex>: unpacks the instance and bends its normal with
// the same rigid transform as impostor-vertex.glsl. The mesh sits at the world
// origin, so the world-space objectNormal goes through normalMatrix (the view
// rotation) in <defaultnormal_vertex>.
float sceneryScale = aInstanceA.w;
float sceneryYaw = aInstanceB.x;
int sceneryType = int(aInstanceB.y + 0.5);
float sceneryStretch = aInstanceB.w;
// Instance bases are already in world space (sceneryMeshes.js).
vec3 sceneryBase = aInstanceA.xyz;

float baseDistance;
vec3 curvedBase;
vec3 sphereNormal;
vec3 bendAxis;
float bendCos;
float bendSin;
getSceneryBend(sceneryBase, baseDistance, curvedBase, sphereNormal, bendAxis, bendCos, bendSin);
float yawCos = cos(sceneryYaw);
float yawSin = sin(sceneryYaw);

// Same fade as the impostor; the fragment keeps the complementary pixels.
float meshFade = getSceneryMeshFade(length(sceneryBase - cameraPosition));
vSceneryDither = vec2(meshFade, sceneryYaw);
vSceneryLocalPosition = position;
vSceneryLocalNormal = normal;
vSphereNormal = normalize(mat3(viewMatrix) * sphereNormal);
vTint = getSceneryTint(aInstanceB.z, sceneryBase.xz, sceneryType);

// Normals transform with the inverse transpose of the stretch.
vec3 objectNormal = rotateAroundAxis(
	rotateYaw(normalize(vec3(normal.x, normal.y / sceneryStretch, normal.z)), yawCos, yawSin),
	bendAxis,
	bendCos,
	bendSin
);
