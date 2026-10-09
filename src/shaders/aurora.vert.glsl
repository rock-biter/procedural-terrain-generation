// The aurora's curtains (src/aurora.js): ribbons parallel to the event's axis,
// a window of them around the airplane (getAuroraWindow() in
// src/auroraPolicy.js). `position` is x: column along the ribbon, y: height
// share (0 base, 1 top), z: ribbon slot. Every hash and noise takes the
// ribbon's index and the distance along the axis, both anchored in the world,
// so shifting the window never moves a curtain.
#include ./common.glsl
#include ./curvature-bend.glsl

// xy: the event's origin (world XZ), zw: its unit axis. The side vector is
// (-axis.z, axis.x).
uniform vec4 uAuroraFrame;
// x: distance along the axis of column 0, y: index of the ribbon in slot 0,
// z: column step, w: ribbon spacing.
uniform vec4 uAuroraWindow;
// The event's region (findIceRegion()): its mask, and xy the world XZ of the
// mask's corner, zw one over its size.
uniform sampler2D uAuroraMask;
uniform vec4 uAuroraMaskBounds;
// Random per event, in [0, 1).
uniform float uAuroraSeed;
// Seconds since the event started.
uniform float uAuroraTime;
// x: base altitude, y: height, z: height variation, w: jitter (share of the
// spacing).
uniform vec4 uAuroraShape;
// x: distance fade start, y: its end (the window radius), z: horizon fade
// (radians), w: edge-on fade (|cos| of the view angle).
uniform vec4 uAuroraFade;
// Sideways displacements, each x: amplitude, y: one over the wavelength, z:
// speed.
uniform vec3 uAuroraMeander;
uniform vec3 uAuroraFold;
uniform vec3 uAuroraSway;
// x: one over the wavelength, y: threshold, z: softness, w: speed.
uniform vec4 uAuroraPresence;

// x: distance along the axis, y: height share, z: ribbon hash, w: visibility.
varying vec4 vAurora;
// |cos| of the angle between the curtain's normal and the view ray.
varying float vAuroraFacing;

// Uniform [0, 1) hash of a ribbon index and the event's seed.
float getAuroraHash(float ribbon) {
	uint h = uint(int(ribbon) + 32768) ^ (floatBitsToUint(uAuroraSeed) * 0x9E3779B9u);
	h ^= h >> 16;
	h *= 0x7FEB352Du;
	h ^= h >> 15;
	h *= 0x846CA68Bu;
	h ^= h >> 16;
	return float(h >> 8) * (1.0 / 16777216.0);
}

// Sideways offset of a ribbon from its line: the meander and the folds.
float getAuroraDrift(float ribbon, float along, float seedOffset) {
	float meander = snoise(vec2(
		along * uAuroraMeander.y,
		ribbon * 7.31 + seedOffset + uAuroraTime * uAuroraMeander.z
	));
	float fold = snoise(vec2(
		along * uAuroraFold.y,
		ribbon * 13.17 + seedOffset + 31.0 + uAuroraTime * uAuroraFold.z
	));
	return meander * uAuroraMeander.x + fold * uAuroraFold.x;
}

void main() {
	float ribbon = uAuroraWindow.y + position.z;
	float along = uAuroraWindow.x + position.x * uAuroraWindow.z;
	float heightShare = position.y;
	float ribbonHash = getAuroraHash(ribbon);
	float seedOffset = uAuroraSeed * 173.0;
	vec2 axis = uAuroraFrame.zw;
	vec2 side = vec2(-axis.y, axis.x);

	float line = (ribbon + (ribbonHash - 0.5) * uAuroraShape.w) * uAuroraWindow.w;
	vec2 groundXZ = uAuroraFrame.xy + axis * along
		+ side * (line + getAuroraDrift(ribbon, along, seedOffset));
	// The curtain's direction on the ground, from half a column ahead.
	float ahead = along + uAuroraWindow.z * 0.5;
	vec2 aheadXZ = uAuroraFrame.xy + axis * ahead
		+ side * (line + getAuroraDrift(ribbon, ahead, seedOffset));
	vec2 tangent = normalize(aheadXZ - groundXZ);

	float presenceNoise = snoise(vec2(
		along * uAuroraPresence.x,
		ribbon * 3.71 + seedOffset + 57.0 + uAuroraTime * uAuroraPresence.w
	));
	float presence = smoothstep(uAuroraPresence.y, uAuroraPresence.y + max(uAuroraPresence.z, 1e-3), presenceNoise);
	float mask = texture2D(uAuroraMask, (groundXZ - uAuroraMaskBounds.xy) * uAuroraMaskBounds.zw).r;
	float distanceFade = 1.0 - smoothstep(uAuroraFade.x, uAuroraFade.y, length(groundXZ - uCamera.xz));
	float visibility = mask * presence * distanceFade;
	// Empty stretches collapse onto their base, so they cost no fragments, and
	// the window's edges (beyond the distance fade) stay flat.
	float grow = smoothstep(0.0, 0.15, visibility);
	float heightNoise = snoise(vec2(along * uAuroraMeander.y * 1.7, ribbon * 5.3 + seedOffset + 11.0));
	float height = uAuroraShape.y * max(1.0 + uAuroraShape.z * heightNoise, 0.0) * grow;

	float baseDistance;
	vec3 curvedBase;
	vec3 sphereNormal;
	vec3 bendAxis;
	float bendCos;
	float bendSin;
	getCurvatureBend(vec3(groundXZ.x, 0.0, groundXZ.y), baseDistance, curvedBase, sphereNormal, bendAxis, bendCos, bendSin);
	// The sway bends the curtain sideways, more toward its top.
	float sway = snoise(vec2(
		along * uAuroraSway.y,
		ribbon * 9.7 + seedOffset + 73.0 + uAuroraTime * uAuroraSway.z
	)) * uAuroraSway.x * heightShare * heightShare * grow;
	vec3 sideways = rotateAroundAxis(vec3(side.x, 0.0, side.y), bendAxis, bendCos, bendSin);
	vec3 worldPosition = curvedBase + sphereNormal * (uAuroraShape.x + heightShare * height) + sideways * sway;

	vec3 curtainNormal = rotateAroundAxis(vec3(-tangent.y, 0.0, tangent.x), bendAxis, bendCos, bendSin);
	vAuroraFacing = abs(dot(curtainNormal, normalize(cameraPosition - worldPosition)));
	vAurora = vec4(along, heightShare, ribbonHash, visibility);
	wPosition = worldPosition;
	distanceFromCamera = length(worldPosition - cameraPosition);
	gl_Position = projectionMatrix * viewMatrix * vec4(worldPosition, 1.0);
}
