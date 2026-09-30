// Impostor bake pass: renders a source mesh into one atlas frame.
uniform vec3 uForward;
uniform vec3 uCenter;
uniform float uFrameRadius;
varying vec3 vColor;
varying vec3 vNormal;
varying float vDepth;

void main() {
	vColor = color;
	vNormal = normal;
	vDepth = dot(position - uCenter, uForward) / uFrameRadius;
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
