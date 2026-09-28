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

The test suite covers symmetric desktop/mobile desired sets, negative centers, the current LOD rule, deterministic terrain buffers, topology counts, sea clamping, adjacent chunk-edge heights, signed speed effects, vertical-input bands, topography-based safety-climb scaling, four-point terrain flight corridors, fixed clearance, collision-gated terrain slowdown and brake impulses, stable descent constraints at minimum altitude, asymmetric minimum-altitude smoothing, and world-space trail history interpolation, width response to speed and curvature, bank, turns, and bounded retention.

Browser lifecycle checks can read `window.__INFINITE_WORLD__.getChunkStats()`. After the queue drains, `live` must equal `desired`, `pending`, `queued`, and `inFlight` must return to zero, `created - disposed` must equal `live`, `generated` must be at least `created`, and `failed` must remain zero. Desktop should report up to two workers; mobile reports one.

Flight checks can read `window.__INFINITE_WORLD__.getFlightStats()`. Use `pointerYRatio`, `verticalInput`, position Y, speed, manual/visual speed effects, camera FOV/Z, corridor limits, minimum-altitude jump, terrain-brake impulse/effect, and target/effective terrain slowdown to distinguish actual flight changes from camera motion.

## Manual Experience Smoke Test

Use a fresh page load and check:

1. The loader appears, progresses, and disappears.
2. The canvas renders nonblank terrain with no console errors or failed requests.
3. The play action starts movement and soundtrack playback.
4. Pointer movement turns and rolls the airplane; above `45%` it climbs, from `45%` through `65%` it settles at the reached altitude, and below `65%` it descends. Repeat with touch in a mobile viewport.
5. Scrolling down produces temporary acceleration, camera movement, FOV expansion, wider trails, and an edge blur with chromatic aberration that leaves the center sharp. At cruise speed, make a moderate turn and confirm no trail appears, then turn sharply in both directions and confirm both trails follow the wing tips, the outer wing's trail is wider, and turn-only width remains below the full-boost width. At maximum boost the trails should reach full width. The flown path should remain without visible stepping for about `60` world units. Each stripe should grow from zero thickness, reach its maximum near the middle, then narrow to zero at the tail; both edges should be visibly irregular near the middle but gradually smoother toward both ends, with a thin dark outline and fully opaque visible pixels. Scrolling up produces gentler braking and the opposite camera/FOV response without a new acceleration trail or post-processing effect. Once the boost fades, `getPostProcessingStats().active` returns to `false`.
6. With `?gui=1`, change all **Trails** sliders while a trail is visible. Ribbon width must move both stripes, line and border width must change their respective thicknesses, and each edge's frequency and amplitude must change that edge independently without a shader error.
7. The sound control mutes and restores volume.
8. New terrain chunks appear during traversal without obvious long stalls. When a scenery feature is re-enabled, repeat this check for its trees, clouds, or boats.
9. Fog, distance fades, curvature, water movement, and biome bands remain visually coherent.
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
