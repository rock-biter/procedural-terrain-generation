// Follows scenery-instance-pars-vertex.glsl. SCENERY_MESH_LOD (0 or 1) selects
// this material's level of detail.
// Eye-distance band where LOD 0 hands over to LOD 1: x start, y end.
uniform vec2 uSceneryMeshLodRange;
// Bounding radius of each type's LOD 0 source, for the self-shadow bias.
uniform float uSceneryBoundRadius[IMPOSTOR_TYPE_COUNT];
// Share of pixels drawn by LOD 0 (see scenery-mesh-color-fragment.glsl).
varying float vSceneryLodFade;
// Object-space position and normal for the triplanar wood detail, as in the
// impostor bake.
varying vec3 vSceneryLocalPosition;
varying vec3 vSceneryLocalNormal;
