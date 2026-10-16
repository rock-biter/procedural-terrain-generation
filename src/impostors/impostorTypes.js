// Impostor type indices shared by placement (worker), the baker, and the
// impostor shader. The index is the type's slot in the atlas.
export const IMPOSTOR_TYPE = Object.freeze({
	ROUND_TREE: 0,
	CONIFER: 1,
	CACTUS_ONE_ARM: 2,
	CACTUS_TWO_ARMS: 3,
	BOULDER: 4,
	LAYERED_ROCK: 5,
	SEA_ROCK: 6,
	BOAT: 7,
	ICE_SPIKES_TWO: 8,
	ICE_SPIKES_THREE: 9,
	PALM: 10,
})

export const IMPOSTOR_TYPE_COUNT = 11

// Atlas layout: one block of frames x frames views per type. The frame count
// is chosen per device (src/sceneryImpostors.js) and must be even so no frame looks straight
// down (see getFrameBasis()). Desktop impostors only appear beyond the near
// meshes (sceneryMeshes.js), so they share the mobile grid; the shadow casters
// read the same atlas. Eleven types use 11 of the 4 x 3 grid of blocks (3072 x
// 2304 at 64 px frames, inside a 4096 texture limit): one more type fits, then
// it needs another row or column.
export const IMPOSTOR_FRAMES_DESKTOP = 12
export const IMPOSTOR_FRAMES_MOBILE = 12
export const IMPOSTOR_ATLAS_COLUMNS = 4
export const IMPOSTOR_ATLAS_ROWS = 3

// Floats per instance in placement buffers: x, y, z (chunk-local base), scale,
// yaw, type, packed RGB tint, vertical stretch.
export const IMPOSTOR_INSTANCE_STRIDE = 8
