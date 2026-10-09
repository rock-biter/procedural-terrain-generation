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

// The ice field, broad enough to interpolate across triangles: the fragment
// reads it instead of evaluating the noise per pixel. The frozen sea stays
// still (sea-ice-pars.glsl).
vIceValue = getIceValue(wPosition.xz + uBiomeOffset.xy);
// The deep ocean field, as broad: the fragment reads it for the islets'
// biome and the deep ocean's sea settings.
vOceanValue = getOceanValue(wPosition.xz + uBiomeOffset.xy, vIceValue);
// The sea state and the ripples' phase noise, as broad
// (sea-surface-pars.glsl); land needs no ripples.
vSeaState = getSeaState(wPosition.xz);
float seaOceanMask = getSeaOceanMask(vOceanValue);
vSeaRippleNoise = height < 0.0 ? getSeaRippleNoise(wPosition.xz, seaOceanMask) : 0.0;

// Near the airplane the sea's vertices follow its waves, calm toward the
// coast and still under the frozen sea; farther, inside the LOD 0 block, they
// rest and the waves live in the fragment's normals alone.
vec3 seaOffset = vec3(0.0);
if (height < 0.0) {
	float seaFade = getSeaVertexFade(wPosition.xz);
	if (seaFade > 0.0) {
		float seaStill = getSeaIceStill(height, vIceValue);
		SeaWaves seaWaves = getSeaWaves(wPosition.xz, -height, seaOceanMask, vSeaState, seaStill, 0.0);
		seaOffset = seaWaves.offset * seaFade;
	}
}


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
mvPosition.xyz += seaOffset;

mvPosition.y -= getCurvatureDrop(dist);

mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
wPosition.y = height;