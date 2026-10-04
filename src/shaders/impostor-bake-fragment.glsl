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


void main() {
	vec3 color = vColor;
	vec3 normal = normalize(vNormal);

#ifdef USE_DETAIL
	color = applyDetail(color, vPosition, normal);
#endif

	// Stored sRGB-encoded in 8 bits (three's transfer function); the impostor
	// shader decodes it.
	gAlbedo = vec4(sRGBTransferOETF(vec4(color, 1.0)).rgb, 1.0);
	gNormal = vec4(normal * 0.5 + 0.5, clamp(vDepth * 0.5 + 0.5, 0.0, 1.0));
}
