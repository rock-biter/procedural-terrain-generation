import { ShaderChunk } from 'three'
import curvedLightTerminator from './shaders/curved-light-terminator.glsl'

// lights_fragment_begin with the curved-world terminator applied to every
// directional light. Materials using it must provide a view-space
// `vSphereNormal` varying.

// Three.js r186 include text; an upgrade that renames it disables the terminator.
const DIRECTIONAL_LIGHT_INFO = 'getDirectionalLightInfo( directionalLight, directLight );'
if (!ShaderChunk.lights_fragment_begin.includes(DIRECTIONAL_LIGHT_INFO)) {
	console.warn('Curved light terminator: lights_fragment_begin hook not found')
}

export const curvedLightsFragment = ShaderChunk.lights_fragment_begin.replace(
	DIRECTIONAL_LIGHT_INFO,
	`${DIRECTIONAL_LIGHT_INFO}\n${curvedLightTerminator}`,
)

// Scenery shadows (src/sceneryShadows.js) dim only the direct light of the
// light that casts them. Sun and moon are always opposite, so the sign of the
// dot product with uSceneryShadowLight picks that light without relying on
// the order of Three.js's directional light array.
const SHADOWED_DIRECTIONAL_LIGHT =
	'directLight.color *= mix(1.0, sceneryShadow, step(0.0, dot(directLight.direction, sceneryShadowLightView)));'

const curvedShadowedLightsBody = ShaderChunk.lights_fragment_begin.replace(
	DIRECTIONAL_LIGHT_INFO,
	`${DIRECTIONAL_LIGHT_INFO}\n${curvedLightTerminator}\n${SHADOWED_DIRECTIONAL_LIGHT}`,
)

// curvedLightsFragment plus the scenery shadow. `shadowExpression` is a GLSL
// float expression evaluated once per fragment, usually a getSceneryShadow()
// call (scenery-shadow-pars-fragment.glsl must be included), multiplied by a
// getCloudShadow() call (cloud-shadow-pars-fragment.glsl).
export function createShadowedLightsFragment(shadowExpression) {
	return `float sceneryShadow = ${shadowExpression};
vec3 sceneryShadowLightView = normalize((viewMatrix * vec4(uSceneryShadowLight, 0.0)).xyz);
${curvedShadowedLightsBody}`
}

// Three.js r186 include text for the ambient term.
const AMBIENT_IRRADIANCE = 'vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );'
if (!ShaderChunk.lights_fragment_begin.includes(AMBIENT_IRRADIANCE)) {
	console.warn('Curved lights: ambient irradiance hook not found')
}

// curvedLightsFragment without shadows, with the ambient light scaled by the
// GLSL float `ambientScaleExpression`. Clouds use it: seen from below, their
// undersides get only ambient light, which this lifts while still following
// the day/night ambient color.
export function createUnshadowedLightsFragment(ambientScaleExpression = '1.0') {
	return curvedLightsFragment.replace(
		AMBIENT_IRRADIANCE,
		`vec3 irradiance = getAmbientLightIrradiance( ambientLightColor ) * (${ambientScaleExpression});`,
	)
}
