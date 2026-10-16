uniform float uTime;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunColor;
uniform vec3 uSunDirection;
uniform vec3 uMoonDirection;
uniform float uStarVisibility;
// The curved world's horizon dip below the horizontal, as its sin() and in
// radians.
uniform float uHorizonDip;
uniform float uHorizonDipAngle;
// Angular falloff of the gradient above the curved edge, in radians.
uniform float uGradientHeight;
varying vec3 vDirection;

// The horizon clouds (src/horizonClouds.js), in front of the sun, the moon,
// and the stars.
#ifdef HORIZON_CLOUDS
#include ./horizon-clouds-shading.glsl
#include ./interleaved-gradient-noise.glsl
#endif

float hash(vec3 p) {
	p = fract(p * 0.3183099 + 0.1);
	p *= 17.0;
	return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

void main() {
	vec3 direction = normalize(vDirection);
#ifdef HORIZON_CLOUDS
	// The angle a pixel spans, taken while control flow is still uniform.
	float pixelAngle = max(length(dFdx(direction)), length(dFdy(direction)));
#endif

	// The gradient is a function of the elevation above the curved world's
	// visible edge. Below the edge it stays at the horizon color, which fog
	// also fades terrain into. An exponential falloff concentrates the change
	// near the edge, where lines of equal elevation still follow its arc on
	// screen; a wide gradient would read as flat horizontal bands.
	float elevation = asin(clamp(direction.y, -1.0, 1.0)) + uHorizonDipAngle;
	float aboveEdge = max(elevation, 0.0);
	float height = 1.0 - exp(-aboveEdge / uGradientHeight);
	vec3 color = mix(uHorizon, uZenith, height);
#ifdef HORIZON_CLOUDS
	vec3 gradient = color;
#endif

	// Discs fade with their elevation above the dipped horizon; terrain covers
	// anything below it.
	// Disc radii: sun about 1.3 degrees, moon about 0.9 degrees.
	float sunVisibility = smoothstep(-0.15, 0.05, uSunDirection.y + uHorizonDip);
	float sunDot = dot(direction, uSunDirection);
	color += uSunColor * pow(max(sunDot, 0.0), 120.0) * 0.5 * sunVisibility;
	color = mix(
		color,
		uSunColor * 1.4 + 0.15,
		smoothstep(0.99970, 0.99982, sunDot) * sunVisibility
	);

	float moonVisibility = smoothstep(-0.1, 0.05, uMoonDirection.y + uHorizonDip);
	float moonDot = dot(direction, uMoonDirection);
	color += vec3(0.5, 0.6, 0.85) * pow(max(moonDot, 0.0), 500.0) * 0.12 * moonVisibility;
	color = mix(
		color,
		vec3(0.8, 0.84, 0.92),
		smoothstep(0.99985, 0.99990, moonDot) * moonVisibility
	);

	if (uStarVisibility > 0.001) {
		vec3 cellPosition = direction * 160.0;
		vec3 cell = floor(cellPosition);
		float seed = hash(cell);
		float star = step(0.985, seed);
		float shape = smoothstep(0.3, 0.0, length(fract(cellPosition) - 0.5));
		float twinkle = 0.65 + 0.35 * sin(uTime * 2.5 + seed * 200.0);
		float horizonFade = smoothstep(0.0, 0.1, aboveEdge);
		color += vec3(star * shape * twinkle * horizonFade * uStarVisibility);
	}

#ifdef HORIZON_CLOUDS
	vec4 cloud = shadeHorizonCloud(direction, elevation, pixelAngle, gradient);
	color = mix(color, cloud.rgb, cloud.a);
	// Half a step of dither against banding in the float scene buffer.
	color *= 1.0 + (interleavedGradientNoise(gl_FragCoord.xy) - 0.5) * 0.03 * cloud.a;
#endif

	gl_FragColor = vec4(color, 1.0);

	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}
