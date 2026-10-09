// The aurora's curtains (src/aurora.js), drawn additively: a vertical
// gradient of three colors, a sharp base, rays that fray the top, and
// brightness waves running along the curtains. Unlit and fog-free, like the
// sky; it fades into the curved horizon instead.
#include ./common.glsl

// Base, middle, and top colors, linear (Aurora.applySettings() converts the
// sRGB settings).
uniform vec3 uAuroraColors[3];
// x: height share of the middle color, y: base softness, z: top softness, w:
// brightness lost at the top.
uniform vec4 uAuroraProfile;
// x: one over the wavelength, y: speed, z: sharpness, w: strength.
uniform vec4 uAuroraRays;
// x: one over the wavelength, y: speed, z: strength.
uniform vec3 uAuroraPulse;
// aurora.vert.glsl; z: horizon fade (radians), w: edge-on fade.
uniform vec4 uAuroraFade;
uniform float uAuroraIntensity;
// Night window times fade-in (stepAurora() in src/auroraPolicy.js).
uniform float uAuroraVisibility;
uniform float uAuroraTime;
// The curved world's horizon dip below the horizontal, in radians (DayNight).
uniform float uHorizonDipAngle;

varying vec4 vAurora;
varying float vAuroraFacing;

void main() {
	float along = vAurora.x;
	float heightShare = vAurora.y;
	float ribbonHash = vAurora.z;

	// Rays: two octaves of noise along the curtain, drifting with time.
	vec2 rayPosition = vec2(along * uAuroraRays.x, uAuroraTime * uAuroraRays.y + ribbonHash * 41.0);
	float ray = 0.5 + 0.5 * (snoise(rayPosition) * 0.65 + snoise(rayPosition * vec2(3.1, 1.7) + 17.0) * 0.35);
	ray = pow(clamp(ray, 0.0, 1.0), uAuroraRays.z);
	float top = mix(1.0, 0.35 + 0.65 * ray, uAuroraRays.w);
	float bottomSoftness = max(uAuroraProfile.y, 1e-3);
	float topSoftness = max(uAuroraProfile.z, 1e-3);
	float profile = smoothstep(0.0, bottomSoftness, heightShare)
		* (1.0 - smoothstep(top - topSoftness, top, heightShare))
		* (1.0 - uAuroraProfile.w * heightShare);
	float rayBrightness = mix(1.0, 0.2 + 1.6 * ray, uAuroraRays.w);
	float pulse = max(1.0 + uAuroraPulse.z * sin(6.2831853 * (along * uAuroraPulse.x - uAuroraTime * uAuroraPulse.y + ribbonHash)), 0.0);

	vec3 color = mix(uAuroraColors[0], uAuroraColors[1], smoothstep(0.0, uAuroraProfile.x, heightShare));
	color = mix(color, uAuroraColors[2], smoothstep(uAuroraProfile.x, 1.0, heightShare));

	// Elevation above the curved world's visible edge, as in sky.frag.glsl.
	vec3 direction = normalize(wPosition - cameraPosition);
	float elevation = asin(clamp(direction.y, -1.0, 1.0)) + uHorizonDipAngle;
	float horizon = smoothstep(0.0, max(uAuroraFade.z, 1e-4), elevation);
	// Edge-on, a curtain thins to a flickering line.
	float edge = smoothstep(0.0, max(uAuroraFade.w, 1e-4), vAuroraFacing);

	float strength = profile * rayBrightness * pulse * vAurora.w * horizon * edge
		* uAuroraIntensity * uAuroraVisibility;
	gl_FragColor = vec4(color * strength, 1.0);

	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}
