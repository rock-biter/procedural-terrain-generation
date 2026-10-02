// Inserted after <opaque_fragment> in the debug wireframe overlays
// (src/impostors/sceneryWireframe.js): the level's flat color replaces the
// shaded one; fog and tone mapping still apply.
gl_FragColor = vec4(uSceneryWireframeColor, 1.0);
#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
// Edges share their triangles' depth; a tiny pull toward the eye keeps them
// from z-fighting the solid surface they outline.
gl_FragDepth = max(gl_FragDepth - 1e-5, 0.0);
#endif
