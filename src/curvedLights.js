import { ShaderChunk } from 'three'
import curvedLightTerminator from './shaders/curved-light-terminator.glsl'
import sceneryShadowParsFragment from './shaders/scenery-shadow-pars-fragment.glsl'
import cloudShadowParsFragment from './shaders/cloud-shadow-pars-fragment.glsl'
import cloudTranslucencyParsFragment from './shaders/cloud-translucency-pars-fragment.glsl'
import sunOcclusionParsFragment from './shaders/sun-occlusion-pars-fragment.glsl'
import { getSceneryShadowTapDefines } from './shadowPolicy'
import { getSunOcclusionDefines } from './sunOcclusionPolicy'

// lights_fragment_begin with the curved-world terminator applied to every
// directional light, plus the shadows or the clouds' translucency. Materials
// using it must provide a view-space `vSphereNormal` varying.

// Three.js r186 include text; an upgrade that renames it disables the terminator.
const DIRECTIONAL_LIGHT_INFO = 'getDirectionalLightInfo( directionalLight, directLight );'
if (!ShaderChunk.lights_fragment_begin.includes(DIRECTIONAL_LIGHT_INFO)) {
	console.warn('Curved light terminator: lights_fragment_begin hook not found')
}

// Three.js r186 include text right after the multi-scattering compensation,
// which only the direct specular reads (RE_Direct_Physical), so scaling it
// per light dims that light's glare and nothing else.
const INCIDENT_LIGHT = 'IncidentLight directLight;'
if (!ShaderChunk.lights_fragment_begin.includes(INCIDENT_LIGHT)) {
	console.warn('Curved lights: specular hook not found')
}

// Three.js r186 include text of the directional lights' block and of the
// RE_Direct() call that ends each light (the first one after the block start).
const DIRECTIONAL_LIGHTS_BLOCK = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )'
const DIRECT_LIGHT_CALL =
	'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );'

// Sun and moon are both in every lit program, but by day the moon's color is
// exactly zero, and by night the sun's (their fade, src/dayNightPolicy.js).
// A directional light's whole contribution scales with its color, so a light
// whose uniform color is zero adds nothing: the branch skips its RE_Direct()
// (the GGX lighting, the costliest part of the loop) on every pixel at once,
// with the same result. Only the twilight, when both shine, runs both.
const directionalBlockStart = ShaderChunk.lights_fragment_begin.indexOf(DIRECTIONAL_LIGHTS_BLOCK)
const directLightCall = ShaderChunk.lights_fragment_begin.indexOf(
	DIRECT_LIGHT_CALL,
	directionalBlockStart,
)
if (directionalBlockStart < 0 || directLightCall < 0) {
	console.warn('Curved lights: directional RE_Direct hook not found')
}
const LIGHTS_FRAGMENT_BEGIN =
	directionalBlockStart < 0 || directLightCall < 0
		? ShaderChunk.lights_fragment_begin
		: `${ShaderChunk.lights_fragment_begin.slice(0, directLightCall)}if ( any( notEqual( directionalLight.color, vec3( 0.0 ) ) ) ) ${ShaderChunk.lights_fragment_begin.slice(directLightCall)}`

// Adds `code` to every directional light, before its RE_Direct(). Three.js
// unrolls that loop by copying its body without the braces (unrollLoops() in
// WebGLProgram.js), and its pattern ends the body at the first closing brace,
// so `code` may only assign and call: a declaration would repeat for every
// light, and a brace would cut the loop short.
function addToDirectionalLights(code) {
	return LIGHTS_FRAGMENT_BEGIN.replace(DIRECTIONAL_LIGHT_INFO, `${DIRECTIONAL_LIGHT_INFO}\n${code}`)
}

// Scenery shadows (src/sceneryShadows.js) dim only the direct light of the
// light that casts them. Sun and moon are always opposite, so the sign of the
// dot product with uSceneryShadowLight picks that light without relying on
// the order of Three.js's directional light array. The same light loses its
// glare to the shadows' specular share, and, while the sun is low, the sun
// loses its glare and part of its diffuse light to the relief
// (SUN_OCCLUSION_STEPS, src/sunOcclusion.js).
const SHADOWED_DIRECTIONAL_LIGHT = `directLight.color *= mix(1.0, sceneryShadow, step(0.0, dot(directLight.direction, sceneryShadowLightView)));
material.multiScatteringCompensation = sceneryMultiScattering * mix(1.0, sceneryShadowSpecular, step(0.0, dot(directLight.direction, sceneryShadowLightView)));
#ifdef SUN_OCCLUSION_STEPS
directLight.color *= mix(1.0, sunOcclusion.y, step(0.0, dot(directLight.direction, sunOcclusionView)));
material.multiScatteringCompensation *= mix(1.0, sunOcclusion.x, step(0.0, dot(directLight.direction, sunOcclusionView)));
#endif`

const curvedShadowedLightsBody = addToDirectionalLights(
	`${curvedLightTerminator}\n${SHADOWED_DIRECTIONAL_LIGHT}`,
).replace(
	INCIDENT_LIGHT,
	`${INCIDENT_LIGHT}\nvec3 sceneryMultiScattering = material.multiScatteringCompensation;`,
)

// The curved-world lighting plus the scenery shadow. `sceneryExpression` and
// `cloudExpression` are GLSL float expressions evaluated once per fragment,
// usually a getSceneryShadow() call (scenery-shadow-pars-fragment.glsl must be
// included) and a getCloudShadow() call (cloud-shadow-pars-fragment.glsl).
// Their product dims the diffuse and specular light. The glare takes the same
// lookups with the specular share in place of their strength
// (getSpecularShadowScale() in src/shadowPolicy.js), so a fully shadowed
// pixel keeps some diffuse light but none of the glare. `position` is the flat
// position the low-sun occlusion marches from.
function createShadowedLightsFragment(sceneryExpression, cloudExpression, position) {
	return `float sceneryMapShadow = ${sceneryExpression};
float sceneryCloudShadow = ${cloudExpression};
float sceneryShadow = sceneryMapShadow * sceneryCloudShadow;
float sceneryShadowSpecular =
	saturate(1.0 - (1.0 - sceneryMapShadow) * uSceneryShadowSpecular) *
	saturate(1.0 - (1.0 - sceneryCloudShadow) * uCloudShadowSpecular);
vec3 sceneryShadowLightView = normalize((viewMatrix * vec4(uSceneryShadowLight, 0.0)).xyz);
#ifdef SUN_OCCLUSION_STEPS
vec3 sunOcclusionView = normalize((viewMatrix * vec4(uSunDirection, 0.0)).xyz);
vec2 sunOcclusion = getSunOcclusion(${position}, distanceFromCamera, normal, normalize(vViewPosition), sunOcclusionView, normalize(vSphereNormal));
#endif
${curvedShadowedLightsBody}`
}

// Three.js r186 include text for the ambient term.
const AMBIENT_IRRADIANCE = 'vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );'
if (!ShaderChunk.lights_fragment_begin.includes(AMBIENT_IRRADIANCE)) {
	console.warn('Curved lights: ambient irradiance hook not found')
}

// The light a translucent cloud carries through (CLOUD_TRANSLUCENCY,
// cloud-translucency-pars-fragment.glsl), after the terminator, so a light
// below the cloud's local horizon carries nothing either.
const TRANSLUCENT_DIRECTIONAL_LIGHT = `#ifdef CLOUD_TRANSLUCENCY
reflectedLight.directDiffuse += getCloudTranslucency(directLight.color, directLight.direction, geometryNormal, geometryViewDir, material.diffuseContribution);
#endif`

const curvedUnshadowedLightsBody = addToDirectionalLights(
	`${curvedLightTerminator}\n${TRANSLUCENT_DIRECTIONAL_LIGHT}`,
)

// The curved-world lighting without shadows, with the ambient light scaled by
// the GLSL float `ambientScaleExpression`. Clouds use it: seen from below, their
// undersides get only ambient light, which this lifts while still following
// the day/night ambient color.
function createUnshadowedLightsFragment(ambientScaleExpression = '1.0') {
	return curvedUnshadowedLightsBody.replace(
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

// World direction toward the sun (DayNight), whatever light casts the
// shadows: the low-sun occlusion and the clouds' translucency tell the sun
// from the moon by it.
const SUN_DIRECTION_PARS = 'uniform vec3 uSunDirection;'

// The lighting of a terrain or scenery material, in one place. Every variant
// shares one GLSL text per path; defines alone tell the programs apart.
// - With `shadows` ({ taps: [near, far], position, selfBias }, GLSL
//   expressions for the flat shadow position and the self bias), the scenery
//   and cloud shadows dim the shadowing light, and remove its glare.
//   `sunOcclusion` ({ steps }) adds the low-sun terrain occlusion
//   (SUN_OCCLUSION_STEPS), which needs the terrain's `distanceFromCamera` and
//   `vShadowPosition`-like flat `position`.
// - Without, there is no shadow (SCENERY_NO_SHADOWS) and `ambientScale`, a
//   float uniform, optionally lifts the ambient light; `translucent` adds the
//   clouds' carried light (CLOUD_TRANSLUCENCY), whose uniforms the material
//   provides.
// Returns the material defines, the fragment declarations to add after
// <common>, the lights_fragment_begin replacement, and the extra uniforms.
export function createSceneryLighting({
	shadows = null,
	sunOcclusion = null,
	ambientScale = null,
	translucent = false,
} = {}) {
	const parsFragment = [
		SUN_DIRECTION_PARS,
		sceneryShadowParsFragment,
		cloudShadowParsFragment,
		AMBIENT_SCALE_PARS,
		cloudTranslucencyParsFragment,
		sunOcclusionParsFragment,
	].join('\n')
	if (shadows) {
		const [near, far] = shadows.taps
		const { position, selfBias } = shadows
		return {
			defines: {
				...getSceneryShadowTapDefines(near, far),
				...(sunOcclusion ? getSunOcclusionDefines(sunOcclusion.steps) : {}),
			},
			parsFragment,
			lightsFragment: createShadowedLightsFragment(
				`getSceneryShadow(${position}, ${selfBias})`,
				`getCloudShadow(${position})`,
				position,
			),
			uniforms: {},
		}
	}
	const defines = { SCENERY_NO_SHADOWS: '' }
	if (ambientScale) defines.SCENERY_AMBIENT_SCALE = ''
	if (translucent) defines.CLOUD_TRANSLUCENCY = ''
	return {
		defines,
		parsFragment,
		lightsFragment: createUnshadowedLightsFragment('SCENERY_AMBIENT_SCALE_VALUE'),
		uniforms: ambientScale ? { uSceneryAmbientScale: ambientScale } : {},
	}
}
