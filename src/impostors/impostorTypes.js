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
// down (see getFrameBasis()). Desktop impostors only appear beyond the near
// meshes (sceneryMeshes.js), so they share the mobile grid; the shadow casters
// read the same atlas.
export const IMPOSTOR_FRAMES_DESKTOP = 12
export const IMPOSTOR_FRAMES_MOBILE = 12
export const IMPOSTOR_ATLAS_COLUMNS = 3
export const IMPOSTOR_ATLAS_ROWS = 2

// Floats per instance in placement buffers: x, y, z (chunk-local base), scale,
// yaw, type, packed RGB tint, vertical stretch.
export const IMPOSTOR_INSTANCE_STRIDE = 8

// Cloud shapes, in their own atlas (src/impostors/cloudArchetypes.js). Clouds
// share the instance layout above with world-space bases; their yaw slot only
// seeds the dither, because the shaders turn every cloud to face the airplane.
export const CLOUD_TYPE = Object.freeze({
	BANK: 0,
	HEAP: 1,
	PUFF: 2,
})

export const CLOUD_TYPE_COUNT = 3

// Clouds are seen only from below, so their atlas bakes the lower hemisphere.
// They are much larger on screen than scenery, hence the bigger frames; the
// baker shrinks them if the atlas would exceed the GPU texture limit.
export const CLOUD_IMPOSTOR_FRAMES = 12
export const CLOUD_IMPOSTOR_FRAME_SIZE_DESKTOP = 96
export const CLOUD_IMPOSTOR_FRAME_SIZE_MOBILE = 64
export const CLOUD_ATLAS_COLUMNS = 3
export const CLOUD_ATLAS_ROWS = 1
