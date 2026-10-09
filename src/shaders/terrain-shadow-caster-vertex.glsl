// Terrain shadow caster: a chunk's coarse shadow grid in flat world space (no
// curvature or waves), drawn with BackSide so only faces turned away from the
// light write depth (src/sceneryShadows.js, rules in src/shadowPolicy.js).
// World direction toward the light the cascade cameras look along.
uniform vec3 uShadowCasterLight;
// World units the caster moves away from the light: a depth bias for the
// terrain alone, which covers its coarse grid against the drawn one.
uniform float uTerrainCasterOffset;

void main() {
	vec4 world = modelMatrix * vec4(position, 1.0);
	world.xyz -= uShadowCasterLight * uTerrainCasterOffset;
	gl_Position = projectionMatrix * viewMatrix * world;
	// Pancaking: terrain upstream of the camera's near plane flattens onto it
	// and still shadows the cascade. Every receiver lies at least casterMargin
	// beyond the near plane, deeper than a clamped grid cell can reach.
	gl_Position.z = max(gl_Position.z, -gl_Position.w);
}
