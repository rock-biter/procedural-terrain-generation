// Low-sun terrain occlusion (src/sunOcclusion.js, rules in
// src/sunOcclusionPolicy.js): while the sun is low, a top-down map of the
// terrain heights around the airplane lets every terrain pixel march toward
// the sun and find whether the relief hides it, where the flat shadow maps
// have faded out. Only receivers compiled with SUN_OCCLUSION_STEPS
// (getSunOcclusionDefines()) declare and run it.
#ifdef SUN_OCCLUSION_STEPS

#include ./curvature-drop.glsl
#include ./interleaved-gradient-noise.glsl

// Heights above the drawn sea (SUN_OCCLUSION_HEIGHT_BASE), so cleared texels
// are sea.
uniform sampler2D uSunOcclusionMap;
// xy: window center XZ, z: half its side (world units).
uniform vec3 uSunOcclusionWindow;
// Shares of the sun's glare (x) and diffuse light (y) the relief can hide,
// with the elevation fade; both 0 disable the march.
uniform vec2 uSunOcclusionStrength;
// x: first sample distance, y: reach (world units), z: penumbra half-width
// (clearance slope), w: glare cone (cosine of its half-angle around the sun).
uniform vec4 uSunOcclusionShape;

// Flat surface height at world XZ. An explicit level: the march runs in
// non-uniform control flow.
float sampleSunOcclusionHeight(vec2 xz) {
	vec2 uv = (xz - uSunOcclusionWindow.xy) / (2.0 * uSunOcclusionWindow.z) + 0.5;
	return textureLod(uSunOcclusionMap, uv, 0.0).r + SUN_OCCLUSION_HEIGHT_BASE;
}

// Visibility of the sun in [0, 1] from the flat surface point `position`,
// `eyeDistance` from the airplane. The march runs over the world as drawn:
// flat XZ, with every height lowered by the curvature drop around uCamera
// (project-vertex.glsl), so a sun below the flat horizon still reaches the
// distant sea that the curvature turns toward it. Samples spread
// quadratically toward the reach, offset per pixel, and stop at the window's
// edge (getSunOcclusionVisibility() in src/sunOcclusionPolicy.js is the CPU
// twin).
float getSunOcclusionVisibility(vec3 position, float eyeDistance) {
	float horizontal = length(uSunDirection.xz);
	if (horizontal < 1e-4) return 1.0;
	vec2 direction = uSunDirection.xz / horizontal;
	// Tangent of the sun's flat elevation, negative below the flat horizon.
	float rise = uSunDirection.y / horizontal;
	// From the higher of the drawn and the mapped surface, so the coarser map
	// never hides the sun from the pixel's own slope.
	float originY = max(position.y, sampleSunOcclusionHeight(position.xz)) - getCurvatureDrop(eyeDistance);
	float jitter = interleavedGradientNoise(gl_FragCoord.xy);
	float clearance = 1.0;
	for (int i = 0; i < SUN_OCCLUSION_STEPS; i++) {
		float t = (float(i) + jitter) / float(SUN_OCCLUSION_STEPS);
		float distance = mix(uSunOcclusionShape.x, uSunOcclusionShape.y, t * t);
		vec2 xz = position.xz + direction * distance;
		vec2 offset = abs(xz - uSunOcclusionWindow.xy);
		if (max(offset.x, offset.y) > uSunOcclusionWindow.z) break;
		float height = sampleSunOcclusionHeight(xz);
		float drawn = height - getCurvatureDrop(length(vec3(xz.x, height, xz.y) - uCamera));
		// Slope of the ray's clearance over the relief: negative once it hides the sun.
		clearance = min(clearance, (originY + distance * rise - drawn) / distance);
		// Past the penumbra the sun is gone whatever lies farther.
		if (clearance < -uSunOcclusionShape.z) break;
	}
	return smoothstep(-uSunOcclusionShape.z, uSunOcclusionShape.z, clearance);
}

// The sun's visibility for its glare (x) and its diffuse light (y), each 1
// where the relief cannot matter. `normal` and `viewDir` (toward the eye),
// `sunView` and `sphereNormal` are view space.
vec2 getSunOcclusion(vec3 position, float eyeDistance, vec3 normal, vec3 viewDir, vec3 sunView, vec3 sphereNormal) {
	if (uSunOcclusionStrength.x <= 0.0 && uSunOcclusionStrength.y <= 0.0) return vec2(1.0);
	vec2 offset = abs(position.xz - uSunOcclusionWindow.xy);
	if (max(offset.x, offset.y) > uSunOcclusionWindow.z) return vec2(1.0);
	// No direct sun to hide: below the local horizon or on a face turned away.
	if (dot(sphereNormal, sunView) < -0.02 || dot(normal, sunView) <= 0.0) return vec2(1.0);
	// Without diffuse occlusion only the glare matters, which needs a view
	// toward the sun.
	if (uSunOcclusionStrength.y <= 0.0 && dot(-viewDir, sunView) < uSunOcclusionShape.w) return vec2(1.0);
	return 1.0 - uSunOcclusionStrength * (1.0 - getSunOcclusionVisibility(position, eyeDistance));
}

#endif
