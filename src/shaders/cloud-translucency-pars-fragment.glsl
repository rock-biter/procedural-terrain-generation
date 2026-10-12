// Light the carved-wood clouds carry through toward the eye (src/clouds.js):
// strongest with the light behind the cloud, and on the thin silhouettes seen
// edge-on, so a cloud passing in front of the sun lights up along its rims
// (the silver lining) and glows faintly across its body. Only receivers
// compiled with CLOUD_TRANSLUCENCY declare it; the curved-world lighting adds
// it for every directional light (src/curvedLights.js).
#ifdef CLOUD_TRANSLUCENCY

// x: strength (1 = a face lit head-on), y: focus (power of the lobe around
// the light's direction), z: body (the glow away from the rims, as a share of
// theirs), w: rim power (higher keeps the glow to the thinnest edges).
uniform vec4 uCloudTranslucency;
// Linear tint of the carried light.
uniform vec3 uCloudTranslucencyColor;
// Share of the moon's light carried, against the sun's full strength.
uniform float uCloudTranslucencyMoon;

// `lightColor` and `lightDirection` (toward the light) are the directional
// light's, `normal` and `viewDir` (toward the eye) view space, `albedo` the
// diffuse color.
vec3 getCloudTranslucency(vec3 lightColor, vec3 lightDirection, vec3 normal, vec3 viewDir, vec3 albedo) {
	if (uCloudTranslucency.x <= 0.0) return vec3(0.0);
	float forward = pow(saturate(dot(-viewDir, lightDirection)), uCloudTranslucency.y);
	float rim = pow(1.0 - saturate(abs(dot(normal, viewDir))), uCloudTranslucency.w);
	float thickness = mix(uCloudTranslucency.z, 1.0, rim);
	// Sun and moon are always opposite, so the sign picks the sun.
	vec3 sunView = normalize((viewMatrix * vec4(uSunDirection, 0.0)).xyz);
	float share = mix(uCloudTranslucencyMoon, 1.0, step(0.0, dot(lightDirection, sunView)));
	return lightColor * BRDF_Lambert(albedo) * uCloudTranslucencyColor
		* (uCloudTranslucency.x * share * forward * thickness);
}

#endif
