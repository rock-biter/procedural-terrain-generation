// Impostor type indices shared by placement (worker), the baker, and the
// impostor shader. The index is the type's slot in the atlas.
export const IMPOSTOR_TYPE = Object.freeze({
	ROUND_TREE: 0,
	CONIFER: 1,
	CACTUS_ONE_ARM: 2,
	CACTUS_TWO_ARMS: 3,
	BOULDER: 4,
	LAYERED_ROCK: 5,
})

export const IMPOSTOR_TYPE_COUNT = 6

// Atlas layout: one block of frames x frames views per type. The frame count
// is chosen per device in main.js and must be even so no frame looks straight
// down (see getFrameBasis()).
export const IMPOSTOR_FRAMES_DESKTOP = 16
export const IMPOSTOR_FRAMES_MOBILE = 12
export const IMPOSTOR_ATLAS_COLUMNS = 3
export const IMPOSTOR_ATLAS_ROWS = 2

// Floats per instance in placement buffers: x, y, z (chunk-local base), scale,
// yaw, type, packed RGB tint, vertical stretch.
export const IMPOSTOR_INSTANCE_STRIDE = 8
