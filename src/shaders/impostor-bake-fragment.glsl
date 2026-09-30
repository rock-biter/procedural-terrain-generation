layout(location = 0) out vec4 gAlbedo;
layout(location = 1) out vec4 gNormal;
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vPosition;
varying float vDepth;

#ifdef USE_DETAIL
// Tileable wood color map (src/textures/olive_veneer/olive_veneer_diff_1k.jpg),
// mapped triplanarly in object space so the grain follows each source mesh.
// The texture is sRGB, so samples arrive linear.
uniform sampler2D uDetail;
// Texture repeats per world unit.
uniform float uDetailScale;
// 0 keeps the vertex color, 1 multiplies it by the texture color.
uniform float uDetailColor;

vec3 sampleDetail(vec3 position, vec3 normal) {
	vec3 weights = pow(abs(normal), vec3(4.0));
	weights /= weights.x + weights.y + weights.z;
	// The texture grain runs along U; side projections map U to height to keep
	// it vertical.
	vec3 side = texture(uDetail, position.yz * uDetailScale).rgb;
	vec3 top = texture(uDetail, position.xz * uDetailScale).rgb;
	vec3 front = texture(uDetail, position.yx * uDetailScale).rgb;
	return side * weights.x + top * weights.y + front * weights.z;
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
	color *= mix(vec3(1.0), sampleDetail(vPosition, normal), uDetailColor);
#endif

	gAlbedo = vec4(linearToSRGB(color), 1.0);
	gNormal = vec4(normal * 0.5 + 0.5, clamp(vDepth * 0.5 + 0.5, 0.0, 1.0));
}
