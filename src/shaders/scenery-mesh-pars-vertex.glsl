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
// Wood detail settings per type (see applyDetail() in
// scenery-detail-pars-fragment.glsl), passed on for the instance's type.
uniform vec3 uSceneryDetail[IMPOSTOR_TYPE_COUNT];
varying vec3 vSceneryDetail;
#ifdef SCENERY_PALETTE
// Crown mask of the source vertex (1 on crowns, src/impostors/impostorArchetypes.js),
// the share of the palette tint over the trunk tint.
attribute float paint;
varying float vSceneryPaint;
#endif
