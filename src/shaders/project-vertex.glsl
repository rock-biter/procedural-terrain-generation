vec4 mvPosition = vec4( transformed, 1.0 );

#ifdef USE_BATCHING

	mvPosition = batchingMatrix * mvPosition;

#endif

#ifdef USE_INSTANCING

	mvPosition = instanceMatrix * mvPosition;

#endif


wPosition = (modelMatrix * vec4( transformed, 1.0 )).xyz;
// Visible flat position for the scenery shadow lookup; wPosition.y becomes
// the raw height below.
vShadowPosition = wPosition;
float wave = sin(uTime * 3. - height * 1.);

float pctWave = smoothstep(-1.,-4.,height) - smoothstep(-10.,-40., height);


float dist = length(wPosition.xyz - uCamera);
distanceFromCamera = dist;

// Curved-world lighting: the curvature below bends the surface by
// theta = dist / uCurvature, tilting away from uCamera. Rotate the flat normal
// by the same angle and pass the sphere normal for the light terminator.
// Chunks are only translated, so object-space normals are world-space.
vec3 sphereNormal = vec3(0.0, 1.0, 0.0);
vec3 bentNormal = objectNormal;
vec2 horizontalOffset = wPosition.xz - uCamera.xz;
float horizontalLength = length(horizontalOffset);
if (horizontalLength > 0.0001) {
	vec3 awayDirection = vec3(horizontalOffset.x, 0.0, horizontalOffset.y) / horizontalLength;
	vec3 bendAxis = cross(vec3(0.0, 1.0, 0.0), awayDirection);
	float bendAngle = dist / uCurvature;
	float bendCos = cos(bendAngle);
	float bendSin = sin(bendAngle);
	sphereNormal = vec3(0.0, bendCos, 0.0) + awayDirection * bendSin;
	bentNormal = rotateAroundAxis(objectNormal, bendAxis, bendCos, bendSin);
}
vNormal = normalize(normalMatrix * bentNormal);
vSphereNormal = normalize(normalMatrix * sphereNormal);
// mvPosition.y += wave * (1. - smoothstep(0.,1500., dist )) * 2.;
mvPosition.y += wave * pctWave * 0.5;

mvPosition.y -= getCurvatureDrop(dist);

mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
wPosition.y = height;