// Turn about +Y by the angle with cosine c and sine s (instance yaw).
#ifndef ROTATE_YAW
#define ROTATE_YAW
vec3 rotateYaw(vec3 v, float c, float s) {
	return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}
#endif
