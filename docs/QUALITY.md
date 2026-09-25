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

The chunk-policy suite covers symmetric desktop/mobile desired sets, negative centers, and the current distance-based LOD rule. Browser lifecycle checks can read `window.__INFINITE_WORLD__.getChunkStats()`; after the queue drains, `live` must equal `desired`, `pending` must return to zero, and `created - disposed` must equal `live`.

## Manual Experience Smoke Test

Use a fresh page load and check:

1. The loader appears, progresses, and disappears.
2. The canvas renders nonblank terrain with no console errors or failed requests.
3. The play action starts movement and soundtrack playback.
4. Pointer movement turns and rolls the airplane; touch movement works in a mobile viewport.
5. Wheel input produces temporary acceleration, camera movement, FOV change, and trails.
6. The sound control mutes and restores volume.
7. New terrain chunks appear during traversal without obvious long stalls. When a scenery feature is re-enabled, repeat this check for its trees, clouds, or boats.
8. Fog, distance fades, curvature, water movement, and biome bands remain visually coherent.
9. Resize preserves canvas framing and control layout.
10. The experience remains usable at a viewport below `768px`, including the very narrow play-action layout.

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
