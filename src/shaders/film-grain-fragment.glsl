// Static film grain, the last effect of PostProcessing's effect pass. It runs
// in display (sRGB) space, so it scales the displayed value like a multiply
// overlay on the canvas would. The hash depends only on the pixel coordinate,
// so the pattern stays fixed on screen and never animates.
uniform float intensity;

// Dave Hoskins' hash12 (MIT).
float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
	float noise = hash12(floor(gl_FragCoord.xy)) - 0.5;
	// Scales the color by a factor in [1 - intensity, 1 + intensity].
	outputColor = vec4(inputColor.rgb * (1.0 + 2.0 * noise * intensity), inputColor.a);
}
