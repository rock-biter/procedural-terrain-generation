// Terrain heights for the low-sun occlusion map (src/sunOcclusion.js): each
// chunk's coarse grid, drawn straight down into the map without a camera. The
// proxy mesh sits at the chunk position (modelMatrix), like the chunk it
// borrows the positions from; their y is the flat surface, never below the
// drawn sea.
// xy: window center XZ, z: half its side.
uniform vec3 uSunOcclusionWindow;

varying float vHeight;

void main() {
	vec4 world = modelMatrix * vec4(position, 1.0);
	vHeight = world.y;
	// Map x follows world x and map y world z, so the receivers read the map at
	// (xz - center) / (2 * halfSize) + 0.5.
	gl_Position = vec4((world.xz - uSunOcclusionWindow.xy) / uSunOcclusionWindow.z, 0.0, 1.0);
}
