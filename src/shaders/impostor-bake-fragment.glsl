layout(location = 0) out vec4 gAlbedo;
layout(location = 1) out vec4 gNormal;
varying vec3 vColor;
varying vec3 vNormal;
varying float vDepth;

// Albedo is stored sRGB-encoded in 8 bits; the impostor shader decodes it.
vec3 linearToSRGB(vec3 color) {
	return mix(
		color * 12.92,
		1.055 * pow(color, vec3(1.0 / 2.4)) - 0.055,
		step(vec3(0.0031308), color)
	);
}

void main() {
	gAlbedo = vec4(linearToSRGB(vColor), 1.0);
	gNormal = vec4(normalize(vNormal) * 0.5 + 0.5, clamp(vDepth * 0.5 + 0.5, 0.0, 1.0));
}
