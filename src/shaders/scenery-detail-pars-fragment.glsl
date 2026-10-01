// Tileable wood color map (src/textures/white_oak/white_oak_veneer_diff_1k.jpg),
// mapped triplanarly in object space so the grain follows each source mesh.
// Shared by the impostor bake and the near meshes so both match. The texture
// is sRGB, so samples arrive linear.
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

// Vertex color times the wood detail at the given strength.
vec3 applyDetail(vec3 color, vec3 position, vec3 normal) {
	return color * mix(vec3(1.0), sampleDetail(position, normal), uDetailColor);
}
