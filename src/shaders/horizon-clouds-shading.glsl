// The horizon clouds' color, for the sky (sky.frag.glsl). Toon bands between
// the day/night palette's cloud shade and lit colors, from a light faked in
// the clouds' own plane: at each azimuth the light's direction along the
// horizon and up gives a step toward it, and a pixel whose step leaves the
// clouds (or stays near their outline) faces the light, so the lit side
// follows every lobe. The light's part out of that plane makes the clouds
// front-lit (light behind the eye) or backlit (light behind them), where
// their thin edges glow (the silver lining). Watercolor touches: an uneven
// wash, pigment pooling just inside the edge, and lost edges
// (horizon-clouds-pars.glsl). The base dissolves into the sky behind, as the
// fog dissolves the far terrain.
#include ./horizon-clouds-pars.glsl

// xyz: world direction toward the light (sun or moon), w: the shading's
// contrast, 0 where the two hand over.
uniform vec4 uHorizonCloudLight;
// The light's color (linear), for the silver lining.
uniform vec3 uHorizonCloudLightColor;
// The palette's cloud colors (linear), lit and in shade.
uniform vec3 uHorizonCloudLit;
uniform vec3 uHorizonCloudShade;
// x and y: the toon band thresholds, z: their softness, w: the step toward
// the light (radians).
uniform vec4 uHorizonCloudTone;
// x: the depth inside the clouds, at the end of that step, where the shade is
// full (radians), y: the lift of front-lit clouds, z: the darkening of
// backlit ones, w: the extra light on the tops.
uniform vec4 uHorizonCloudFacing;
// x: the silver lining's strength, y: its focus around the light, z: the
// width inside the outline it and the pigment cover (radians), w: the
// pigment's darkening.
uniform vec4 uHorizonCloudRim;
// x: the hazed height above the base (radians), y: the haze at the base, z:
// over the whole cloud, w: the wash's strength.
uniform vec4 uHorizonCloudHaze;

// The clouds over the view direction `direction`, whose elevation above the
// visible edge is `elevation`, for pixels of `pixelAngle` radians: rgb their
// color (linear), a their coverage. `skyColor` is the sky gradient behind.
vec4 shadeHorizonCloud(vec3 direction, float elevation, float pixelAngle, vec3 skyColor) {
	if (!isInHorizonCloudBand(elevation)) return vec4(0.0);
	float azimuth = atan(direction.z, direction.x);
	vec2 p = vec2(azimuth - uHorizonCloudMotion.x, elevation);
	vec4 bank = getHorizonCloudBank(p.x, pixelAngle);
	float height = p.y + uHorizonCloudBillow.w;
	if (bank.y <= 0.0 || height > bank.x + uHorizonCloudMotion.w * bank.y) return vec4(0.0);

	vec4 spare;
	float density = getHorizonCloudDensity(p, bank, pixelAngle, uHorizonCloudMotion.y, spare);
	density += uHorizonCloudEdge.z * spare.z;
	float alpha = getHorizonCloudAlpha(density, smoothstep(-0.3, 0.6, spare.x), pixelAngle);
	if (alpha <= 0.0) return vec4(0.0);

	// The light in the clouds' plane at this azimuth: x along the horizon
	// (toward a larger azimuth), y up; `behind` > 0 when it shines from behind
	// them.
	vec3 light = uHorizonCloudLight.xyz;
	vec2 outward = vec2(cos(azimuth), sin(azimuth));
	vec2 inPlane = vec2(dot(light.xz, vec2(-outward.y, outward.x)), light.y);
	float inPlaneLength = length(inPlane);
	float behind = dot(light.xz, outward);
	vec2 q = p + (inPlaneLength > 1e-4 ? inPlane / inPlaneLength : vec2(0.0, 1.0)) * uHorizonCloudTone.w;
	vec4 stepSpare;
	float depth = getHorizonCloudDensity(
		q,
		getHorizonCloudBank(q.x, pixelAngle),
		pixelAngle,
		uHorizonCloudMotion.z,
		stepSpare
	);
	float lit = 1.0 - smoothstep(0.0, uHorizonCloudFacing.x, depth);

	float topShare = clamp(height / max(bank.x, 1e-4), 0.0, 1.0);
	float tone = mix(0.5, lit, inPlaneLength)
		+ uHorizonCloudFacing.y * max(-behind, 0.0)
		- uHorizonCloudFacing.z * max(behind, 0.0)
		+ uHorizonCloudFacing.w * (topShare - 0.5);
	// Without contrast the clouds keep a soft, mostly lit middle tone.
	tone = mix(0.6, tone, uHorizonCloudLight.w);
	float bands = 0.5 * smoothstep(uHorizonCloudTone.x - uHorizonCloudTone.z, uHorizonCloudTone.x + uHorizonCloudTone.z, tone)
		+ 0.5 * smoothstep(uHorizonCloudTone.y - uHorizonCloudTone.z, uHorizonCloudTone.y + uHorizonCloudTone.z, tone);
	vec3 color = mix(uHorizonCloudShade, uHorizonCloudLit, bands);

	// Watercolor: an uneven wash, and pigment pooling just inside the edge.
	color *= 1.0 + uHorizonCloudHaze.w * spare.y;
	float edge = 1.0 - smoothstep(0.0, uHorizonCloudRim.z, density);
	color *= 1.0 - uHorizonCloudRim.w * edge;

	// The silver lining: a light behind the clouds glows through their edges.
	float glow = pow(max(dot(direction, light), 0.0), uHorizonCloudRim.y);
	color += uHorizonCloudLightColor * (uHorizonCloudRim.x * glow * edge * uHorizonCloudLight.w);

	// Aerial perspective: the base dissolves into the sky behind.
	float haze = max(uHorizonCloudHaze.z, uHorizonCloudHaze.y * (1.0 - smoothstep(0.0, uHorizonCloudHaze.x, height)));
	return vec4(mix(color, skyColor, haze), alpha);
}
