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
