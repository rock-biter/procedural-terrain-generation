# Rendering And Shaders

## Purpose

This document defines the contracts between Three.js materials, shared uniforms, custom attributes, and GLSL replacements. Read it before changing a material, upgrading Three.js, or editing files under [`src/shaders/`](../src/shaders/).

## Scene Setup

[`main.js`](../main.js) owns the global rendering setup:

- `WebGLRenderer` enables antialiasing and a logarithmic depth buffer.
- Renderer size follows the viewport and pixel ratio is capped at `2`.
- The perspective camera uses near/far planes of `0.1` and `10000`.
- Desktop starts at a `60` degree FOV and zoom `1`; mobile starts at `80` degrees and zoom `0.8`.
- The scene background and fog share the configured fog color. Fog currently spans `250` to `900` world units.
- Ambient and directional lights use intensities from the shared `params` object.
- The camera is attached to `Plane`, so its transform is relative to the moving player object.

Resize changes the camera aspect, projection matrix, renderer dimensions, and capped pixel ratio.

## Shader Injection Pattern

The application does not use `ShaderMaterial`. It starts with built-in Three.js materials and patches generated shaders through `material.onBeforeCompile`.

| Rendered content          | JavaScript owner                    | Base material                      | Replacements                                                         |
| ------------------------- | ----------------------------------- | ---------------------------------- | -------------------------------------------------------------------- |
| Terrain and water surface | [`src/chunk.js`](../src/chunk.js)   | `MeshStandardMaterial`             | `common`, `project_vertex`, `color_fragment`, `normal_fragment_maps` |
| Boats                     | [`src/chunk.js`](../src/chunk.js)   | Materials from the glTF model      | `common`, `project_vertex`                                           |
| Trees                     | [`src/trees.js`](../src/trees.js)   | `MeshStandardMaterial`             | `common`, `project_vertex`, `color_fragment`                         |
| Clouds                    | [`src/clouds.js`](../src/clouds.js) | Transparent `MeshStandardMaterial` | `common`, `project_vertex`, `color_fragment`, `normal_fragment_maps` |
| Plane trails              | [`src/plane.js`](../src/plane.js)   | Transparent `MeshBasicMaterial`    | `common`, `project_vertex`, `color_fragment`                         |

Each replacement string must match the corresponding Three.js shader include exactly. A Three.js upgrade can rename or reorganize those includes while the JavaScript build still succeeds.

The tree, cloud, and boat shader paths are currently dormant because all three `worldFeatures` flags are disabled in `main.js`. Terrain and water continue to use the existing `MeshStandardMaterial` replacement path unchanged.

## Shared GLSL Contract

[`src/shaders/common.glsl`](../src/shaders/common.glsl) retains Three.js's original `#include <common>` and adds:

- `uTime`: elapsed render time.
- `uCamera`: the plane's world position, used as the visual reference point.
- `uCurvature`: radius used by the curved-world projection.
- `uGrass`, `uLand`, and `uRocks`: terrain biome colors.
- `wPosition`: world-space position passed from vertex to fragment stages.
- `distanceFromCamera`: distance used for curvature, scaling, atmospheric darkening, and fading.
- Shared `rotateZ()` and simplex-noise helpers.

The terrain geometry also provides a custom scalar `height` attribute. Its value is the raw procedural height, including underwater values that differ from the CPU-clamped visible vertex position. Position, normal, UV, height, and index arrays are generated in a worker, transferred, and wrapped in `BufferGeometry` on the main thread before rendering.

The plane trail injects `uRotation`, `uAcceleration`, and `vUV` inline because they are specific to that material path.

## Shader Paths

### Terrain

- [`project-vertex.glsl`](../src/shaders/project-vertex.glsl) applies water movement, distance-based curvature, and the final projection.
- [`color-fragment.glsl`](../src/shaders/color-fragment.glsl) keeps five elevation-based land bands and switches between their existing palette and a sand-to-dark-brown desert palette. A very-low-frequency signed simplex-noise sample in world XZ coordinates selects the desert biome below zero and the existing biome above zero; two denser samples fray the boundary at different scales. An antialiased black separator hides the hard palette transition on land only, leaving water colors and wave highlights independent.
- [`normal-fragment-map.glsl`](../src/shaders/normal-fragment-map.glsl) attenuates tangent-space normal-map strength with distance.

### Instanced Scenery

- [`project-instanced-vertex.glsl`](../src/shaders/project-instanced-vertex.glsl) applies instance transforms, tree movement, distance scaling, and curvature.
- [`project-vertex-clouds.glsl`](../src/shaders/project-vertex-clouds.glsl) applies instance transforms, distance scaling, and curvature for clouds.
- Tree and cloud fragment replacements apply snow/atmosphere coloring and different distance fade ranges.

### Boats And Trails

- [`project-vertex-boat.glsl`](../src/shaders/project-vertex-boat.glsl) transforms cloned boat meshes in world space and applies curvature around the moving reference point.
- [`project-vertex-plane.glsl`](../src/shaders/project-vertex-plane.glsl) bends trails from the airplane model's roll.
- Trail alpha is assembled inline in `Plane.addTrails()` from UV, roll, and acceleration.

## Uniform Update Timing

- `main.js` updates `uTime` and `uCamera` once per frame after `plane.update()` and before rendering.
- `Chunk` adds `uCurvature` to the shared uniform object during construction.
- Biome colors are initialized from `params.colors`; the disabled GUI can mutate them.
- `Plane.update()` writes `uAcceleration` before the frame renders.
- Shader callbacks merge custom uniform entries with Three.js-generated uniforms at compilation time.

Do not replace the shared uniform wrapper objects each frame. Update their `.value` fields so compiled materials retain the same references.

## Materials And Textures

- Terrain uses `normal.jpg` with repeat wrapping, a `6` by `6` repeat, and normal scale `(2, -2)`.
- When enabled, trees use the separately loaded `assets.normalMap`.
- When enabled, clouds receive the terrain normal map after construction.
- Terrain, tree, and cloud materials are module-level shared instances. Their shader hooks and mutable properties therefore affect every instance using that material.
- Boats originate from cloned glTF scene nodes; verify whether geometry and material resources remain shared before disposing or mutating them.

See [Assets](ASSETS.md) for load paths, transforms, and licensing.

## Safe Change Checklist

1. Identify every JavaScript owner that injects the edited GLSL file.
2. Confirm required uniforms, varyings, and attributes are declared in both shader stages that use them.
3. Preserve the original Three.js include when the replacement depends on built-in declarations or behavior.
4. Run `pnpm build` to validate imports and bundling.
5. Load the scene and check the browser console for shader compile or link errors.
6. Inspect terrain, water, trees, clouds, boats, and trails as applicable.
7. Move far enough to exercise distance fades, curvature, new chunks, and multiple LODs.
8. Repeat at a narrow/mobile viewport because geometry density and camera settings differ.

## Open Questions

- Should shader contracts receive automated compile checks against the installed Three.js version?
- Should module-level materials be replaced with explicitly owned or cached variants?
- Should curvature and atmosphere calculations share one documented distance convention?
- What visual baseline should be used for regression screenshots?
