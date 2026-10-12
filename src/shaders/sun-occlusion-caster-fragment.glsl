// Height above the drawn sea (SUN_OCCLUSION_HEIGHT_BASE), so the cleared map
// is sea; overlapping chunks keep the highest (max blending).
varying float vHeight;

void main() {
	gl_FragColor = vec4(max(vHeight - SUN_OCCLUSION_HEIGHT_BASE, 0.0), 0.0, 0.0, 1.0);
}
