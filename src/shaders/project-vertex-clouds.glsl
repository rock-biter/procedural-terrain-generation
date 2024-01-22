
vec4 mvPosition = vec4( transformed, 1.0 );
wPosition = (modelMatrix * vec4( transformed, 1.0 )).xyz;
// vec3 centerWPos = (modelMatrix * vec4( vec3(0.,0.,0.), 1.0 )).xyz;
float wave = snoise(wPosition.xz + uTime * 0.2);

#ifdef USE_BATCHING

	mvPosition = batchingMatrix * mvPosition;

#endif

#ifdef USE_INSTANCING

	mvPosition = instanceMatrix * mvPosition;
  wPosition = (modelMatrix * instanceMatrix * vec4( transformed, 1.0 )).xyz;
  // centerWPos = (modelMatrix * instanceMatrix * vec4( vec3(0.,0.,0.), 1.0 )).xyz;
  // matrix = modelMatrix * instanceMatrix;

#endif
// wPosition = (modelMatrix * vec4( transformed, 1.0 )).xyz;
// float wave = snoise(wPosition.xz + uTime * 0.2);

// mvPosition.xyz += wave * 0.2;
// mvPosition = matrix * mvPosition;
// mvPosition.xyz += 1. + wave * 0.35;

// float pctWave = smoothstep(-1.,-4.,height) - smoothstep(-10.,-40., height);


float dist = length(wPosition.xyz - uCamera);
distanceFromCamera = dist;
float scale = smoothstep(1300.,500.,distanceFromCamera);
float offset = smoothstep(20.,0.,distanceFromCamera);
mvPosition.y *= scale;
// mvPosition.xyz += normalize(vec3(wPosition.xyz) - uCamera) * offset * 20.;
// mvPosition.y += wave * (1. - smoothstep(0.,1500., dist )) * 2.;
// mvPosition.y += wave * pctWave * 0.5;

mvPosition.y += -uCurvature * (1. - cos(dist / uCurvature));

mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
// wPosition.y = height;