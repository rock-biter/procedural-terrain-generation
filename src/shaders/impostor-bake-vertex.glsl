// Impostor bake pass: renders a source mesh into one atlas frame.
uniform vec3 uForward;
uniform vec3 uCenter;
uniform float uFrameRadius;
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vPosition;
varying float vDepth;
// Share of the instance's palette color (1 on tree crowns); 0 without
// SCENERY_PALETTE.
varying float vPaint;

#ifdef SCENERY_PALETTE
attribute float paint;
#endif

void main() {
	vColor = color;
	vNormal = normal;
	vPosition = position;
	vDepth = dot(position - uCenter, uForward) / uFrameRadius;
#ifdef SCENERY_PALETTE
	vPaint = paint;
#else
	vPaint = 0.0;
#endif
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
