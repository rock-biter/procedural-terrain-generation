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
- An ambient light and two directional lights (sun and moon) are driven by the day/night cycle. `params.ambientLight`, `params.directionalLight` (sun), and `params.moonLight` (default `1.2`) are peak intensities that the cycle scales every frame. All three are sliders in the **Lights** GUI folder.
- Tone mapping defaults to `NoToneMapping` with sRGB output. `params.toneMapping.mode` (a `THREE.*ToneMapping` constant) and `params.toneMapping.exposure` (default `1`) are applied to `renderer.toneMapping` and `renderer.toneMappingExposure` before `PostProcessing` is created. The **Tone mapping** GUI folder switches between None, Linear, Reinhard, Cineon, ACES Filmic, AgX, and Neutral and sets **Exposure** (`0`–`4`; Three.js ignores it with None). A mode change calls `PostProcessing.updateToneMapping()`; Three.js recompiles the affected materials on their next draw. Only materials that include `<tonemapping_fragment>` are tone mapped: the built-in scene materials and the sky dome, not the film-grain overlay.
- The camera is attached to `Plane`, so its transform is relative to the moving player object.

Resize changes the camera aspect, projection matrix, capped pixel ratio, and then the post-processing composer, which resizes the renderer and its buffers to the drawing-buffer size. The pixel ratio must be set before `PostProcessing.setSize()`.

## Post-Processing Pipeline

[`src/postProcessing.js`](../src/postProcessing.js) owns a `postprocessing` `EffectComposer` with 2x MSAA buffers (clamped to the device limit), a `RenderPass`, and one `EffectPass` containing `SpeedEffect`. `main.js` calls `postProcessing.render(deltaTime)` instead of `renderer.render()`; the composer disables `renderer.autoClear` and clears through the render pass.

- **Idle bypass:** when the speed-effect intensity is `0`, the effect pass is disabled and the render pass draws straight to the antialiased canvas. No offscreen buffer, blur pyramid, or fullscreen pass runs. The first frame always runs the full chain so the effect shader compiles before the first boost.
- **Tone mapping:** Three.js tone maps only draws to the canvas, so the idle path uses the renderer operator directly, while the composer's offscreen render pass writes untone-mapped linear color. When `renderer.toneMapping` is not `NoToneMapping`, the `EffectPass` also holds a `postprocessing` `ToneMappingEffect` after `SpeedEffect`, with the matching mode (`TONE_MAPPING_MODES`) and the renderer exposure, and the composer buffers are `HalfFloatType` so values above `1` survive until tone mapping. With `NoToneMapping` the buffers stay 8-bit sRGB, keeping the MSAA resolve at half the bandwidth. Passes cannot change frame-buffer type after initialization, so switching between None and a tone-mapped mode disposes and rebuilds the composer, render pass, `SpeedEffect`, and effect pass (`createComposer()`); switching between two tone-mapped modes only changes the effect mode. Both cases rerun the warm-up frame. `getPostProcessingStats()` reports `toneMapping`, `toneMappingExposure`, and `frameBufferType`.
- **Film grain:** after the composer, `PostProcessing.renderGrain()` draws one fullscreen quad straight onto the canvas ([`film-grain-fragment.glsl`](../src/shaders/film-grain-fragment.glsl)). It is not a composer pass, so the idle bypass keeps working.
  - The grain is static: a per-pixel hash of `gl_FragCoord` with no time input, so the pattern stays fixed on screen.
  - It blends as `2 × src × dst`, which scales each canvas pixel by a factor in `[1 − intensity, 1 + intensity]`.
  - `params.postProcessing.grain.intensity` (default `0.025`) is read every frame; `0` skips the pass.
  - The grain has no texture reads and no offscreen target.
- **MSAA cost:** without `WEBGL_multisampled_render_to_texture` (absent in desktop Chrome on Apple M1), the composer writes its whole multisampled scene target to memory and resolves it with a blit, while the canvas MSAA of the idle path is almost free. This is the largest cost of the active effect, larger than blur and aberration together (see `FEAT-001` in [Roadmap](ROADMAP.md)). The composer therefore uses 2x MSAA, so edges are slightly less smooth only while the effect is active.
- **Intensity:** `main.js` passes the larger of the positive visual speed effect (`uAcceleration`, `0` during the debug pause) and the GUI `params.speedEffect`; `setSpeedEffect()` maps it through `smoothstep(0.1, 1)`, raised to at least `params.postProcessing.preview`.
- **Future passes:** add them to `PostProcessing`; keep the bypass condition in sync so a new always-on pass disables it.

### `SpeedEffect`

[`src/speedEffect.js`](../src/speedEffect.js) and [`speed-effect.glsl`](../src/shaders/speed-effect.glsl) combine an edge blur and radial chromatic aberration in one fullscreen effect.

- In `Effect.update()`, a private `BlurPyramidPass` downsamples the scene buffer into up to four successively half-resolution render targets (level 1 at half resolution) with a 5-tap dual filter ([`blur-downsample-fragment.glsl`](../src/shaders/blur-downsample-fragment.glsl)): a bilinear center tap weighted `4/8` and four diagonal bilinear taps one source texel away weighted `1/8` each, a tent over about 4x4 source texels. Only the levels reachable by the current maximum blur are rendered. Four levels cap the blur at about `16` pixels: wherever `strength * mask * height` exceeds that, the blur saturates instead of growing. The level-1 pass reads the full-resolution buffer and is about three quarters of the pyramid cost; the capped levels were below 2%. The level targets inherit the composer frame-buffer type and, for 8-bit buffers, sRGB storage.
- Each pixel's blur radius becomes a fractional level `lod = log2(pixels)`; level `k` blurs by about `2^k` pixels and level `0` is the full-resolution input. A private `BlurUpsamplePass` then folds the pyramid back up from the coarsest rendered level to level `1`, at each level's resolution: `U(k) = mix(D(k), U(k + 1), clamp(lod - k, 0, 1))`, where the coarsest `U` is its downsample `D` ([`blur-upsample-fragment.glsl`](../src/shaders/blur-upsample-fragment.glsl)). Each pixel therefore blends its two nearest levels before full resolution, and a `lod` above the rendered levels saturates at the coarsest one.
- The full-resolution composite reads only `U(1)` (the `blurBuffer` uniform, or `D(1)` when a single level is rendered) and mixes it with the sharp input by `clamp(lod, 0, 1)`. Upsampled levels and the composite use a four-tap cubic B-spline reconstruction ([`bspline.glsl`](../src/shaders/bspline.glsl)) to avoid bilinear blockiness, so each blurred channel costs 4 taps, plus the input where `lod < 1`.
- Chromatic aberration samples red outward, green in place, and blue inward along the direction from the center, all at the same blur level, with the same B-spline reconstruction: at most 12 blur taps per aberrated pixel instead of the 24 of a two-level blend in the composite. It is skipped below half a pixel of dispersion. Pixels with neither effect return the input color without sampling.
- Each effect has `strength`, `start`, `end`, and `curve` in `params.postProcessing`. The mask is `intensity * pow(smoothstep(start, end, radius), curve)`. Radius is `length(vec2(x, y * verticalScale)) * √2`, measured from the viewport center in UV. It is `0` at the center and about `0.71` at the left and right edge midpoints, and never changes horizontally. `params.postProcessing.verticalScale` (default `0.78`, shared by both effects) scales only the vertical component: the top and bottom edge midpoints reach about `0.71 * verticalScale` and the corners reach `√(0.5 + 0.5 * verticalScale²)`. With `1` the falloff is circular (`1` at the corners), and with `0` the effect depends only on horizontal distance. Blur strength is a fraction of viewport height; aberration strength is a UV offset at the edges.
- The radius, mask, and `lod` live in [`speed-effect-mask.glsl`](../src/shaders/speed-effect-mask.glsl), included by the composite and the upsample shader through `vite-plugin-glsl`. Both passes share the same `intensity`, `blurParams`, and `verticalScale` `Uniform` objects, so they always agree on each pixel's level. `BLUR_LEVELS` exists only in JavaScript; the shaders have no per-level samplers.

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

Scene materials other than the sky dome do not use `ShaderMaterial`. They start with built-in Three.js materials and patch generated shaders through `material.onBeforeCompile`. The sky dome (unlit, fog-free), the post-processing blur downsample and upsample, and the two transient impostor bake passes are the only standalone `ShaderMaterial` instances.

| Rendered content          | JavaScript owner                    | Base material                      | Replacements                                                         |
| ------------------------- | ----------------------------------- | ---------------------------------- | -------------------------------------------------------------------- |
| Terrain and water surface | [`src/chunk.js`](../src/chunk.js)   | `MeshStandardMaterial`             | `common` (fragment also gets `terrain-normal-pars.glsl`), `project_vertex`, `color_fragment`, `normal_fragment_maps`, `lights_fragment_begin` |
| Boats                     | [`src/chunk.js`](../src/chunk.js)   | Materials from the glTF model      | `common`, `project_vertex`                                           |
| Scenery impostors         | [`src/impostors/impostorMaterial.js`](../src/impostors/impostorMaterial.js) | `MeshStandardMaterial` (`alphaTest`, `alphaToCoverage`) | `common`, `project_vertex`, `color_fragment`, `normal_fragment_begin`, `lights_fragment_begin` |
| Clouds                    | [`src/clouds.js`](../src/clouds.js) | Transparent `MeshStandardMaterial` | `common`, `project_vertex`, `color_fragment`, `normal_fragment_maps` |
| Plane trails              | [`src/plane.js`](../src/plane.js)   | Transparent `MeshBasicMaterial`    | `common`, `project_vertex`, `color_fragment`                         |

Each replacement string must match the corresponding Three.js shader include exactly. A Three.js upgrade can rename or reorganize those includes while the JavaScript build still succeeds.

The cloud and boat shader paths are currently dormant because their `worldFeatures` flags are disabled in `main.js`.

## Shared GLSL Contract

[`src/shaders/common.glsl`](../src/shaders/common.glsl) retains Three.js's original `#include <common>` and adds:

- `uTime`: elapsed render time.
- `uCamera`: the plane's world position, used as the visual reference point.
- `uCurvature`: radius used by the curved-world projection.
- `uGrass`, `uLand`, and `uRocks`: terrain biome colors.
- `uBiomeOffset`: seeded world offset of the biome field, from `createBiomeOffset()` in [`src/biome.js`](../src/biome.js). The CPU placement code applies the same offset.
- `uAtmosphere`: the day/night color ceiling that distant terrain, scenery, and clouds are clamped toward (`min(uAtmosphere, color)`) before fog. It replaces the former hard-coded dark maroon.
- `wPosition`: world-space position passed from vertex to fragment stages.
- `distanceFromCamera`: distance used for curvature, scaling, atmospheric darkening, and fading.
- Shared `rotateZ()`, `rotateAroundAxis()` (Rodrigues rotation used for bent normals), and simplex-noise helpers.

The terrain geometry also provides a custom scalar `height` attribute. Its value is the raw procedural height, including underwater values that differ from the CPU-clamped visible vertex position. Position, normal, UV, height, and index arrays are generated in a worker, transferred, and wrapped in `BufferGeometry` on the main thread before rendering.

The plane trail uses dynamic world-space positions, a per-vertex `trailWidths` vector containing separate left and right widths, a `trailDistance` attribute recording distance traveled along the flight path, and a `trailBank` attribute recording the airplane's absolute roll at emission normalized against `PI / 4`. `Plane` updates these attributes every frame from recent flight poses; the mesh is attached to the scene rather than the airplane. Its default `9.6`-unit-wide ribbon uses `30` lengthwise segments. Actual speed above cruise and path curvature widen the stripes; the outer wing is wider in a turn. The turn contribution starts at normalized curvature `0.65` and caps at `0.75` width, while maximum boosted speed can reach `1`. The trail shader passes UV, both widths, traveled distance, and bank to the fragment stage. Each stripe tapers from zero at the wing, broadens near the middle, and tapers to zero at the tail. Its centerline offset mixes a traveled-distance sine wave with a smaller simplex-noise variation; a side-specific offset derived from UV gives the two stripes different patterns. Oscillation amplitude is multiplied by the recorded bank, so it is zero for level wings and reaches the GUI value at maximum roll; it also rises from zero at the wing to full strength about `21` world units behind it. Simplex noise in trail space roughens both boundaries. Its coordinate is the traveled distance along the path, scaled by `0.5`, plus a side offset. The pattern therefore stays attached to emitted sections and keeps the same frequency in turns and on any heading. Noise amplitude follows the square of the width taper so the edges become progressively smoother toward both ends. Fragments outside the white core and its narrower black outline are discarded. The white core and dark outline have full opacity above `2.5` projected pixels; below that width their opacity eases down to `0.65`, without a hard visibility cutoff.

`params.trails` in `main.js` is the live tuning source. Ribbon width controls the CPU geometry span and the shader's world-unit-to-UV conversion. Line width, border width, edge amplitudes, and oscillation amplitude are world units. Edge frequencies scale the trail-space noise coordinate, which is half the traveled distance; oscillation frequency is cycles per world unit traveled. The debug GUI (`?gui=1`) updates all nine values without recompiling the material. The stripe center starts at its ribbon-relative offset, can move inward when larger widths require clipping protection, and then receives the oscillation offset.

## Shader Paths

### Terrain

- [`project-vertex.glsl`](../src/shaders/project-vertex.glsl) applies water movement, distance-based curvature, and the final projection.
- [`color-fragment.glsl`](../src/shaders/color-fragment.glsl) keeps five elevation-based land bands and switches between their existing palette and a sand-to-dark-brown desert palette. A very-low-frequency signed simplex-noise sample in world XZ coordinates (frequency `0.000175`, halved to make biomes larger), shifted by `uBiomeOffset`, selects the desert biome below zero and the existing biome above zero; two denser samples fray the boundary at different scales. The formula lives in `getBiomeValue()` in [`common.glsl`](../src/shaders/common.glsl). An antialiased black separator hides the hard palette transition on land only, leaving water colors and wave highlights independent. The separator has a constant world-space width (`BIOME_LINE_HALF_WIDTH`, `0.6` units on each side), so it keeps its size on the ground at any distance from the plane: the shader divides `|biomeValue|` by the field gradient, measured with world-space forward differences (`BIOME_GRADIENT_STEP`). The gradient costs six extra simplex samples, so it only runs where `|biomeValue|` is below `BIOME_LINE_HALF_WIDTH * BIOME_MAX_GRADIENT` plus one pixel of `fwidth()`. `BIOME_MAX_GRADIENT` (`0.014`) must stay above the steepest slope of the field. `fwidth()` only sets the antialiasing edge, so far away the line becomes thinner than a pixel and fades. `getBiomeValue()` in `src/biome.js` is the exact CPU twin of this formula; change both together.
- `color-fragment.glsl` also writes `terrainBand`, the layer index read by the normal map: `0` sea (height at or below `0.1`), then `1` sand, `2` grass, `3` land, `4` rocks, `5` snow. It uses the same noisy thresholds and priority as the color bands, so both biomes share the five land layers.
- [`normal-fragment-map.glsl`](../src/shaders/normal-fragment-map.glsl) samples the layer's normal map through `sampleTerrainNormal()` from [`terrain-normal-pars.glsl`](../src/shaders/terrain-normal-pars.glsl). The UV is world `(x, -z)`, rotated by minus the layer rotation and divided by its tile size, so tiles continue across chunks and LODs. After strength is applied, the sampled XY is rotated back by the same angle, so the relief stays lit correctly in the unrotated tangent frame. The V axis runs along `-Z` like the chunk UV, so Three's tangent frame, built from `vNormalMapUv`, still matches. Only the selected layer is fetched. `textureGrad()` takes gradients computed outside the branch, because GLSL ES 3.00 only indexes sampler arrays with constants and derivatives are undefined in non-uniform branches. Strength is then faded with distance from `uCamera` between `uTerrainNormalFade.x` and `.y`: by default full within `50` units and gone beyond `300` (`TERRAIN_NORMAL_FADE`). A fade that reaches too far can let the fine fabric patterns alias into moiré at mid distance; an early `400`-unit fade with the original repeat did.
- [`curved-light-terminator.glsl`](../src/shaders/curved-light-terminator.glsl) is inserted into `lights_fragment_begin` (see below).

### Curved-World Lighting

The curvature in `project-vertex.glsl` moves vertices down by `R * (1 - cos(dist / R))` but used to leave normals flat, so distant terrain was lit as if the world were flat. Terrain now shades as the sphere it is drawn on:

- **Bent normal (vertex):** after the curvature distance is known, `objectNormal` is rotated about `cross(up, awayDirection)` by `dist / uCurvature`, the same angle the surface tilts away from `uCamera`. The result overwrites `vNormal`. Chunk meshes are only translated, so object-space normals are world-space and `normalMatrix` applies. The derivative-based normal-map TBN uses the already curved positions and stays consistent. The unperturbed sphere normal is passed in the terrain-only varying `vSphereNormal`, which is declared in the injected code rather than in `common.glsl`.
- **Terminator (fragment):** [`src/curvedLights.js`](../src/curvedLights.js) builds a copy of Three.js's `lights_fragment_begin` with the terminator appended after the exact r186 line `getDirectionalLightInfo( directionalLight, directLight );`. For every directional light, `directLight.color` is scaled by `smoothstep(-0.02, 0.06, dot(directLight.direction, vSphereNormal))`. The sun or moon therefore contributes nothing where it is below that fragment's local horizon, even on slopes facing it. At sunset, distant terrain toward the sun stays lit while nearby terrain is already dark. `curvedLights.js` warns in the console if a Three.js upgrade removes the hook line. Terrain and scenery impostors both use this copy; each provides its own view-space `vSphereNormal`.
- Ambient light is unaffected. Scenery impostors bend their baked normals and use the terminator like terrain. The airplane, trails, and the dormant cloud and boat materials still use flat lighting; align them when those features return.

### Impostor Scenery

Trees, cacti, and rocks are octahedral impostors: each instance is one camera-facing quad (2 triangles), shaded from baked color and normal images.

- **Sources:** [`src/impostors/impostorArchetypes.js`](../src/impostors/impostorArchetypes.js) builds the six types from Three.js primitives. They are merged, smooth-shaded, lightly noise-deformed, and carry vertex colors with a baked vertical occlusion. Colors come from `COLORS` in that file; all scenery has a wooden-toy palette: light brown round-tree crowns (`leaves`), darker brown conifers (`needles`) and cacti (`cactus`, same color) over a dark brown trunk, and the lightest woods for boulders and the alternating bands of layered rocks (`boulder`, `rockLight`, `rockDark`). Bounding spheres are recentered on the Y axis so yaw rotates around the base. These meshes exist only during the bake, so their vertex counts have no runtime cost.
- **Types:** the type indices, atlas layout, and instance stride live in [`src/impostors/impostorTypes.js`](../src/impostors/impostorTypes.js).
- **Bake:** [`src/impostors/impostorBaker.js`](../src/impostors/impostorBaker.js) runs in `init()`, before chunks exist, and again when a **Scenery > Wood detail** control is released. `setImpostorAtlas()` swaps the new atlas into the shared material's uniforms and disposes the old one without recompiling.
  - It renders every type from a grid of `frames × frames` hemi-octahedral directions (see [`src/impostors/octahedral.js`](../src/impostors/octahedral.js)) with an orthographic camera framed on the bounding sphere plus a `4%` margin.
  - `main.js` passes `IMPOSTOR_FRAMES_DESKTOP` (`16`, 256 views per type) or `IMPOSTOR_FRAMES_MOBILE` (`12`, 144 views). The count must be even. The atlas records it, and the material turns it into the `IMPOSTOR_FRAMES` define, so the bake and the shader always agree.
  - **Wood detail:** with a `detail` texture (`USE_DETAIL`), the bake fragment shader ([`impostor-bake-fragment.glsl`](../src/shaders/impostor-bake-fragment.glsl)) samples the color of [`olive_veneer_diff_1k.jpg`](../src/textures/olive_veneer/olive_veneer_diff_1k.jpg) triplanarly in object space. The texture is loaded as sRGB, so samples are linear.
    - The texture grain runs along U, so the side projections (`yz`, `yx`) map U to height and keep the grain vertical.
    - It multiplies the part's vertex color by `mix(1, texture, color)`, as Three.js combines `map` and `vertexColors`, so the parts keep their relative palette and darken by the texture's color. The normal is not perturbed.
    - `params.impostorDetail` defaults to `scale 0.18` repeats per unit and `color 1`.
    - The detail is baked, so it costs nothing per frame and rotates and scales with each instance. Its finest visible scale is limited by the `64` px frames.
  - It renders one type at a time into a `2×` supersampled MRT target (`count: 2`) the size of one type block: at most `2048` px, which stays inside mobile texture limits. The target holds sRGB-encoded albedo with coverage in alpha, and object-space normal with normalized depth in alpha. Depth is currently unused.
  - A resolve pass writes that type's block of the atlas (`uBlockOrigin`). It box-downsamples to fractional coverage and dilates the color and normal of the nearest covered texel into empty texels of the same frame, so bilinear filtering and mipmaps do not pull in dark halos.
  - The result is two mipmapped RGBA8 atlases, laid out as `3 × 2` type blocks of `64` px frames:
    - desktop: `3072 × 2048`, about `67` MB with mips;
    - mobile: `2304 × 1536`, about `38` MB with mips.
  - In headless SwiftShader the `16 × 16` bake takes about `0.2` to `0.35` s.
- **Vertex (`impostor-vertex.glsl`, replacing `project_vertex`):**
  1. Reads per-instance `aInstanceA` (chunk-local base, scale) and `aInstanceB` (yaw, type, packed tint, stretch).
  2. Applies the terrain curvature at the base, and places the bounding-sphere center along the bent sphere normal.
  3. Builds the quad on the camera's right and up axes.
  4. Converts the camera and each vertex into the baked local frame by undoing the bend, yaw, scale, and stretch.
  5. Picks the three frames around the view direction with barycentric weights, the same triangle blend as `getFrameBlend()`. Each frame UV comes from intersecting the view ray with that frame's image plane.
  6. Scales instances to zero between `950` and `800` units from `uCamera`, inside the fog.
  7. Multiplies the tint by a position-based brightness variation: two octaves of `snoise` at the flat world base, scaled by `uImpostorVariationFrequency` (default `0.01`). The noise is stretched by `1.6` and clamped to `±1`. The tint is multiplied by `exp2(noise × uImpostorVariationAmount[type])`, so the amount is in stops, one float per type. The default `0.8` spans about `×0.57` to `×1.74`, and the GUI allows up to `2`. Neighbouring instances share a shade while distant groups differ, on top of the per-instance random tint from placement. The uniforms live in `main.js` (`params.impostorVariation`) and update live, with no placement job.
- **Fragment:**
  - `impostor-color-fragment.glsl` blends the three frames weighted by coverage, decodes sRGB, and multiplies by the instance tint. It then applies the `uAtmosphere` clamp (`700`→`400`).
  - `IMPOSTOR_SINGLE_FRAME`, set on mobile, samples only the dominant frame.
  - Coverage goes to `diffuseColor.a`, and Three.js's `alphatest_fragment` turns it into MSAA coverage (`alphaToCoverage`, threshold `0.5`).
  - `impostor-normal-fragment.glsl` replaces `normal_fragment_begin`. It rebuilds the view-space normal from the baked normal through the per-instance yaw, stretch, and bend basis.
- **GLSL twins:** [`impostor-octahedral.glsl`](../src/shaders/impostor-octahedral.glsl) mirrors `octahedral.js`. Keep the frame basis identical to the baker, which uses `camera.lookAt()` with world up.
- **Known limits:**
  - The quad is flat, so a large instance on a steep slope can be partially hidden by terrain in front of its center.
  - Adjacent frames can ghost slightly where silhouettes differ.
  - Distant mips lose coverage on thin parts.
  - The baked depth channel is kept for a possible `gl_FragDepth` correction.

### Clouds (Dormant)

- [`project-vertex-clouds.glsl`](../src/shaders/project-vertex-clouds.glsl) applies instance transforms, distance scaling, and curvature for clouds.
- The cloud fragment replacement applies atmosphere coloring and its own distance fade range.

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
- `uBiomeOffset` is set once from the world seed and never changes at runtime.
- `uTerrainNormalFade` holds the fade start and end distances from `params.terrainNormals.fade`; `updateTerrainNormalUniforms()` keeps the end at least `1` unit past the start, because `smoothstep()` is undefined otherwise.
- `uTerrainNormalMaps`, `uTerrainNormalScale`, `uTerrainNormalStrength`, and `uTerrainNormalRotation` (the `(cos, sin)` of each layer's rotation, computed on the CPU) are arrays indexed by `TERRAIN_BANDS` in [`src/terrainNormals.js`](../src/terrainNormals.js). `main.js` adds them to the shared uniform object from `params.terrainNormals`. The **Terrain > Normal maps** GUI calls `updateTerrainNormalUniforms()`, which writes the values in place. `uTerrainNormalStrength` is a `vec2` per layer, and its Y includes the texture's `invertGreen` sign.
- The impostor material adds its own atlas uniforms (`uImpostorAlbedo`, `uImpostorNormal`, and `uImpostorTypes` with per-type frame radius and center height) next to the shared uniforms at compile time.
- `Plane.update()` writes `uAcceleration` and updates the trail buffer before the frame renders.
- `Plane.updateTrails()` calls `recordTrailPose()`, which pushes the current pose into the history, and then `refreshTrails()`, which copies `params.trails` into stable trail-uniform wrappers and rebuilds the ribbon from the history. Changing a GUI slider affects already emitted sections as well as new ones. During the debug flight pause only `refreshTrails()` runs, so tuning stays live without extending the trail.
- `main.js` passes `max(uAcceleration, params.speedEffect)` to `PostProcessing.setSpeedEffect()` immediately before `PostProcessing.render()`.
- Shader callbacks merge custom uniform entries with Three.js-generated uniforms at compilation time.

Do not replace the shared uniform wrapper objects each frame. Update their `.value` fields so compiled materials retain the same references.

## Materials And Textures

- Terrain assigns one normal map per layer in `TERRAIN_NORMAL_LAYERS` ([`src/terrainNormals.js`](../src/terrainNormals.js)). Each entry has a `texture` (a `TERRAIN_NORMAL_TEXTURES` key), a `scale` (tile size in world units), a `strength`, and a `rotation` in degrees, counter-clockwise seen from above. The default rotations are arbitrary hard-coded values (`23`, `71`, `137`, `204`, `256`, `318` from sea to snow). Consecutive layers differ by at least `15°`, even modulo `90°`, so the patterns of neighbouring bands never line up; keep that gap when changing them. The sea keeps `normal.jpg` with its former tile of `256 / 12` units and strength `2`, with the green channel inverted, now rotated like the other layers. The five land bands use the fabric maps (hessian, ribbed corduroy, waffle piqué, dirty carpet, fabric pattern), assigned arbitrarily, with a `12`-unit tile and strength `1`. Swap the `texture` keys to reassign them.
- The material's `normalMap` is the sea layer's texture. It only enables Three's tangent-space path; the terrain shader samples `uTerrainNormalMaps` instead, and `normalScale` is unused.
- When enabled, clouds receive the sea layer's normal map after construction.
- Terrain and cloud materials are module-level shared instances. Their shader hooks and mutable properties therefore affect every instance using that material.
- The impostor material is created once in `init()` and shared through `assets.impostorMaterial`. It owns the atlas render target. Chunks dispose only their own scenery geometry.
- Boats originate from cloned glTF scene nodes; verify whether geometry and material resources remain shared before disposing or mutating them.

See [Assets](ASSETS.md) for load paths, transforms, and licensing.

## Safe Change Checklist

1. Identify every JavaScript owner that injects the edited GLSL file.
2. Confirm required uniforms, varyings, and attributes are declared in both shader stages that use them.
3. Preserve the original Three.js include when the replacement depends on built-in declarations or behavior.
4. Run `pnpm build` to validate imports and bundling.
5. Load the scene and check the browser console for shader compile or link errors.
6. Inspect terrain, water, scenery impostors, clouds, boats, and trails as applicable.
7. For post-processing changes, hold the effect with `?gui=1` and the **Speed effect > speedEffect** slider (same smoothstep mapping as a real boost) or **Speed effect > preview** (raw intensity), and check the center, edges, and corners, and that the idle bypass returns (`getPostProcessingStats().active === false`).
8. Move far enough to exercise distance fades, curvature, new chunks, and multiple LODs.
9. Repeat at a narrow/mobile viewport because geometry density and camera settings differ.

## Open Questions

- Should shader contracts receive automated compile checks against the installed Three.js version?
- Should module-level materials be replaced with explicitly owned or cached variants?
- Should curvature and atmosphere calculations share one documented distance convention? The atmosphere color is now tied to the day/night cycle, but its distance ranges (`700`→`200` terrain, `700`→`400` impostors, a different range for clouds) remain independent of the fog range.
- Which tone mapping operator and exposure should become the default? Tone mapping is selectable in the GUI but still defaults to `NoToneMapping`, so bright daytime water and sky saturate, and the light and palette intensities were tuned without it.
- What visual baseline should be used for regression screenshots?
