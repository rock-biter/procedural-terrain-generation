// The sun's lens flare (src/lensFlareEffect.js), added to the linear scene
// color before tone mapping: a glow around the sun, a starburst fixed to the
// lens, soft tinted ghosts along the line from the sun through the screen
// center, and a rainbow halo around the center. Every element scales with
// the share of the sun's disc left visible (the occlusion texel). Distances
// are in screen heights.
#include ./lens-flare-taps.glsl

// The occlusion texel: the visible share of the sun's disc, smoothed.
uniform sampler2D visibilityBuffer;
// The scene's depth, for the debug view of the taps.
uniform sampler2D occlusionDepth;
// xy: the sun's UV, zw: the disc's UV radius.
uniform vec4 sunScreen;
// The sun's linear color times the intensity and the gate; 0 skips the flare.
uniform vec3 flareColor;
// x: peak, y: falloff radius, z: falloff power.
uniform vec3 glowParams;
// x: peak, y: length, z: ray count, w: sharpness.
uniform vec4 starParams;
uniform float starRotation;
// x: peak, y: base radius, z: spacing.
uniform vec3 ghostParams;
// x: peak, y: radius, z: width.
uniform vec3 haloParams;
// 1 paints the depth taps.
uniform float debugTaps;

// Ghosts along the line from the sun (0) through the screen center (1).
const float LENS_FLARE_GHOST_OFFSETS[5] = float[5](0.45, 0.8, 1.25, 1.6, 2.1);
const float LENS_FLARE_GHOST_SIZES[5] = float[5](0.6, 1.4, 0.8, 2.2, 1.0);
const vec3 LENS_FLARE_GHOST_TINTS[5] = vec3[5](
	vec3(1.0, 0.75, 0.45),
	vec3(0.45, 0.85, 1.0),
	vec3(0.75, 0.55, 1.0),
	vec3(0.5, 1.0, 0.7),
	vec3(1.0, 0.6, 0.5)
);

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
	outputColor = inputColor;
	if (max(flareColor.r, max(flareColor.g, flareColor.b)) <= 0.0) return;

	vec2 scale = vec2(aspect, 1.0);
	vec2 fromSun = (uv - sunScreen.xy) * scale;
	float sunDistance = length(fromSun);

	vec3 light = vec3(glowParams.x * pow(1.0 + sunDistance / glowParams.y, -glowParams.z));

	// Rays peak where the phase is a whole number; odd ones are shorter.
	// The offset keeps atan() defined on the sun's own pixel.
	float phase = (atan(fromSun.y, fromSun.x + 1e-6) * starParams.z * 0.5 + starRotation) / PI;
	float rayLength = mod(floor(phase + 0.5), 2.0) < 0.5 ? 1.0 : 0.55;
	float rays = pow(abs(cos(phase * PI)), starParams.w);
	light += starParams.x * rays * exp(-sunDistance / (starParams.y * rayLength));

	// The ghosts and the halo's bright side collapse as the sun nears the center.
	vec2 axis = vec2(0.5) - sunScreen.xy;
	float axisLength = length(axis * scale);
	float axisFade = smoothstep(0.02, 0.15, axisLength);
	if (ghostParams.x > 0.0) {
		for (int i = 0; i < 5; i++) {
			vec2 center = sunScreen.xy + axis * LENS_FLARE_GHOST_OFFSETS[i] * ghostParams.z;
			float radius = ghostParams.y * LENS_FLARE_GHOST_SIZES[i];
			float ghostDistance = length((uv - center) * scale);
			float disc = 1.0 - smoothstep(radius * 0.55, radius, ghostDistance);
			float rim = smoothstep(radius * 0.6, radius * 0.9, ghostDistance) * disc;
			light += LENS_FLARE_GHOST_TINTS[i] * ghostParams.x * axisFade * (0.6 * disc + 0.6 * rim);
		}
	}

	if (haloParams.x > 0.0) {
		vec2 fromCenter = (uv - 0.5) * scale;
		float centerDistance = length(fromCenter);
		vec3 ring = 1.0 - smoothstep(
			vec3(0.0),
			vec3(haloParams.z),
			abs(centerDistance - haloParams.y * vec3(1.02, 1.0, 0.98))
		);
		vec2 toSun = -axis * scale;
		float facing = saturate(dot(fromCenter / max(centerDistance, 1e-4), toSun / max(axisLength, 1e-4)));
		light += haloParams.x * ring * mix(1.0, facing * facing, axisFade);
	}

	float visibility = texture2D(visibilityBuffer, vec2(0.5)).r;
	outputColor.rgb += flareColor * visibility * light;

	if (debugTaps > 0.5) {
		for (int i = 0; i < LENS_FLARE_TAPS; i++) {
			vec2 tap = getLensFlareTap(i, sunScreen);
			if (length((uv - tap) * resolution) < 2.5) {
				bool sky = texture2D(occlusionDepth, tap).r >= LENS_FLARE_SKY_DEPTH;
				outputColor.rgb = sky ? vec3(0.0, 4.0, 0.0) : vec3(4.0, 0.0, 0.0);
			}
		}
	}
}
