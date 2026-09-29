uniform float uTime;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunColor;
uniform vec3 uSunDirection;
uniform vec3 uMoonDirection;
uniform float uStarVisibility;
// sin() of the curved world's horizon dip below the horizontal.
uniform float uHorizonDip;
varying vec3 vDirection;

float hash(vec3 p) {
	p = fract(p * 0.3183099 + 0.1);
	p *= 17.0;
	return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

void main() {
	vec3 direction = normalize(vDirection);

	// The gradient starts at the curved world's visible edge, not at y = 0.
	// Below it stays at the horizon color, which fog also fades terrain into.
	float horizonY = -uHorizonDip;
	float height = clamp((direction.y - horizonY) / (1.0 - horizonY), 0.0, 1.0);
	// Smooth start avoids a visible crease exactly at the horizon line.
	vec3 color = mix(uHorizon, uZenith, smoothstep(0.0, 0.5, height));

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
		float horizonFade = smoothstep(0.0, 0.2, height);
		color += vec3(star * shape * twinkle * horizonFade * uStarVisibility);
	}

	gl_FragColor = vec4(color, 1.0);

	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}
