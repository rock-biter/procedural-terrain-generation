// Constants of the world shared across modules.

// Radius of the sphere the world is bent onto (project-vertex.glsl and the
// other curved shaders read it through the `uCurvature` uniform).
export const CURVATURE = 3000

// Side of a terrain chunk in world units.
export const CHUNK_SIZE = 256

// Runtime switches for the world's optional layers (the boats are scenery).
export const WORLD_FEATURES = Object.freeze({
	scenery: true,
	clouds: true,
	aurora: true,
})
