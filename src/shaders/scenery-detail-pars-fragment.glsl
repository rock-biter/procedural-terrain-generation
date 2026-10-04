// Tileable wood color map (src/textures/white_oak/white_oak_veneer_diff_1k.ktx2),
// mapped triplanarly in object space so the grain follows each source mesh.
// Shared by the impostor bake and the near meshes so both match. The texture
// is sRGB, so samples arrive linear.
uniform sampler2D uDetail;

// `scale` is in texture repeats per object-space unit.
vec3 sampleDetail(vec3 position, vec3 normal, float scale) {
	vec3 weights = pow(abs(normal), vec3(4.0));
	weights /= weights.x + weights.y + weights.z;
	// The texture grain runs along V. Side projections map U to height, so the
	// grain runs horizontally: around trunks and across the clouds' flat faces.
	vec3 side = texture(uDetail, position.yz * scale).rgb;
	vec3 top = texture(uDetail, position.xz * scale).rgb;
	vec3 front = texture(uDetail, position.yx * scale).rgb;
	return side * weights.x + top * weights.y + front * weights.z;
}

// Vertex color times the wood detail. `settings` is one type's (x: repeats
// per unit, y: strength, 0 keeps the vertex color and 1 multiplies it by the
// texture, z: normalized when above 0.5). Normalized detail is divided by the
// texture's mean color (its smallest mip), so it adds grain without darkening
// or tinting the vertex color (clouds, and the trees' neutral bake).
vec3 applyDetail(vec3 color, vec3 position, vec3 normal, vec3 settings) {
	vec3 detail = sampleDetail(position, normal, settings.x);
	if (settings.z > 0.5) {
		detail /= max(textureLod(uDetail, vec2(0.5), 16.0).rgb, vec3(1e-3));
	}
	return color * mix(vec3(1.0), detail, settings.y);
}
