// xyz: base position in chunk space, w: scale.
attribute vec4 aInstanceA;
// x: yaw, y: type index, z: packed RGB tint, w: vertical stretch.
attribute vec4 aInstanceB;
// x: frame radius, y: bounding-sphere center height, per impostor type.
uniform vec2 uImpostorTypes[IMPOSTOR_TYPE_COUNT];
// xy: atlas cell of the frame (in frames), zw: UV inside the frame.
varying vec4 vFrame0;
varying vec4 vFrame1;
varying vec4 vFrame2;
varying vec3 vFrameWeights;
varying vec3 vTint;
// Columns of the local-normal to view-space matrix.
varying vec3 vImpostorNormalX;
varying vec3 vImpostorNormalY;
varying vec3 vImpostorNormalZ;
varying vec3 vSphereNormal;

vec3 rotateYaw(vec3 v, float c, float s) {
	return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}
