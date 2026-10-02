varying vec3 vDirection;

void main() {
	// The dome is centered on the camera, so local position is the view direction.
	vDirection = position;
	vec4 clipPosition = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
	// Just inside the far plane, whatever the dome radius: drawn after the
	// scene with the depth test on, the sky only shades the pixels nothing
	// else covers.
	gl_Position = vec4(clipPosition.xy, clipPosition.w * 0.999999, clipPosition.w);
}
