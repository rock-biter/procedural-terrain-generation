// Inserted after <opaque_fragment> in the debug wireframe overlays
// (src/impostors/sceneryWireframe.js): the level's flat color replaces the
// shaded one; fog and tone mapping still apply.
gl_FragColor = vec4(uSceneryWireframeColor, 1.0);
// Edges share their triangles' depth, and polygon offset does not apply to
// lines, so the edges move toward the eye by 0.1% of their distance to stay
// in front of the surface they outline. With a standard depth buffer,
// 1 - depth is about near / distance, so this offset is that share at any
// range. Writing the depth costs early depth rejection, but only for this
// debug overlay.
gl_FragDepth = gl_FragCoord.z - 1e-3 * (1.0 - gl_FragCoord.z);
