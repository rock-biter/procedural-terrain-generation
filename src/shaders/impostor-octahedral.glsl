// GLSL twin of the view layouts in src/impostors/octahedral.js. Directions
// point from the object toward the viewer in the impostor's local frame (+Y
// up). The atlas holds IMPOSTOR_FRAMES_X x IMPOSTOR_FRAMES_Y frames per type:
// - hemi-octahedral (default): one hemisphere; with IMPOSTOR_LOWER_HEMISPHERE
//   the lower one (cloud shadows), the mapping mirrored on y;
// - IMPOSTOR_FRONTAL_VIEWS: the band within ±IMPOSTOR_FRONTAL_AZIMUTH of local
//   -Z and from the horizon down to IMPOSTOR_FRONTAL_ELEVATION (clouds).
// Grid positions are in [0, 1]² and clamp to the layout.

#ifdef IMPOSTOR_LOWER_HEMISPHERE
const float IMPOSTOR_HEMISPHERE = -1.0;
#else
const float IMPOSTOR_HEMISPHERE = 1.0;
#endif

vec2 encodeHemiOct(vec3 direction) {
	direction.y = max(direction.y * IMPOSTOR_HEMISPHERE, 0.0);
	vec2 p = direction.xz / (abs(direction.x) + direction.y + abs(direction.z));
	return vec2(p.x + p.y, p.x - p.y);
}

vec3 decodeHemiOct(vec2 uv) {
	vec2 p = vec2(uv.x + uv.y, uv.x - uv.y) * 0.5;
	return normalize(vec3(p.x, (1.0 - abs(p.x) - abs(p.y)) * IMPOSTOR_HEMISPHERE, p.y));
}

#ifdef IMPOSTOR_FRONTAL_VIEWS
vec2 encodeImpostorView(vec3 direction) {
	float horizontal = length(direction.xz);
	float azimuth = horizontal > 1e-6 ? atan(direction.x, -direction.z) : 0.0;
	float elevation = atan(-direction.y, horizontal);
	return clamp(
		vec2(azimuth / IMPOSTOR_FRONTAL_AZIMUTH * 0.5 + 0.5, elevation / IMPOSTOR_FRONTAL_ELEVATION),
		0.0,
		1.0
	);
}

vec3 decodeImpostorView(vec2 grid) {
	float azimuth = (grid.x * 2.0 - 1.0) * IMPOSTOR_FRONTAL_AZIMUTH;
	float elevation = grid.y * IMPOSTOR_FRONTAL_ELEVATION;
	return vec3(cos(elevation) * sin(azimuth), -sin(elevation), -cos(elevation) * cos(azimuth));
}
#else
vec2 encodeImpostorView(vec3 direction) {
	return clamp(encodeHemiOct(direction) * 0.5 + 0.5, 0.0, 1.0);
}

vec3 decodeImpostorView(vec2 grid) {
	return decodeHemiOct(grid * 2.0 - 1.0);
}
#endif

const vec2 IMPOSTOR_LAST_FRAME = vec2(float(IMPOSTOR_FRAMES_X - 1), float(IMPOSTOR_FRAMES_Y - 1));

vec3 getFrameDirection(vec2 frame) {
	return decodeImpostorView(frame / IMPOSTOR_LAST_FRAME);
}

// UV of a quad vertex inside a baked frame: intersect the view ray with the
// frame's image plane, which passes through the impostor center.
vec2 getFrameUv(vec3 cameraLocal, vec3 vertexLocal, vec2 frame, float frameRadius) {
	vec3 forward = getFrameDirection(frame);
	vec3 right = vec3(forward.z, 0.0, -forward.x);
	float rightLength = length(right.xz);
	right = rightLength < 1e-6 ? vec3(1.0, 0.0, 0.0) : right / rightLength;
	vec3 up = cross(forward, right);

	vec3 ray = vertexLocal - cameraLocal;
	float t = -dot(cameraLocal, forward) / min(dot(ray, forward), -1e-4);
	vec3 hit = cameraLocal + ray * t;
	return vec2(dot(hit, right), dot(hit, up)) / frameRadius * 0.5 + 0.5;
}
