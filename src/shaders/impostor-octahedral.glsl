// GLSL twin of the view layout in src/impostors/octahedral.js. Directions
// point from the object toward the viewer in the impostor's local frame (+Y
// up). The atlas holds IMPOSTOR_FRAMES_X x IMPOSTOR_FRAMES_Y hemi-octahedral
// frames per type, covering the upper hemisphere. Grid positions are in
// [0, 1]² and clamp to the hemisphere.

vec2 encodeHemiOct(vec3 direction) {
	direction.y = max(direction.y, 0.0);
	vec2 p = direction.xz / (abs(direction.x) + direction.y + abs(direction.z));
	return vec2(p.x + p.y, p.x - p.y);
}

vec3 decodeHemiOct(vec2 uv) {
	vec2 p = vec2(uv.x + uv.y, uv.x - uv.y) * 0.5;
	return normalize(vec3(p.x, 1.0 - abs(p.x) - abs(p.y), p.y));
}

vec2 encodeImpostorView(vec3 direction) {
	return clamp(encodeHemiOct(direction) * 0.5 + 0.5, 0.0, 1.0);
}

vec3 decodeImpostorView(vec2 grid) {
	return decodeHemiOct(grid * 2.0 - 1.0);
}

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

// The three baked frames around the local view direction `view` and their
// blend weights: each frame's atlas cell (xy, inside the type's block) and the
// vertex UV in it (zw), seen from `viewerLocal`. Impostors look from the eye,
// shadow casters from far along the light.
void selectImpostorFrames(
	vec3 view,
	vec3 viewerLocal,
	vec3 vertexLocal,
	int type,
	float frameRadius,
	out vec4 frame0,
	out vec4 frame1,
	out vec4 frame2,
	out vec3 weights
) {
	vec2 frameGrid = encodeImpostorView(view) * IMPOSTOR_LAST_FRAME;
	vec2 baseFrame = min(floor(frameGrid), IMPOSTOR_LAST_FRAME - 1.0);
	vec2 frameFraction = frameGrid - baseFrame;
	vec2 middleFrame;
	if (frameFraction.x > frameFraction.y) {
		middleFrame = baseFrame + vec2(1.0, 0.0);
		weights = vec3(1.0 - frameFraction.x, frameFraction.x - frameFraction.y, frameFraction.y);
	} else {
		middleFrame = baseFrame + vec2(0.0, 1.0);
		weights = vec3(1.0 - frameFraction.y, frameFraction.y - frameFraction.x, frameFraction.x);
	}
	vec2 farFrame = baseFrame + 1.0;

	float typeIndex = float(type);
	vec2 typeCell = vec2(
		mod(typeIndex, float(IMPOSTOR_ATLAS_COLUMNS)),
		floor(typeIndex / float(IMPOSTOR_ATLAS_COLUMNS))
	) * vec2(float(IMPOSTOR_FRAMES_X), float(IMPOSTOR_FRAMES_Y));
	frame0 = vec4(typeCell + baseFrame, getFrameUv(viewerLocal, vertexLocal, baseFrame, frameRadius));
	frame1 = vec4(typeCell + middleFrame, getFrameUv(viewerLocal, vertexLocal, middleFrame, frameRadius));
	frame2 = vec4(typeCell + farFrame, getFrameUv(viewerLocal, vertexLocal, farFrame, frameRadius));
}
