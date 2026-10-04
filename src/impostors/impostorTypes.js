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
})

export const IMPOSTOR_TYPE_COUNT = 7

// Atlas layout: one block of frames x frames views per type. The frame count
// is chosen per device (src/sceneryImpostors.js) and must be even so no frame looks straight
// down (see getFrameBasis()). Desktop impostors only appear beyond the near
// meshes (sceneryMeshes.js), so they share the mobile grid; the shadow casters
// read the same atlas. Seven types fill a 4 x 2 grid of blocks, leaving one
// slot free.
export const IMPOSTOR_FRAMES_DESKTOP = 12
export const IMPOSTOR_FRAMES_MOBILE = 12
export const IMPOSTOR_ATLAS_COLUMNS = 4
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

// Clouds always turn to face the airplane and float above it, so the camera
// sees them only from the front and below. Their atlas therefore bakes a
// frontal band (createFrontalViews() in octahedral.js): framesX azimuths
// within ±azimuth of the front face, and framesY elevations from the horizon
// down to `elevation` below it. Impostors appear only beyond the near meshes,
// where the follow camera stays within about 4 degrees of the front and 10 to
// 40 degrees below the horizon; the margins keep other settings plausible.
export const CLOUD_IMPOSTOR_VIEWS = Object.freeze({
	framesX: 3,
	framesY: 10,
	azimuth: (10 * Math.PI) / 180,
	elevation: (75 * Math.PI) / 180,
})
// Clouds are much larger on screen than scenery, hence the bigger frames; the
// baker shrinks them if the atlas would exceed the GPU texture limit.
export const CLOUD_IMPOSTOR_FRAME_SIZE_DESKTOP = 96
export const CLOUD_IMPOSTOR_FRAME_SIZE_MOBILE = 64
// Cloud shadows see the clouds along the light, from any side, so they read a
// separate small lower-hemisphere atlas of coverage (src/cloudShadows.js).
export const CLOUD_SHADOW_IMPOSTOR_FRAMES = 8
export const CLOUD_SHADOW_IMPOSTOR_FRAME_SIZE = 32
export const CLOUD_ATLAS_COLUMNS = 3
export const CLOUD_ATLAS_ROWS = 1
