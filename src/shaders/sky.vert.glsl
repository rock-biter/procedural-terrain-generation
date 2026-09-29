varying vec3 vDirection;

void main() {
	// The dome is centered on the camera, so local position is the view direction.
	vDirection = position;
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
