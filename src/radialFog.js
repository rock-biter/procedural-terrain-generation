import { ShaderChunk } from 'three'

// Three.js fogs by view depth (-mvPosition.z), so equal fog lies on planes
// parallel to the screen and the curved world's edge is hazier at the center
// of the view than at its sides. Fogging by distance from the eye keeps the
// haze uniform along the edge's arc. Patched once, before any material
// compiles; every built-in material with fog picks it up.
const DEPTH_FOG = 'vFogDepth = - mvPosition.z;'

if (!ShaderChunk.fog_vertex.includes(DEPTH_FOG)) {
	console.warn('radialFog: fog_vertex changed; fog stays depth-based.')
}

ShaderChunk.fog_vertex = ShaderChunk.fog_vertex.replace(
	DEPTH_FOG,
	'vFogDepth = length( mvPosition.xyz );',
)
