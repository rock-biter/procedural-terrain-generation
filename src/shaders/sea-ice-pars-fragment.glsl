// Sheet and floes of the frozen sea (color-fragment.glsl), drawn on the sea
// of the ice biome. The sheet covers the sea where the raw height plus the
// shelf is above 0; beyond it a band of Voronoi cells breaks into plates that
// drift apart seaward. The ice meets the water without any dark line.
#include ./sea-ice-pars.glsl

// Linear colors: the sheet, the floes, and the icy water between them.
uniform vec3 uSeaIceColors[3];

// pcg3d hash of an integer cell: three uniform values in [0, 1). The cells
// are shifted positive, so the uint conversion never sees a negative value.
vec3 getSeaIceCellHash(ivec2 cell) {
	uvec3 v = uvec3(uvec2(cell + ivec2(16777216)), 0x2545F491u);
	v = v * 1664525u + 1013904223u;
	v.x += v.y * v.z;
	v.y += v.z * v.x;
	v.z += v.x * v.y;
	v ^= v >> 16u;
	v.x += v.y * v.z;
	v.y += v.z * v.x;
	v.z += v.x * v.y;
	return vec3(v >> 8u) * (1.0 / 16777216.0);
}

// Jittered point of a cell, inside its middle 80% so neighbours never crowd.
vec2 getSeaIceCellPoint(ivec2 cell) {
	return 0.1 + 0.8 * getSeaIceCellHash(cell).xy;
}

// Voronoi of one jittered point per unit cell at `p`: writes the cell of the
// nearest point and returns the distance to that cell's nearest edge (Inigo
// Quilez's two passes over the 3 × 3 neighbourhoods).
float getSeaIceVoronoi(vec2 p, out ivec2 nearestCell) {
	ivec2 cell = ivec2(floor(p));
	vec2 local = p - floor(p);
	vec2 nearest = vec2(8.0);
	float best = 64.0;
	nearestCell = cell;
	for (int j = -1; j <= 1; j++) {
		for (int i = -1; i <= 1; i++) {
			ivec2 offset = ivec2(i, j);
			vec2 toPoint = vec2(offset) + getSeaIceCellPoint(cell + offset) - local;
			float squared = dot(toPoint, toPoint);
			if (squared < best) {
				best = squared;
				nearest = toPoint;
				nearestCell = cell + offset;
			}
		}
	}
	float edge = 8.0;
	ivec2 home = nearestCell - cell;
	for (int j = -1; j <= 1; j++) {
		for (int i = -1; i <= 1; i++) {
			ivec2 offset = home + ivec2(i, j);
			vec2 toPoint = vec2(offset) + getSeaIceCellPoint(cell + offset) - local;
			vec2 between = toPoint - nearest;
			if (dot(between, between) > 1e-5) {
				edge = min(edge, dot(0.5 * (nearest + toPoint), normalize(between)));
			}
		}
	}
	return edge;
}

// Share of a pixel `pixel` world units wide, at a distance from a
// cell edge (`edgeDistance`), inside a crack `halfWidth` wide on each side of it: a box
// filter, so cracks thinner than a pixel fade instead of flickering.
float getSeaIceCrack(float edgeDistance, float halfWidth, float pixel) {
	float overlap = min(edgeDistance + pixel * 0.5, halfWidth) - max(edgeDistance - pixel * 0.5, -halfWidth);
	return clamp(overlap / pixel, 0.0, 1.0);
}

// Covers the sea color `color` with the sheet and its floes at raw height
// `height`, world position `xz`, and ice field value `iceValue` (> 0).
// `groundPixel` is the pixel's size on the ground and `heightPixel` the
// height change across it, both from derivatives taken in uniform control
// flow. Returns the ice coverage in [0, 1].
float applySeaIce(inout vec3 color, float height, vec2 xz, float iceValue, float groundPixel, float heightPixel) {
	float amount = getSeaIceAmount(iceValue);
	if (amount <= 0.0) return 0.0;
	float band = max(uSeaIceShape.z * amount, 1e-3);
	float wobble = uSeaIceEdge.z * amount;
	float edge = height + uSeaIceShape.x * amount;
	// Open sea beyond the farthest floe.
	if (edge < -band - wobble) return 0.0;
	edge += snoise(xz * uSeaIceEdge.w + 37.1) * wobble;

	// Relative depth into the floe band: below 0 on the sheet, 1 at the band's
	// outer limit.
	float t = -edge / band;
	float tPixel = max(heightPixel / band, 1e-3);
	float coverage = 1.0;
	if (t > 1.0 + tPixel) {
		coverage = 0.0;
	} else if (t > -0.5) {
		// Mean coverage of the plates at t: a plate covers its cell where t is
		// below the cell's random value. Far away, where a cell spans less than a
		// few pixels, the plates blend into it instead of sparkling.
		float mean = 1.0 - clamp(t, 0.0, 1.0);
		float cellSize = max(uSeaIceShape.w, 0.1);
		float detail = 1.0 - smoothstep(0.25, 0.5, groundPixel / cellSize);
		float floes = mean;
		if (detail > 0.0) {
			ivec2 cell;
			float edgeDistance = getSeaIceVoronoi(xz / cellSize, cell) * cellSize;
			float threshold = getSeaIceCellHash(cell).z;
			float plate = 1.0 - smoothstep(threshold - tPixel, threshold + tPixel, t);
			// Cracks open from the sheet (fading in over half a band inside it)
			// and widen seaward.
			float crackWidth = mix(uSeaIceEdge.x, uSeaIceEdge.y, clamp(t, 0.0, 1.0)) * smoothstep(-0.5, 0.0, t);
			float open = 1.0 - getSeaIceCrack(edgeDistance, crackWidth * 0.5, max(groundPixel, 1e-3));
			floes = mix(mean, plate * open, detail);
		}
		coverage = floes;
	}

	// The sheet's color turns into the floes' across its edge, and the water
	// between them takes an icy tint that fades seaward and toward the ice
	// border.
	vec3 ice = mix(uSeaIceColors[0], uSeaIceColors[1], smoothstep(-0.25, 0.25, t));
	vec3 water = mix(color, uSeaIceColors[2], (1.0 - smoothstep(0.0, 1.0, t)) * amount);
	color = mix(water, ice, coverage);
	return coverage;
}
