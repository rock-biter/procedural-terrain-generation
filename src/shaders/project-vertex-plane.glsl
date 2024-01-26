vec4 mvPosition = vec4( transformed, 1.0 );

#ifdef USE_BATCHING

	mvPosition = batchingMatrix * mvPosition;

#endif

#ifdef USE_INSTANCING

	mvPosition = instanceMatrix * mvPosition;

#endif


// wPosition = (modelMatrix * vec4( transformed, 1.0 )).xyz;
// float wave = sin(uTime * 3. - height * 1.);

// float pctWave = smoothstep(-1.,-4.,height) - smoothstep(-10.,-40., height);


// float dist = length(wPosition.xyz - uCamera);
// distanceFromCamera = dist;
// // mvPosition.y += wave * (1. - smoothstep(0.,1500., dist )) * 2.;
// mvPosition.y += wave * pctWave * 0.5;

// mvPosition.y += -uCurvature * (1. - cos(dist / uCurvature));
float c = smoothstep(-40.,0.,mvPosition.z);
float curvature = 15.;
mvPosition = rotateZ(-uRotation.z * c) * mvPosition;
mvPosition.x -= curvature * (1. - sin(  uRotation.z / curvature )) * (1. - c) * uRotation.z;
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
// wPosition.y = height;