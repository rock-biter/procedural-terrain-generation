# Assets And Licensing

## Purpose

This document inventories runtime assets and records the checks required when adding, replacing, or redistributing them. The project-level MIT license does not replace third-party asset licenses.

## Asset Inventory

| Asset              | Path                                                                                | Runtime use                                 | License metadata                                                |
| ------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------- |
| Airplane model     | [`public/airplane/scene.gltf`](../public/airplane/scene.gltf) and `scene.bin`       | Player model loaded in `main.js`            | [`public/airplane/license.txt`](../public/airplane/license.txt) |
| Boat model         | [`public/boat/scene.gltf`](../public/boat/scene.gltf), `scene.bin`, and `textures/` | Cloned into suitable water areas by `Chunk` | [`public/boat/license.txt`](../public/boat/license.txt)         |
| Terrain normal map | [`src/textures/normal.jpg`](../src/textures/normal.jpg)                             | Terrain, tree, and cloud materials          | No dedicated provenance file in the repository                  |
| Unused texture     | [`src/textures/tessuto.jpg`](../src/textures/tessuto.jpg)                           | Not imported by current source              | No dedicated provenance file in the repository                  |
| Soundtrack         | [`src/audio/epic-soundtrack.mp3`](../src/audio/epic-soundtrack.mp3)                 | Looping experience audio                    | No dedicated provenance file in the repository                  |

Do not infer redistribution rights for an asset that lacks provenance metadata. Resolve and record its source and license before publishing a new distribution that depends on it.

## Required Model Attribution

Both bundled models use CC BY 4.0 and require author credit:

- **Airplane** by TheTime1337, sourced from Sketchfab. Preserve the complete credit and links in `public/airplane/license.txt` wherever the model is shared.
- **Boat** by Mario Libera, sourced from Sketchfab. Preserve the complete credit and links in `public/boat/license.txt` wherever the model is shared.

Never delete, rename, or replace either license file without updating the corresponding asset and distribution attribution.

## Loading And Transform Contracts

### Airplane

`main.js` imports `/airplane/scene.gltf?url` and loads it through the shared `GLTFLoader`. Every mesh found during traversal is scaled to `0.005`; its geometry is centered and rotated by `-PI / 2` around X. The selected mesh is stored as `assets.planeModel` and passed to `Plane`.

Changing model hierarchy, pivot, units, or orientation can affect steering, camera composition, and trail alignment.

### Boat

`main.js` imports `/boat/scene.gltf?url`, selects `gltf.scene.children[0].children[0]`, scales it to `1.3`, and stores it as `assets.boatModel`. `Chunk` clones that model, rotates each clone around Y, positions it at Y `0.8`, and injects the boat curvature shader into mesh materials.

The hard-coded child selection is part of the current asset contract. A replacement model with a different hierarchy requires a corresponding loader change and browser validation.

### Textures

`normal.jpg` is loaded twice by current code:

- `main.js` loads it through the shared loading manager and exposes it as `assets.normalMap` for trees.
- `src/chunk.js` loads it independently for terrain and clouds, enables repeat wrapping, and sets a `6` by `6` repeat.

The independent chunk-level texture request is not part of the loading manager's progress state.

### Audio

`main.js` loads the soundtrack through `THREE.AudioLoader`, creates looping non-positional audio at volume `0.1`, and attaches its listener to the camera. Playback starts only from the user play action to satisfy browser interaction requirements.

## Adding Or Replacing An Asset

1. Add source, author, license, modification, and attribution details next to the asset.
2. Keep glTF buffers and referenced textures at paths that match the glTF document exactly, including filename case.
3. Decide whether the asset belongs under `public/` as a URL-addressed bundle or under `src/` as a Vite import.
4. Register startup-critical requests with the shared loading manager or add an explicit failure/loading state.
5. Inspect the model hierarchy rather than assuming existing child indices still apply.
6. Verify units, pivot, orientation, material sharing, color space, and texture wrapping.
7. Confirm resource disposal semantics before cloning geometry or materials per chunk.
8. Run the build and the asset checks in [Quality](QUALITY.md).
9. Update this inventory and all required distribution credits.

## Open Questions

- What are the source and redistribution terms for the soundtrack and both texture files?
- Is `tessuto.jpg` intentionally reserved for future work or safe to remove?
- Should model extraction use names instead of hierarchy indices?
- Should duplicate normal-map loading be consolidated under the asset-loading lifecycle?
