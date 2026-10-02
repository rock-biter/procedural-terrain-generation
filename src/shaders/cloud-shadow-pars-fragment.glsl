// Cloud shadow lookup shared by the terrain, near scenery meshes, and scenery
// impostors (src/cloudShadows.js, rules in src/shadowPolicy.js). Clouds float
// above every receiver, so the map stores only how much of the light ray is
// covered by a cloud, already blurred: one bilinear tap gives a soft shadow.
// Positions are flat world space (before the curvature), like the map.
uniform sampler2D uCloudShadowMap;
// Flat world position to map UV (xy).
uniform mat4 uCloudShadowMatrix;
// xy: covered disk center XZ, z: disk radius.
uniform vec3 uCloudShadowWindow;
// Share of the direct light a fully covered pixel loses, including the
// light-elevation fade; 0 disables every lookup.
uniform float uCloudShadowStrength;

// Visibility of the shadowing light in [0, 1]; fades to lit at the disk edge.
float getCloudShadow(vec3 position) {
	if (uCloudShadowStrength <= 0.0) return 1.0;
	float edge = 1.0 - smoothstep(
		uCloudShadowWindow.z * 0.8,
		uCloudShadowWindow.z * 0.97,
		length(position.xz - uCloudShadowWindow.xy)
	);
	if (edge <= 0.0) return 1.0;
	float coverage = texture2D(uCloudShadowMap, (uCloudShadowMatrix * vec4(position, 1.0)).xy).r;
	return 1.0 - coverage * edge * uCloudShadowStrength;
}
