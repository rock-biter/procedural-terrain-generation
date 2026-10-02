layout(location = 0) out vec4 gAlbedo;
layout(location = 1) out vec4 gNormal;
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vPosition;
varying float vDepth;

#ifdef USE_DETAIL
// Replaced in impostorBaker.js by scenery-detail-pars-fragment.glsl.
#include <scenery_detail_pars_fragment>
#endif

// Albedo is stored sRGB-encoded in 8 bits; the impostor shader decodes it.
vec3 linearToSRGB(vec3 color) {
	return mix(
		color * 12.92,
		1.055 * pow(color, vec3(1.0 / 2.4)) - 0.055,
		step(vec3(0.0031308), color)
	);
}

void main() {
	vec3 color = vColor;
	vec3 normal = normalize(vNormal);

#ifdef USE_DETAIL
	color = applyDetail(color, vPosition, normal);
#endif

	gAlbedo = vec4(linearToSRGB(color), 1.0);
	gNormal = vec4(normal * 0.5 + 0.5, clamp(vDepth * 0.5 + 0.5, 0.0, 1.0));
}
