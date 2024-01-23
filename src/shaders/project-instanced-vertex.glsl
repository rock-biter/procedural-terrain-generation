
vec4 mvPosition = vec4( transformed, 1.0 );
wPosition = (modelMatrix * vec4( transformed, 1.0 )).xyz;

#ifdef USE_BATCHING

	mvPosition = batchingMatrix * mvPosition;

#endif

#ifdef USE_INSTANCING

	mvPosition = instanceMatrix * mvPosition;
  wPosition = (modelMatrix * instanceMatrix * vec4( transformed, 1.0 )).xyz;

#endif



float wave = snoise(wPosition.xz + uTime);
mvPosition.x += wave * 0.35;

// float pctWave = smoothstep(-1.,-4.,height) - smoothstep(-10.,-40., height);


float dist = length(wPosition.xyz - uCamera);
distanceFromCamera = dist;
float scale = smoothstep(1300.,500.,distanceFromCamera);
mvPosition.y *= scale;
// mvPosition.y += wave * (1. - smoothstep(0.,1500., dist )) * 2.;
// mvPosition.y += wave * pctWave * 0.5;

mvPosition.y += -uCurvature * (1. - cos(dist / uCurvature));

mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
// wPosition.y = height;