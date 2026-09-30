# Rendering And Shaders

## Purpose

This document defines the contracts between Three.js materials, shared uniforms, custom attributes, and GLSL replacements. Read it before changing a material, upgrading Three.js, or editing files under [`src/shaders/`](../src/shaders/).

## Scene Setup

[`main.js`](../main.js) owns the global rendering setup:

- `WebGLRenderer` enables antialiasing and a logarithmic depth buffer.
- Renderer size follows the viewport and pixel ratio is capped at `2`.
- The perspective camera uses near/far planes of `0.1` and `10000`.
- Desktop starts at a `60` degree FOV and zoom `1`; mobile starts at `80` degrees and zoom `0.8`.
- The scene background and fog share the day/night horizon color, rewritten every frame by `DayNight`. Fog currently spans `250` to `900` world units.
- An ambient light and two directional lights (sun and moon) are driven by the day/night cycle. `params.ambientLight`, `params.directionalLight` (sun), and `params.moonLight` (default `1.2`) are peak intensities that the cycle scales every frame. All three are GUI sliders.
- No tone mapping is configured; the renderer uses Three.js defaults (`NoToneMapping`, sRGB output).
- The camera is attached to `Plane`, so its transform is relative to the moving player object.

Resize changes the camera aspect, projection matrix, capped pixel ratio, and then the post-processing composer, which resizes the renderer and its buffers to the drawing-buffer size. The pixel ratio must be set before `PostProcessing.setSize()`.

## Post-Processing Pipeline

[`src/postProcessing.js`](../src/postProcessing.js) owns a `postprocessing` `EffectComposer` with 4x MSAA buffers (clamped to the device limit), a `RenderPass`, and one `EffectPass` containing `SpeedEffect`. `main.js` calls `postProcessing.render(deltaTime)` instead of `renderer.render()`; the composer disables `renderer.autoClear` and clears through the render pass.

- **Idle bypass:** when the speed-effect intensity is `0`, the effect pass is disabled and the render pass draws straight to the antialiased canvas. No offscreen buffer, blur pyramid, or fullscreen pass runs. The first frame always runs the full chain so the effect shader compiles before the first boost.
- **Intensity:** `main.js` passes the larger of the positive visual speed effect (`uAcceleration`, `0` during the debug pause) and the GUI `params.speedEffect`; `setSpeedEffect()` maps it through `smoothstep(0.1, 1)`, raised to at least `params.postProcessing.preview`.
- **Future passes:** add them to `PostProcessing`; keep the bypass condition in sync so a new always-on pass disables it.

### `SpeedEffect`

[`src/speedEffect.js`](../src/speedEffect.js) and [`speed-effect.glsl`](../src/shaders/speed-effect.glsl) combine an edge blur and radial chromatic aberration in one fullscreen effect.

- In `Effect.update()`, a private `BlurPyramidPass` downsamples the scene buffer into up to six half-resolution render targets with a 13-tap filter ([`blur-downsample-fragment.glsl`](../src/shaders/blur-downsample-fragment.glsl)). Only the levels reachable by the current maximum blur are rendered. The level targets inherit the composer frame-buffer type and sRGB storage.
- The effect converts each pixel's blur radius into a fractional level (`log2` of pixels) and blends the two nearest levels. Level `0` is the full-resolution input; higher levels use a four-tap cubic B-spline reconstruction to avoid bilinear blockiness.
- Chromatic aberration samples red outward, green in place, and blue inward along the direction from the center, all at the same blur level. It is skipped below half a pixel of dispersion. Pixels with neither effect return the input color without sampling.
- Each effect has `strength`, `start`, `end`, and `curve` in `params.postProcessing`. The mask is `intensity * pow(smoothstep(start, end, radius), curve)`. Radius is `length(vec2(x, y * verticalScale)) * √2`, measured from the viewport center in UV. It is `0` at the center and about `0.71` at the left and right edge midpoints, and never changes horizontally. `params.postProcessing.verticalScale` (default `0.5`, shared by both effects) scales only the vertical component: the top and bottom edge midpoints reach about `0.71 * verticalScale` and the corners reach `√(0.5 + 0.5 * verticalScale²)`. With `1` the falloff is circular (`1` at the corners), and with `0` the effect depends only on horizontal distance. Blur strength is a fraction of viewport height; aberration strength is a UV offset at the edges.
- `BLUR_LEVELS` in JavaScript must match the `blurLevel1`...`blurLevel6` samplers in GLSL.

## Day/Night Cycle

[`src/dayNight.js`](../src/dayNight.js) owns the sky dome and applies the cycle state. [`src/dayNightPolicy.js`](../src/dayNightPolicy.js) computes that state as pure data (sRGB triplets and scalars) without Three.js.

- **Time convention:** `params.dayNight.timeOfDay` is in `[0, 1)`: `0` midnight, `0.5` noon; on a flat horizon `0.25` is sunrise and `0.75` sunset. It advances by `deltaTime / cycleDuration` (default `240` seconds) unless `paused` is set. `?time=<0..1>` sets the starting value.
- **Curved horizon:** the terrain shader bends the world onto a sphere of radius `CURVATURE` (`3000`) centered below the plane (see [Curved-World Lighting](#curved-world-lighting)). From camera height `h` above sea level, the visible edge of the world sits `dip = acos(R / (R + h))` below the horizontal (about `0.21` rad at cruise height). `DayNight` recomputes the dip every frame from the camera's world Y, including the debug orbit camera. The **apparent elevation** `asin(direction.y) + dip` is the single reference for the sky gradient, disc visibility, palette timing, and light fades.
- **Palette time:** keyframes are authored for a flat horizon. `getPaletteTime()` computes the apparent sunrise and sunset (`0.25 ∓ δ`, `0.75 ± δ`, with `δ = asin(sin(dip) / cos(tilt)) / 2π`) and stretches that apparent day onto `[0.25, 0.75]` and the night onto the rest. The mapping is piecewise linear, continuous across midnight, monotonic, and the identity when `dip = 0`, so sunrise and sunset colors coincide with the sun meeting the curved edge at any altitude.
- **Keyframes:** `DAY_NIGHT_DEFAULTS.keyframes` interpolates zenith, horizon, sun and moon color and intensity, ambient color and intensity, the atmosphere ceiling, trail tint, star visibility, and a `night` factor with smoothstep blends that wrap across midnight. The `t = 0.8` dusk keyframe keeps the original static sky (fog `#191362`, linear atmosphere `(0.1, 0.015, 0.02)`), but with cool moonlight. At night the moon keyframes stay at full `params.moonLight`, and ambient light drops to `0.06` (midnight) to `0.15` (dusk) of `params.ambientLight`. The resulting direct-to-ambient ratio of about `13:1` keeps terrain relief readable under moonlight.
- **Celestial arc and lights:** the sun rises at +X, sets at -X, and is tilted `0.5` radians toward +Z; the moon is always opposite. Each body drives its own `DirectionalLight`, whose intensity fades in over apparent elevation `[-0.03, 0.05]` rad. In the twilight band where `|asin(y)| < dip`, both are lit, as seen from altitude. No light switches direction. No shadows are used; only the light position (direction) matters.
- **Sky dome:** a `SphereGeometry` of radius `5000` (inside the camera far plane) with a `ShaderMaterial` ([`sky.vert.glsl`](../src/shaders/sky.vert.glsl), [`sky.frag.glsl`](../src/shaders/sky.frag.glsl)), `BackSide`, no depth test or write, no fog, `renderOrder = -1`, and frustum culling disabled. It follows the camera's world position every frame. The gradient starts at the dipped horizon (`uHorizonDip = sin(dip)`) and keeps the horizon color below it, so fogged terrain and sky meet without a seam. It draws a sun disc (about `1.3°` radius) and halo, and a moon disc (about `0.9°` radius) and halo, both faded by apparent elevation; terrain hides them once they pass behind the curved edge. Hashed twinkling stars are drawn only while `uStarVisibility > 0`.
- **Per-frame writes:** fog color, background, sun and moon light colors, intensities and directions, ambient light, `uAtmosphere`, and the sky uniforms. Colors go through `Color.setRGB(..., SRGBColorSpace)`, and the state object and colors are reused without per-frame allocation.

## Shader Injection Pattern

Scene materials other than the sky dome do not use `ShaderMaterial`. They start with built-in Three.js materials and patch generated shaders through `material.onBeforeCompile`. The sky dome (unlit, fog-free) and the post-processing blur downsample are the only standalone `ShaderMaterial` instances.

| Rendered content          | JavaScript owner                    | Base material                      | Replacements                                                         |
| ------------------------- | ----------------------------------- | ---------------------------------- | -------------------------------------------------------------------- |
| Terrain and water surface | [`src/chunk.js`](../src/chunk.js)   | `MeshStandardMaterial`             | `common`, `project_vertex`, `color_fragment`, `normal_fragment_maps`, `lights_fragment_begin` |
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
- `uAtmosphere`: the day/night color ceiling that distant terrain, trees, and clouds are clamped toward (`min(uAtmosphere, color)`) before fog. It replaces the former hard-coded dark maroon.
- `wPosition`: world-space position passed from vertex to fragment stages.
- `distanceFromCamera`: distance used for curvature, scaling, atmospheric darkening, and fading.
- Shared `rotateZ()` and simplex-noise helpers.

The terrain geometry also provides a custom scalar `height` attribute. Its value is the raw procedural height, including underwater values that differ from the CPU-clamped visible vertex position. Position, normal, UV, height, and index arrays are generated in a worker, transferred, and wrapped in `BufferGeometry` on the main thread before rendering.

The plane trail uses dynamic world-space positions, a per-vertex `trailWidths` vector containing separate left and right widths, a `trailDistance` attribute recording distance traveled along the flight path, and a `trailBank` attribute recording the airplane's absolute roll at emission normalized against `PI / 4`. `Plane` updates these attributes every frame from recent flight poses; the mesh is attached to the scene rather than the airplane. Its default `9.6`-unit-wide ribbon uses `30` lengthwise segments. Actual speed above cruise and path curvature widen the stripes; the outer wing is wider in a turn. The turn contribution starts at normalized curvature `0.65` and caps at `0.75` width, while maximum boosted speed can reach `1`. The trail shader passes UV, both widths, traveled distance, and bank to the fragment stage. Each stripe tapers from zero at the wing, broadens near the middle, and tapers to zero at the tail. Its centerline offset mixes a traveled-distance sine wave with a smaller simplex-noise variation; a side-specific offset derived from UV gives the two stripes different patterns. Oscillation amplitude is multiplied by the recorded bank, so it is zero for level wings and reaches the GUI value at maximum roll; it also rises from zero at the wing to full strength about `21` world units behind it. Simplex noise in trail space roughens both boundaries. Its coordinate is the traveled distance along the path, scaled by `0.5`, plus a side offset. The pattern therefore stays attached to emitted sections and keeps the same frequency in turns and on any heading. Noise amplitude follows the square of the width taper so the edges become progressively smoother toward both ends. Fragments outside the white core and its narrower black outline are discarded. The white core and dark outline have full opacity above `2.5` projected pixels; below that width their opacity eases down to `0.65`, without a hard visibility cutoff.

`params.trails` in `main.js` is the live tuning source. Ribbon width controls the CPU geometry span and the shader's world-unit-to-UV conversion. Line width, border width, edge amplitudes, and oscillation amplitude are world units. Edge frequencies scale the trail-space noise coordinate, which is half the traveled distance; oscillation frequency is cycles per world unit traveled. The debug GUI (`?gui=1`) updates all nine values without recompiling the material. The stripe center starts at its ribbon-relative offset, can move inward when larger widths require clipping protection, and then receives the oscillation offset.

## Shader Paths

### Terrain

- [`project-vertex.glsl`](../src/shaders/project-vertex.glsl) applies water movement, distance-based curvature, and the final projection.
- [`color-fragment.glsl`](../src/shaders/color-fragment.glsl) keeps five elevation-based land bands and switches between their existing palette and a sand-to-dark-brown desert palette. A very-low-frequency signed simplex-noise sample in world XZ coordinates selects the desert biome below zero and the existing biome above zero; two denser samples fray the boundary at different scales. An antialiased black separator hides the hard palette transition on land only, leaving water colors and wave highlights independent.
- [`normal-fragment-map.glsl`](../src/shaders/normal-fragment-map.glsl) attenuates tangent-space normal-map strength with distance.
- [`curved-light-terminator.glsl`](../src/shaders/curved-light-terminator.glsl) is inserted into `lights_fragment_begin` (see below).

### Curved-World Lighting

The curvature in `project-vertex.glsl` moves vertices down by `R * (1 - cos(dist / R))` but used to leave normals flat, so distant terrain was lit as if the world were flat. Terrain now shades as the sphere it is drawn on:

- **Bent normal (vertex):** after the curvature distance is known, `objectNormal` is rotated about `cross(up, awayDirection)` by `dist / uCurvature`, the same angle the surface tilts away from `uCamera`. The result overwrites `vNormal`. Chunk meshes are only translated, so object-space normals are world-space and `normalMatrix` applies. The derivative-based normal-map TBN uses the already curved positions and stays consistent. The unperturbed sphere normal is passed in the terrain-only varying `vSphereNormal`, which is declared in the injected code rather than in `common.glsl`.
- **Terminator (fragment):** `chunk.js` builds a copy of Three.js's `lights_fragment_begin` with the terminator appended after the exact r186 line `getDirectionalLightInfo( directionalLight, directLight );`. For every directional light, `directLight.color` is scaled by `smoothstep(-0.02, 0.06, dot(directLight.direction, vSphereNormal))`. The sun or moon therefore contributes nothing where it is below that fragment's local horizon, even on slopes facing it. At sunset, distant terrain toward the sun stays lit while nearby terrain is already dark. `chunk.js` warns in the console if a Three.js upgrade removes the hook line.
- Ambient light is unaffected. The airplane, trails, and the dormant tree, cloud, and boat materials still use flat lighting; align them when those features return.

### Instanced Scenery

- [`project-instanced-vertex.glsl`](../src/shaders/project-instanced-vertex.glsl) applies instance transforms, tree movement, distance scaling, and curvature.
- [`project-vertex-clouds.glsl`](../src/shaders/project-vertex-clouds.glsl) applies instance transforms, distance scaling, and curvature for clouds.
- Tree and cloud fragment replacements apply snow/atmosphere coloring and different distance fade ranges.

### Boats And Trails

- [`project-vertex-boat.glsl`](../src/shaders/project-vertex-boat.glsl) transforms cloned boat meshes in world space and applies curvature around the moving reference point.
- [`project-vertex-plane.glsl`](../src/shaders/project-vertex-plane.glsl) preserves Three.js projection and forwards the trail attributes (UV, widths, traveled distance, bank).
- Trail cutout and color are assembled inline in `Plane.addTrails()` from UV, the stored width, and edge noise driven by traveled distance. Speed and curvature are captured per pose on the CPU rather than applied to the entire ribbon at render time.
- The trail's white core is multiplied by `uTrailTint`, which `Plane.setDayNight()` sets from the cycle's `trailTint` keyframes. The unlit ribbon turns pink at dawn (`[1, 0.62, 0.7]`) and orange at sunset (`[1, 0.6, 0.35]`), stays white by day, and turns blue at night (`[0.45, 0.6, 1]`). The tints stay bright so the trail remains readable against the sky. The dark outline is unaffected.

## Uniform Update Timing

- `main.js` updates `uTime` and `uCamera` once per frame after `plane.update()` and before rendering.
- `main.js` creates `uAtmosphere` in the shared uniform object; `DayNight` writes it in its constructor (before the first compile) and on every frame after `uCamera`.
- `main.js` creates `uCurvature` in the shared uniform object from `CURVATURE` in `src/chunk.js`, the same constant used by the CPU curvature helper. Do not recreate it per chunk: materials that compile before the first chunk exists read it immediately.
- Biome colors are initialized from `params.colors`; the disabled GUI can mutate them.
- `Plane.update()` writes `uAcceleration` and updates the trail buffer before the frame renders.
- `Plane.updateTrails()` calls `recordTrailPose()`, which pushes the current pose into the history, and then `refreshTrails()`, which copies `params.trails` into stable trail-uniform wrappers and rebuilds the ribbon from the history. Changing a GUI slider affects already emitted sections as well as new ones. During the debug flight pause only `refreshTrails()` runs, so tuning stays live without extending the trail.
- `main.js` passes `max(uAcceleration, params.speedEffect)` to `PostProcessing.setSpeedEffect()` immediately before `PostProcessing.render()`.
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
7. For post-processing changes, hold the effect with `?gui=1` and the top-level **speedEffect** slider (same smoothstep mapping as a real boost) or **Speed effect > preview** (raw intensity), and check the center, edges, and corners, and that the idle bypass returns (`getPostProcessingStats().active === false`).
8. Move far enough to exercise distance fades, curvature, new chunks, and multiple LODs.
9. Repeat at a narrow/mobile viewport because geometry density and camera settings differ.

## Open Questions

- Should shader contracts receive automated compile checks against the installed Three.js version?
- Should module-level materials be replaced with explicitly owned or cached variants?
- Should curvature and atmosphere calculations share one documented distance convention? The atmosphere color is now tied to the day/night cycle, but its distance ranges (`700`→`200` terrain, different ranges for trees and clouds) remain independent of the fog range.
- Should the renderer adopt tone mapping? Bright daytime water and sky currently saturate without it.
- What visual baseline should be used for regression screenshots?
