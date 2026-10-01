// Propeller of plane-toy.glb (src/plane.js). The propeller is fused into the
// single airplane mesh; the `propeller` attribute (src/propellerMask.js) marks
// its vertices, which turn about the propeller axis, parallel to +Z, in the
// model's geometry units. Measurements: docs/ASSETS.md.
attribute float propeller;
uniform float uPropellerAngle;
// Axis position in XY.
uniform vec2 uPropellerAxis;

// Rotates an XY offset by the propeller angle (cosine, sine).
vec2 rotatePropeller(vec2 v, vec2 rotation) {
	return vec2(rotation.x * v.x - rotation.y * v.y, rotation.y * v.x + rotation.x * v.y);
}
