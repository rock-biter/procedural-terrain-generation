// Sea foam footprint (src/seaFoam.js): the closeness to the rock's edge, 1 on
// and inside the footprint circle, falling linearly to 0 at uSeaFoamReach
// world units outside it. The map blends with MAX, so every texel keeps the
// closest rock.
uniform float uSeaFoamReach;

varying vec2 vFoamOffset;
varying float vFoamRadius;

void main() {
	float edgeDistance = length(vFoamOffset) - vFoamRadius;
	gl_FragColor = vec4(1.0 - clamp(edgeDistance / uSeaFoamReach, 0.0, 1.0), 0.0, 0.0, 1.0);
}
