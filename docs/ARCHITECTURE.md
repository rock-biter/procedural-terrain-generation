# Architecture

## Purpose

This document maps runtime ownership and data flow. Read it before moving behavior between modules or changing application startup. Terrain algorithms are detailed in [Terrain](TERRAIN.md), while Three.js material and shader contracts are detailed in [Rendering](RENDERING.md).

## Runtime Map

| Area                  | Owner                                                                  | Responsibility                                                                               |
| --------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| HTML shell            | [`index.html`](../index.html)                                          | Loader, play action, sound toggle, and module entry point.                                   |
| Application bootstrap | [`main.js`](../main.js)                                                | Asset loading, shared parameters and uniforms, scene setup, frame loop, and resize handling. |
| World streaming       | [`src/chunkManager.js`](../src/chunkManager.js)                        | Tracks the moving plane, queues chunk work, selects LOD, and adds or removes chunks.         |
| Terrain unit          | [`src/chunk.js`](../src/chunk.js)                                      | Builds one terrain mesh, computes heights, injects terrain shaders, and places decorations.  |
| Player movement       | [`src/plane.js`](../src/plane.js)                                      | Owns flight input, speed changes, camera attachment, and trail rendering.                    |
| Instanced scenery     | [`src/trees.js`](../src/trees.js), [`src/clouds.js`](../src/clouds.js) | Build instanced meshes and patch their materials when their feature flags are enabled.       |
| Shader source         | [`src/shaders/`](../src/shaders/)                                      | Supplies GLSL replacements for Three.js shader chunks.                                       |

## Startup Sequence

Importing `main.js` performs the following work:

1. Resolve the loader, progress, play, and sound-toggle elements from `index.html`.
2. Create the shared `assets`, `params`, and `uniforms` objects.
3. Start loading the soundtrack and airplane model through a shared `THREE.LoadingManager`. The terrain normal map loads independently from `src/chunk.js`; tree and boat asset requests are skipped while their feature flags are disabled.
4. Create the scene, camera, renderer, lights, fog, and timer while those asynchronous requests are in flight.
5. When the loading manager completes, fade out the loader and call `init(assets)`.
6. `init()` creates `Plane` and `ChunkManager`, places the plane above the terrain, adds it to the scene, and schedules `tic()`.
7. The play action starts audio, accelerates the plane, moves the camera backward, and enables the flight effect.

Rendering begins after assets load, before the user presses the play action. The play action starts movement and audio; it is not the application bootstrap.

## Frame Loop

`tic(timestamp)` is the only animation-frame loop:

1. Update `THREE.Timer` and clamp the movement delta to at most `0.016` seconds.
2. Call `plane.update(deltaTime)`.
3. Write elapsed time and plane position to `uTime` and `uCamera`.
4. Call `chunkManager.updateChunks()` to process or enqueue world-streaming work.
5. Render the scene and schedule the next frame.

Keep frame-sensitive behavior in this order unless a change explicitly depends on a different update sequence.

## Shared State And Ownership

- `params` in `main.js` is the mutable source for terrain generation, colors, fog, light intensity, and the disabled debug GUI.
- `worldFeatures` in `main.js` is the frozen runtime switch for trees, clouds, and boats. All three are currently `false` so chunk work is terrain-only.
- `uniforms` in `main.js` is shared with chunks, instanced scenery, and boat materials. `Chunk` adds `uCurvature` to that object.
- The perspective camera becomes a child of `Plane` through `Plane.addCamera()`.
- The constructor parameter named `camera` in `ChunkManager` is currently the `Plane`. `getCoordsByCamera()` therefore reads the moving plane's world position.
- Loaded startup assets are collected before `init()`. `Plane` requires the airplane mesh; the tree normal map and boat model are loaded only when their corresponding feature is enabled.
- `ChunkManager` owns chunk membership in the scene. Each `Chunk` owns its terrain geometry and local decorations.

Do not create a second render loop, terrain-parameter store, or chunk registry without an architectural reason documented here.

## Data Flow

```text
DOM and asset requests
        |
        v
main.js: LoadingManager -> init(assets)
        |                    |
        |                    +-> Plane -> camera, controls, trails
        |                    |
        |                    +-> ChunkManager -> Chunk instances
        |                                         |
        |                                         +-> Trees / Clouds / Boats
        v
tic() -> shared uniforms -> material shader hooks -> WebGLRenderer
```

Terrain CPU calculations and terrain GLSL both consume related world data. When changing height, curvature, or water behavior, verify the CPU geometry path and every affected shader path together.

## Extension Boundaries

- Add world-streaming policy to `ChunkManager`, not `main.js`.
- Add per-chunk generation or decoration rules to `Chunk` or a dedicated helper extracted from it.
- Add player input, speed, camera-follow, or trail behavior to `Plane`.
- Add shared scene lifecycle behavior to `main.js` only when no narrower owner exists.
- Keep material-specific GLSL in `src/shaders/` and document new replacement points in [Rendering](RENDERING.md).
- Keep DOM behavior synchronized between `index.html` and `main.js`; see [Experience](EXPERIENCE.md).

## Known Architectural Gaps

- There is no teardown path for animation frames, event listeners, audio, or the renderer.
- Debug GUI code is present but disabled and is mixed into `main.js`.
- `main.js` imports disabled control implementations and debug dependencies.
- Shared module-level materials rely on mutable `onBeforeCompile` callbacks.
- There is no deterministic world seed or persisted session state.

Treat these as descriptions of the current system, not permission to broaden unrelated tasks.

## Open Questions

- Should runtime constants and responsive policy move to a dedicated configuration module?
- Should asset loading become a separate service with explicit failure states?
- Should the tracked-object terminology in `ChunkManager` replace the current camera naming?
- What teardown lifecycle is required if the experience is embedded in a larger application?
