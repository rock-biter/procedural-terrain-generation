// Sea foam footprints (src/seaFoam.js): each scenery instance of a foam type
// becomes a flat square around its base, drawn straight into the top-down map
// without a camera. Other types have a zero radius and collapse outside the
// clip volume. The proxy mesh sits at the chunk position (modelMatrix), like
// the scenery mesh it borrows the geometry from.
attribute vec4 aInstanceA; // chunk-local base xyz, scale
attribute vec4 aInstanceB; // yaw, type, packed tint, stretch

// Footprint radius per type at scale 1; 0 for types without ripples.
uniform float uSeaFoamRadius[IMPOSTOR_TYPE_COUNT];
// xy: covered square center XZ, z: its half-size.
uniform vec3 uSeaFoamWindow;
// World units beyond a rock's edge the map keeps a distance for.
uniform float uSeaFoamReach;

varying vec2 vFoamOffset;
varying float vFoamRadius;

void main() {
	int type = int(aInstanceB.y + 0.5);
	float radius = uSeaFoamRadius[type] * aInstanceA.w;
	if (radius <= 0.0) {
		gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
		return;
	}
	vec2 base = (modelMatrix * vec4(aInstanceA.xyz, 1.0)).xz;
	vFoamOffset = position.xy * (radius + uSeaFoamReach);
	vFoamRadius = radius;
	// Map x follows world x and map y world z, so the receivers read the map at
	// (xz - center) / (2 * halfSize) + 0.5.
	gl_Position = vec4((base + vFoamOffset - uSeaFoamWindow.xy) / uSeaFoamWindow.z, 0.0, 1.0);
}
