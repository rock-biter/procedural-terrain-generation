// Static film grain drawn over the finished canvas by PostProcessing.
// The hash depends only on the pixel coordinate, so the pattern stays fixed on
// screen and never animates.
uniform float uIntensity;

// Dave Hoskins' hash12 (MIT).
float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

void main() {
	float noise = hash12(floor(gl_FragCoord.xy)) - 0.5;
	// Blended as 2 * src * dst: 0.5 keeps the pixel, so the canvas color is
	// scaled by a factor in [1 - uIntensity, 1 + uIntensity].
	gl_FragColor = vec4(vec3(0.5 + noise * uIntensity), 1.0);
}
