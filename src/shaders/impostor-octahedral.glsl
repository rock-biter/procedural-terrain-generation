// GLSL twin of src/impostors/octahedral.js. Directions point from the object
// toward the viewer in the impostor's local frame (+Y up).

vec2 encodeHemiOct(vec3 direction) {
	direction.y = max(direction.y, 0.0);
	vec2 p = direction.xz / (abs(direction.x) + direction.y + abs(direction.z));
	return vec2(p.x + p.y, p.x - p.y);
}

vec3 decodeHemiOct(vec2 uv) {
	vec2 p = vec2(uv.x + uv.y, uv.x - uv.y) * 0.5;
	return normalize(vec3(p.x, 1.0 - abs(p.x) - abs(p.y), p.y));
}

vec3 getFrameDirection(vec2 frame) {
	return decodeHemiOct(frame / float(IMPOSTOR_FRAMES - 1) * 2.0 - 1.0);
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
