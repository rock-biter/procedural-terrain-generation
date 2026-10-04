// Replaces <color_fragment> in the wing trail material (src/wingTrails.js):
// draws an ink stripe with noisy edges and a dark outline inside the ribbon
// and discards the rest.
#include <color_fragment>
float side = step(0.5, vUV.x);
float widthFactor = side > 0.5 ? vTrailWidths.y : vTrailWidths.x;
float taper = max(0.0, sin(3.14159265 * vUV.y));
float noiseFade = taper * taper;
float halfWidth = 0.5 * uTrailLineWidth / uTrailRibbonWidth * taper * widthFactor;
// Before any discard, so the derivative stays in uniform control flow.
float widthInPixels = 2.0 * halfWidth / max(fwidth(vUV.x), 0.000001);
float edge = side > 0.5 ? 1.0 - vUV.x : vUV.x;
float outlineWidth = uTrailBorderWidth / uTrailRibbonWidth * taper * widthFactor;
float stripeCenter = max(0.07,
	(uTrailLineWidth * 0.5 + uTrailOuterAmplitude + uTrailBorderWidth)
	/ uTrailRibbonWidth + 0.005);
float oscillationRamp = smoothstep(0.0, 0.35, 1.0 - vUV.y);
float oscillationScale = uTrailOscillationAmplitude / uTrailRibbonWidth
	* oscillationRamp * vTrailBank;
float outerReach = uTrailOuterAmplitude / uTrailRibbonWidth * noiseFade * widthFactor;
float innerReach = uTrailInnerAmplitude / uTrailRibbonWidth * noiseFade * widthFactor;
// Most of the ribbon never shows a stripe. The noise sums below stay
// within ±1 (1.05 leaves a margin), so fragments outside the widest
// possible stripe are discarded before any noise is evaluated.
float noiseBound = 1.05;
if (halfWidth <= 0.0001
	|| edge < stripeCenter - noiseBound * (abs(oscillationScale) + outerReach)
		- halfWidth - outlineWidth
	|| edge > stripeCenter + noiseBound * (abs(oscillationScale) + innerReach)
		+ halfWidth + outlineWidth) discard;
// Trail space: arc length along the flown path, so the edge noise keeps
// the same frequency in turns and stays attached to emitted sections.
// The 0.5 scale keeps the existing GUI frequencies close to their old look.
vec2 noisePosition = vec2(
	vTrailDistance * 0.5 + side * 19.0,
	side * 31.0
);
float outerNoise = snoise(noisePosition * uTrailOuterFrequency) * 0.7
	+ snoise(noisePosition * uTrailOuterFrequency * 2.4 + 17.0) * 0.3;
float innerNoise = snoise(noisePosition * uTrailInnerFrequency * 1.27 + 13.0) * 0.7
	+ snoise(noisePosition * uTrailInnerFrequency * 3.1 + 41.0) * 0.3;
float sideOffset = side * 17.0;
float oscillation = 0.8 * sin(
	vTrailDistance * 6.2831853 * uTrailOscillationFrequency + side * 2.1
) + 0.2 * snoise(vec2(
	vTrailDistance * uTrailOscillationFrequency * 2.0 + sideOffset,
	sideOffset + 7.0
));
stripeCenter += oscillation * oscillationScale;
float outerEdge = stripeCenter - halfWidth + outerNoise * outerReach;
float innerEdge = stripeCenter + halfWidth + innerNoise * innerReach;
if (edge < outerEdge - outlineWidth || edge > innerEdge + outlineWidth) discard;
float core = step(outerEdge, edge) * step(edge, innerEdge);
diffuseColor.rgb *= mix(vec3(0.03), uTrailTint, core);
diffuseColor.a *= mix(0.65, 1.0, smoothstep(0.75, 2.5, widthInPixels));
