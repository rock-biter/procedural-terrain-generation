layout(location = 0) out vec4 gAlbedo;
layout(location = 1) out vec4 gNormal;
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vPosition;
varying float vDepth;

#ifdef USE_DETAIL
// Tileable grayscale detail (src/textures/wood-grain.png), mapped
// triplanarly in object space so the grain follows each source mesh.
uniform sampler2D uDetail;
// Texture repeats per world unit.
uniform float uDetailScale;
// Brightness change: the color is scaled by [1 - strength, 1 + strength].
uniform float uDetailColor;
// Bump height in world units for a full black-to-white step.
uniform float uDetailBump;

float sampleDetail(vec3 position, vec3 normal) {
	vec3 weights = pow(abs(normal), vec3(4.0));
	weights /= weights.x + weights.y + weights.z;
	// Side projections keep the grain vertical.
	float side = texture(uDetail, position.zy * uDetailScale).r;
	float top = texture(uDetail, position.xz * uDetailScale).r;
	float front = texture(uDetail, position.xy * uDetailScale).r;
	return side * weights.x + top * weights.y + front * weights.z;
}

// Derivative bump mapping (as Three.js perturbNormalArb), in object space.
vec3 perturbNormal(vec3 position, vec3 normal, float height) {
	vec3 sigmaX = dFdx(position);
	vec3 sigmaY = dFdy(position);
	vec3 r1 = cross(sigmaY, normal);
	vec3 r2 = cross(normal, sigmaX);
	float determinant = dot(sigmaX, r1);
	vec3 gradient = sign(determinant) * (dFdx(height) * r1 + dFdy(height) * r2);
	return normalize(abs(determinant) * normal - gradient);
}
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
	float detail = sampleDetail(vPosition, normal);
	color *= 1.0 + (detail - 0.5) * 2.0 * uDetailColor;
	normal = perturbNormal(vPosition, normal, detail * uDetailBump);
#endif

	gAlbedo = vec4(linearToSRGB(color), 1.0);
	gNormal = vec4(normal * 0.5 + 0.5, clamp(vDepth * 0.5 + 0.5, 0.0, 1.0));
}
