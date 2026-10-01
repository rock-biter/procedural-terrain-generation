// Follows scenery-instance-pars-vertex.glsl (instance attributes, tint, bend,
// and mesh fade).
// x: frame radius, y: bounding-sphere center height, per impostor type.
uniform vec2 uImpostorTypes[IMPOSTOR_TYPE_COUNT];
// xy: atlas cell of the frame (in frames), zw: UV inside the frame.
varying vec4 vFrame0;
varying vec4 vFrame1;
varying vec4 vFrame2;
varying vec3 vFrameWeights;
// Columns of the local-normal to view-space matrix.
varying vec3 vImpostorNormalX;
varying vec3 vImpostorNormalY;
varying vec3 vImpostorNormalZ;
