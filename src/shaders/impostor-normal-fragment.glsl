// Replaces <normal_fragment_begin> with the baked object-space normal.
float faceDirection = 1.0;
vec3 impostorLocalNormal = normalize(impostorNormalSum + vec3(0.0, 1e-5, 0.0));
vec3 normal = normalize(
	vImpostorNormalX * impostorLocalNormal.x +
	vImpostorNormalY * impostorLocalNormal.y +
	vImpostorNormalZ * impostorLocalNormal.z
);
vec3 nonPerturbedNormal = normal;
