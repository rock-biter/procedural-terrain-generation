import { ShaderChunk } from 'three'
import curvedLightTerminator from './shaders/curved-light-terminator.glsl'
import sceneryShadowParsFragment from './shaders/scenery-shadow-pars-fragment.glsl'
import cloudShadowParsFragment from './shaders/cloud-shadow-pars-fragment.glsl'
import { getSceneryShadowTapDefines } from './shadowPolicy'

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
function createShadowedLightsFragment(shadowExpression) {
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
function createUnshadowedLightsFragment(ambientScaleExpression = '1.0') {
	return curvedLightsFragment.replace(
		AMBIENT_IRRADIANCE,
		`vec3 irradiance = getAmbientLightIrradiance( ambientLightColor ) * (${ambientScaleExpression});`,
	)
}

// Ambient multiplier of the unshadowed lighting: the uSceneryAmbientScale
// uniform with the SCENERY_AMBIENT_SCALE define, 1 without. As a define it is
// part of the program cache key, so materials with and without it never share
// a program, while their GLSL text stays the same.
const AMBIENT_SCALE_PARS = `#ifdef SCENERY_AMBIENT_SCALE
uniform float uSceneryAmbientScale;
#define SCENERY_AMBIENT_SCALE_VALUE uSceneryAmbientScale
#else
#define SCENERY_AMBIENT_SCALE_VALUE 1.0
#endif`

// The lighting of a terrain or scenery material, in one place.
// - With `shadows` ({ taps: [near, far], position, selfBias }, GLSL
//   expressions for the flat shadow position and the self bias), the scenery
//   and cloud shadows dim the shadowing light.
// - Without, there is no shadow (SCENERY_NO_SHADOWS) and `ambientScale`, a
//   float uniform, optionally lifts the ambient light (clouds).
// Returns the material defines, the fragment declarations to add after
// <common>, the lights_fragment_begin replacement, and the extra uniforms.
export function createSceneryLighting({ shadows = null, ambientScale = null } = {}) {
	const parsFragment = `${sceneryShadowParsFragment}\n${cloudShadowParsFragment}\n${AMBIENT_SCALE_PARS}`
	if (shadows) {
		const [near, far] = shadows.taps
		const { position, selfBias } = shadows
		return {
			defines: getSceneryShadowTapDefines(near, far),
			parsFragment,
			lightsFragment: createShadowedLightsFragment(
				`getSceneryShadow(${position}, ${selfBias}) * getCloudShadow(${position})`,
			),
			uniforms: {},
		}
	}
	return {
		defines: ambientScale
			? { SCENERY_NO_SHADOWS: '', SCENERY_AMBIENT_SCALE: '' }
			: { SCENERY_NO_SHADOWS: '' },
		parsFragment,
		lightsFragment: createUnshadowedLightsFragment('SCENERY_AMBIENT_SCALE_VALUE'),
		uniforms: ambientScale ? { uSceneryAmbientScale: ambientScale } : {},
	}
}
