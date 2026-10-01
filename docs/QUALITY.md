# Quality And Validation

## Purpose

This document defines the current verification baseline and the manual checks expected for each change category. It describes existing capabilities separately from future automation.

## Current Baseline

| Capability              | Current state                           |
| ----------------------- | --------------------------------------- |
| Production build        | `pnpm build`                            |
| Automated tests         | `pnpm test` with Node's built-in runner |
| Linting                 | Not configured                          |
| Formatting              | Not configured                          |
| Static type checking    | Not configured                          |
| Continuous integration  | Not configured                          |
| Visual regression tests | Not configured                          |
| Performance benchmark   | Not configured                          |

A successful Vite build proves that modules and assets can be bundled. It does not prove that WebGL shaders compile, the scene is nonblank, assets load in the browser, or controls work.

## Required Checks By Change

| Change area                    | Minimum checks                                                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Documentation only             | Resolve Markdown links, run `git diff --check`, and inspect the rendered structure where practical.                                 |
| JavaScript or configuration    | Run `pnpm test` and `pnpm build`; load the app; check console and failed network requests.                                          |
| Terrain or chunk streaming     | Run tests and build; traverse multiple chunks and LODs; inspect bounded stats, seams, stalls, and lifecycle on desktop and mobile.  |
| GLSL, materials, or Three.js   | Build; inspect browser shader errors; visually check every affected material near and far from the plane.                           |
| UI, controls, camera, or audio | Build; complete the manual experience smoke test below with mouse and narrow/touch emulation as applicable.                         |
| Assets                         | Build; reload without cache; verify progress completion, network requests, transforms, materials, and attribution files.            |
| Dependencies                   | Update `package.json` and `pnpm-lock.yaml` together; build; run affected browser checks; review migration notes for major versions. |

Run narrower checks first when a task introduces them, but do not skip the production build for source, shader, dependency, or configuration changes.

The test suite covers symmetric desktop/mobile desired sets, negative centers, the current LOD rule, heading sectors with hysteresis and wrapping, heading-biased sets that reach farther ahead than behind and always contain the current chunk and its neighbours, LOD rings shifted forward with a radial rear, forward-first priority, the radial scenery range, deterministic terrain buffers, topology counts, sea clamping, adjacent chunk-edge heights, identical edge normals between neighboring chunks and across LODs, unit upward-facing normals, the scenery LOD rule, the seeded biome field and simplex port, hemi-octahedral encode/decode, frame bases, and three-frame blend weights, the near-scenery-mesh fade, disabled range, selection radius, chunk pre-filter, per-type selection, and reusable buffer growth, deterministic scenery placement with unique per-chunk ownership, per-category density and per-type size isolation, the deterministic per-chunk cap, no instances on water, beaches, or snow, biome-correct scenery types, and tint packing, signed speed effects, vertical-input bands, topography-based safety-climb scaling, four-point terrain flight corridors, fixed clearance, collision-gated terrain slowdown and brake impulses, stable descent constraints at minimum altitude, asymmetric minimum-altitude smoothing, and world-space trail history interpolation including traveled distance, width response to speed and curvature, normalized bank, turns, and bounded retention, plus the `debug=1` flag and the P-shortcut filter (repeat, modifiers, editable targets), and the day/night policy: time wrapping, unit and opposite celestial directions, ordered keyframes, continuity across midnight, horizon dip from height, apparent elevation, palette-time identity on a flat horizon, alignment with the dipped sunrise and sunset, continuity and monotonicity, sun and moon lighting only above the apparent horizon (both lit in the curved twilight band), output-state reuse, and `?time=` parsing.

Browser lifecycle checks can read `window.__INFINITE_WORLD__.getChunkStats()`, which also reports `headingSector`, `sceneryChunks`, and `sceneryInstances`. For streaming changes, also hold a turn: `headingSector` should step through all eight sectors, and the queue should drain after each step with `stale` staying low. Climb to the maximum altitude and check that no LOD seam is visible ahead. After the queue drains, `live` must equal `desired`, `pending`, `queued`, and `inFlight` must return to zero, `created - disposed` must equal `live`, `generated` must be at least `created`, and `failed` must remain zero. Desktop should report up to two workers; mobile reports one.

Flight checks can read `window.__INFINITE_WORLD__.getFlightStats()`. Use `pointerYRatio`, `verticalInput`, position Y, speed, manual/visual speed effects, camera FOV/Z, corridor limits, minimum-altitude jump, terrain-brake impulse/effect, and target/effective terrain slowdown to distinguish actual flight changes from camera motion.

## Manual Experience Smoke Test

Use a fresh page load and check:

1. The loader appears, progresses, and disappears.
2. The canvas renders nonblank terrain with no console errors or failed requests.
3. The play action starts movement and soundtrack playback.
4. Pointer movement turns and rolls the airplane; above `45%` it climbs, from `45%` through `65%` it settles at the reached altitude, and below `65%` it descends. Repeat with touch in a mobile viewport.
5. Scrolling down produces temporary acceleration, camera movement, FOV expansion, wider trails, and an edge blur with chromatic aberration that leaves the center sharp. At cruise speed, make a moderate turn and confirm no trail appears, then turn sharply in both directions and confirm both trails follow the wing tips, the outer wing's trail is wider, and turn-only width remains below the full-boost width. At maximum boost the trails should reach full width. The flown path should remain without visible stepping for about `60` world units. Each stripe should grow from zero thickness, reach its maximum near the middle, then narrow to zero at the tail; both edges should be visibly irregular near the middle but gradually smoother toward both ends, with a thin dark outline. The thinnest projected sections should become slightly translucent without an abrupt cutoff or obvious flicker. Scrolling up produces gentler braking and the opposite camera/FOV response without a new acceleration trail or post-processing effect. Once the boost fades, `getPostProcessingStats().active` returns to `false`. The film grain stays visible and does not move or flicker in either state. With `?gui=1`, **Film grain > Intensity** changes it live, and `0` removes it. Cycle every **Tone mapping > Mode** and change **Exposure**: the scene and sky change together without console errors, and holding **Speed effect > preview** above `0` keeps the same brightness and contrast (no pop between the idle and active paths). `getPostProcessingStats().frameBufferType` is `1016` (half float) with a tone-mapped mode and `1009` (8-bit) with None.
6. With `?gui=1`, change all **Trails** sliders while a trail is visible. Ribbon width must move both stripes, line and border width must change their respective thicknesses, and each edge's frequency and amplitude must change that edge independently. **Oscillation** frequency and amplitude must move the stripe centerlines in slightly different patterns without moving their attachment points at the wings or changing edge noise. On a straight boosted run with level wings, the trail should not oscillate; bank the airplane progressively and confirm the newly emitted sections oscillate more, with maximum motion at maximum bank and no shader error.
7. The sound control mutes and restores volume.
   Debug pause: without `?debug=1`, **P** does nothing and `getDebugStats()` is `null`. With `?debug=1`, **P** during the play intro is ignored. After the intro, **P** stops the airplane, water and `uTime` animation keep moving, and the orbit camera rotates, pans, and zooms. The wheel must not change `getFlightStats().speedEffect`. Pressing **P** again returns the camera to its exact follow position without a jump. With `?debug=1&gui=1`, typing `p` into a GUI text field must not toggle the pause. On touch, orbiting while paused must not make the airplane turn after resume. With `?debug=1&gui=1`, pause with a visible trail and move every **Trails** slider: the frozen trail must update immediately without growing, and must continue from the same point on resume.
8. New terrain chunks appear during traversal without obvious long stalls, together with their scenery. When clouds or boats are re-enabled, repeat this check for them.
9. Fog, distance fades, curvature, water movement, and biome bands remain visually coherent.
   Scenery: with a mixed-biome seed (for example `?seed=s762`), trees and conifers stand only on temperate ground, and cacti and layered rocks only in the desert. Nothing appears on water, beaches, snow, or steep slopes. Silhouettes are smooth without dark halos, and lighting follows the sun and moon at `?time=0.35`, `0.72`, and `0.9`. Reloading with the same seed reproduces the same placement. With `?gui=1`, set each **Scenery** category's density to `0` and confirm only that category disappears. Raise a size and confirm only that type grows. A low **Max per chunk** should thin instances evenly across each chunk. After the re-bake, **Wood detail > Color strength** `0` should restore the plain vertex colors and `1` tint nearby impostors with the veneer color and its grain, with no halo or seam at frame edges and no console error. Raising one type's **variation** should give that type lighter and darker neighbourhoods, without flicker while flying, and leave other types unchanged. Every change should finish with `pending = 0`, `failed = 0`, and unchanged terrain. With **Terrain > Color noise > Intensity** raised to about `0.7`, land shows lighter patches with soft edges that cross band borders and chunk edges without seams, while the sea keeps its colors; **Threshold** changes how much land is lightened, **Frequency** the patch size, and **Softness** the edge width. With **Speed** above `0` the patches slowly change shape over time, without popping; `0` freezes them. `getChunkStats().sceneryChunks` stays at or below the number of live chunks at LOD `2` or lower.
   Near scenery meshes: with `?debug=1&gui=1&seed=g7`, fly until `getSceneryMeshStats().instances` is above `0`, then pause with **P**. Toggling **Scenery > Near meshes > Enabled** must swap nearby trees between impostor and mesh without moving, resizing, recoloring, or relighting them; the meshes are sharper. Set **Mesh until** low and **Impostor from** high to widen the band: trees inside it show a fine dither of both versions, with no transparent holes larger than the small silhouette differences, no z-fighting, and no shader error. While flying, including at full boost and in turns, trees entering the band must not pop. Check at `?time=0.45`, `0.76`, and `0.9`. With **Enabled** off, `instances` is `0` and impostors render at every distance. `triangles` and `updateMs` stay small (on an Apple M1 at `1280 × 800`: under 30 instances, about 10,000 triangles, and at most about `0.1` ms per frame at the default band).
   Day/night: with `?seed=1` load `?time=0`, `0.25`, `0.5`, `0.75`, and `0.8`. The sky gradient starts at the curved terrain edge, not above it; fogged terrain and sky meet without a seam or crease; distant terrain tints toward the horizon palette; stars appear only at night; and `0.8` keeps the original indigo dusk sky. At night, relief must stay readable under moonlight, with slopes facing the moon clearly brighter than the others and a low ambient fill. With `?gui=1`, pause the cycle and fly toward the sun (east at dawn, west at dusk): around `getDayNightStats().sunElevation ≈ 0.07` the disc sits just above the curved edge, at `≈ 0` it is hidden behind the terrain with only its glow visible, and the palette is at sunrise or sunset (`paletteTime ≈ 0.25` or `0.75`). Near sunset, distant terrain toward the sun remains lit while nearby terrain darkens, and no slope is lit from below. The airplane shows no navigation lights; while boosting in a turn, trails are pink around `time=0.27`, orange around `0.74`, white at `0.5`, and blue at night. While paused with `?debug=1`, orbit away from the plane and confirm the sky stays centered on the camera.
   Terrain normal maps: with `?debug=1&gui=1&seed=s167`, pause with **P** and orbit close to the ground. Each elevation band shows its own fabric relief, the sea keeps the original weave, and tiles continue across chunk edges without seams. Under **Terrain > Normal maps**, changing one layer's **Tile size**, **Strength**, or **Rotation** changes only that band, live, with no shader error. Rotating the ribbed-corduroy layer by `90°` must turn its ribs without making the relief look lit from the wrong side. At the default altitude the relief fades out between `50` and `300` units without moiré; **Fade start** and **Fade end** move that range live.
   Desert topography: with `?seed=s762`, the desert shows broader, softer relief than the forest and gets progressively lower away from its border, down to about half the height deep inside; the coastline and the forest away from deserts match the previous build, and the border has no step, crease, or lighting seam. Biomes are about twice as large as before the frequency change. With `?gui=1`, each **Terrain > Desert topography** control regenerates the chunks on release (`pending` returns to `0`, `failed = 0`). Flying low over the border, the safety floor follows the terrain without an altitude snap, and scenery stays on the ground.
10. Resize preserves canvas framing and control layout.
11. During low flight, upcoming terrain raises the safety floor smoothly without a visible altitude snap; the plane neither enters terrain nor exceeds Y `95`. Keep commanding descent at the floor and confirm that altitude and pitch do not bounce. While boosted, a sudden high obstacle must produce an obvious but sub-wheel brake response in speed, camera Z, and FOV and suppress the acceleration trail. Repeat above the sampled target minimum and confirm that no automatic deceleration occurs.
12. The experience remains usable at a viewport below `768px`, including the very narrow play-action layout.

For worker changes, use a fixed URL seed, confirm a separate worker network request, and compare terrain scale, water, bands, seams, and the nonblank canvas against the same seed before the change.

## Terrain And Rendering Observations

For performance-sensitive work, record conditions rather than reporting a subjective improvement:

- Browser and device.
- Viewport and device pixel ratio.
- Desktop or mobile code path.
- Chunk radius and relevant terrain parameters.
- Approximate frame time before and after the change.
- Whether the test crossed chunk boundaries and exercised multiple LODs.

Do not increase chunk radius, geometry density, cloud sampling, or shader cost based only on a high-end desktop result.

## Documentation Integrity

- Use repository-relative links and exact filename casing.
- Keep commands synchronized with `package.json`.
- Keep asset credits synchronized with the license files beside the models.
- Update the owning guide when implementation behavior or boundaries change.
- Treat source code and package metadata as authoritative when documentation has drifted; fix the documentation in the same task.

## Completion Criteria

A change is ready when:

- The requested behavior is implemented within the owning module.
- Applicable checks above pass, or any unavailable check is reported explicitly.
- New browser console errors, shader errors, and failed asset requests have been resolved.
- Generated output and unrelated files are absent from the diff.
- Relevant agent documentation reflects changed commands, contracts, or behavior.

## Future Automation

Potential additions, to be designed in separate tasks:

- Additional unit tests for deterministic height, queue cancellation, and disposal after their pure contracts exist.
- Browser smoke tests that assert a nonblank WebGL canvas and successful asset requests.
- Shader compile coverage against the installed Three.js version.
- Formatting and linting with rules derived from current source style.
- CI for frozen dependency installation, build, tests, and documentation link checks.
- Repeatable frame-time and visual-regression baselines.
