# Terrain And World Streaming

## Purpose

This document describes procedural height generation, terrain geometry, chunk streaming, LOD, and per-chunk scenery. The primary sources are [`src/chunk.js`](../src/chunk.js) and [`src/chunkManager.js`](../src/chunkManager.js).

## Coordinate Model

- A chunk is a `256` by `256` unit plane by default; `main.js` passes this size to `ChunkManager`.
- Chunk keys use the string form `i|j`.
- The current chunk coordinate is `floor(position.x / chunkSize), floor(position.z / chunkSize)`.
- `ChunkManager` currently receives the moving `Plane` as its tracked object even though the field and helper names refer to a camera.
- A chunk at grid coordinate `(i, j)` is centered at `((i + 0.5) * size, 0, (j + 0.5) * size)`.
- Terrain vertices stay local to the chunk mesh. Height sampling adds the chunk's world position before evaluating noise.

Keep CPU sampling, chunk placement, instance placement, and shader world coordinates aligned when changing this model.

## Height Generation

`getHeight(x, z, noises, params)` is the shared CPU height function.

1. For every configured octave, sample simplex noise using `frequency`, `lacunarity`, and world coordinates.
2. Square each sample and scale it by `amplitude * persistance ** octave`.
3. Add a lower-frequency landmass term blended through Three.js `smoothstep` and `lerp` helpers.

`ChunkManager` creates one `simplex-noise` function per octave. It does not pass a seeded random function, so a reload can produce a different world. The installed `alea` package is not used by the current source.

For every terrain vertex, `Chunk.updateGeometry()` stores the raw height in the custom `height` attribute and clamps the visible CPU vertex Y position to at least `-1`. Shaders use the raw attribute for effects and coloring, so do not remove it when changing geometry generation.

## Chunk Lifecycle

`ChunkManager.updateChunks()` drives streaming:

- Desktop keeps chunks within `maxDistance = 5`; mobile uses `4`.
- Entering a new chunk enqueues creation and LOD updates around the tracked position; out-of-range chunks are disposed immediately during that scan.
- While the tracked position remains in the same chunk, the manager processes up to three queued callbacks per frame on desktop or two on mobile.
- The queue is sorted by distance and processed with `pop()`, causing nearer work to run first.
- A new `Chunk` is added directly to the scene and registered in the `chunks` object and `chunkKeys` array.
- Out-of-range chunks call `Chunk.dispose()` and their registry entry is set to `undefined`.

Queue behavior spreads expensive geometry work across frames. Avoid replacing it with synchronous bulk creation without profiling startup and traversal frame times.

## Level Of Detail

LOD is distance-based:

```text
LOD = floor(distanceInChunks * 0.7)
segments = max(floor(size * 0.5 ** LOD), density) / density
```

The density divisor is `2` on desktop and `4` on mobile. `Chunk.updateLOD()` disposes the previous geometry, creates a new plane, recreates its custom height attribute, samples every vertex again, and recomputes normals.

An unchanged LOD returns early. Any new LOD rule must preserve this guard and must keep neighboring chunk edges compatible enough to avoid obvious cracks.

## Per-Chunk Scenery

`main.js` currently passes `worldFeatures` with `trees`, `clouds`, and `boats` all set to `false`. `Chunk.updateGeometry()` therefore stops after terrain height and normal generation. The scenery implementations remain available behind those flags for later isolated work.

### Trees

- When enabled, trees are generated when a chunk has no tree mesh and its LOD is `2` or lower.
- Candidate spacing is `5` units on desktop and `8` on mobile.
- Placement combines terrain height, two noise frequencies, and a random threshold.
- Valid tree heights are greater than `4` and less than `42`.
- Positions are passed to the `Trees` instanced mesh in chunk-local coordinates.

### Clouds

- When enabled, clouds are generated once per chunk and passed to a `Clouds` instanced mesh.
- The current candidate loop samples every integer position across the chunk. It computes a mobile/desktop `density` value but does not use it.
- Placement combines two noise frequencies with a random threshold and stores cloud positions around Y `100`.

### Boats

- When enabled, each chunk attempts to place between zero and three boats.
- Each boat gets at most `20` random placement attempts.
- Accepted terrain height must be between `-10` and `-2`.
- The loaded boat model is cloned, randomly rotated, positioned at Y `0.8`, and given the boat vertex-shader replacement.

Tree, cloud, and boat placement includes `Math.random()`, so re-enabling decoration would not be reproducible between sessions even if terrain noise were later seeded.

## Resource Lifecycle

`Chunk.dispose()` removes the chunk from its parent, disposes terrain geometry and the tree instanced mesh, and removes boat clones. Review all owned GPU resources when adding new per-chunk content.

`createCloudsMesh()` disposes an existing cloud mesh before replacing it, but the main `Chunk.dispose()` path does not explicitly dispose that mesh. It also does not dispose shared materials or cloned boat resources. Record and test ownership before changing disposal; shared resources must not be destroyed while another chunk still uses them.

## Invariants For Changes

- Sample noise in world coordinates so adjacent chunks share edge heights.
- Keep the raw `height` buffer attribute available to terrain shaders.
- Dispose replaced geometries.
- Keep expensive creation and LOD work bounded per frame.
- Test negative world coordinates because chunk indexing uses `Math.floor()`.
- Validate desktop and narrow/mobile paths because density and streaming radius differ.
- Check terrain, trees, clouds, and boats after changing height bands.
- Treat changes to `params.octaves` as changes to both the height loop and the number of available noise functions.

## Open Questions

- Should terrain and decoration use a user-visible deterministic seed?
- What frame-time budget should govern queue throughput and chunk radius?
- Should chunk resources be pooled rather than recreated after disposal?
- Should clouds and decorations have independent LOD policies?
- How should visible seams and normal discontinuities be measured?
