// Curved-world terminator, appended after getDirectionalLightInfo(): a light
// below this fragment's local horizon on the curvature sphere contributes
// nothing, even on slopes that face it.
directLight.color *= smoothstep(-0.02, 0.06, dot(directLight.direction, normalize(vSphereNormal)));
