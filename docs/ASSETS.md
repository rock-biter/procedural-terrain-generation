# Assets And Licensing

## Purpose

This document inventories runtime assets and records the checks required when adding, replacing, or redistributing them. The project-level MIT license does not replace third-party asset licenses.

## Asset Inventory

| Asset              | Path                                                                                | Runtime use                                  | License metadata                                                |
| ------------------ | ----------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------- |
| Toy biplane model  | [`public/plane-toy/plane-toy-2.glb`](../public/plane-toy/plane-toy-2.glb) (master in [`assets-src/plane-toy/`](../assets-src/plane-toy/)) | Default player model loaded in `main.js`, preloaded by `index.html` | No provenance file in the repository; node and material names (`tripo_*`) suggest a Tripo AI generation |
| Airplane shadow casters | [`public/plane-toy/plane-toy-2-shadow.glb`](../public/plane-toy/plane-toy-2-shadow.glb) and [`plane-toy-shadow.glb`](../public/plane-toy/plane-toy-shadow.glb), generated from the masters | Simplified airplane drawn in the near shadow cascade | Derived from the toy models; same open provenance |
| Toy monoplane model | [`public/plane-toy/plane-toy.glb`](../public/plane-toy/plane-toy.glb) (master in [`assets-src/plane-toy/`](../assets-src/plane-toy/)) | Player model with `?plane=toy`               | No provenance file in the repository; node and material names (`tripo_*`) suggest a Tripo AI generation |
| Former airplane model | [`public/airplane/scene.gltf`](../public/airplane/scene.gltf) and `scene.bin`    | Not loaded since the toy airplane replaced it | [`public/airplane/license.txt`](../public/airplane/license.txt) |
| Boat model         | [`public/boat/scene.gltf`](../public/boat/scene.gltf), `scene.bin`, and `textures/` | Dormant while `worldFeatures.boats` is false | [`public/boat/license.txt`](../public/boat/license.txt)         |
| Curly teddy normal map | `curly_teddy/curly_teddy_checkered_nor_gl_1k` (`.ktx2` in [`src/textures/`](../src/textures/), `.jpg` master in [`assets-src/textures/`](../assets-src/textures/)) | Imported as the `curlyTeddy` option; no layer uses it by default | Naming and embedded metadata suggest Poly Haven; no provenance file in the repository |
| Terrain normal map | `normal` (`.ktx2` and `.jpg` master, same folders)                                   | Imported as the `fabric` option; no layer uses it by default | No dedicated provenance file in the repository                  |
| Fabric normal maps | `*_nor_gl_1k` in `dirty_carpet/`, `fabric_pattern/`, `hessian/`, `ribbed_corduroy/`, and `waffle_pique/` (same folders) | Sea (`ribbed_corduroy`) and land-band layers of the terrain | Naming and embedded metadata suggest Poly Haven; no provenance file in the repository |
| Wood detail        | `white_oak/white_oak_veneer_diff_1k` (same folders)                                  | Baked into every scenery and cloud impostor and sampled by the near scenery and cloud meshes | Naming suggests Poly Haven; no provenance file in the repository |
| Soundtrack         | [`src/audio/epic-soundtrack.mp3`](../src/audio/epic-soundtrack.mp3)                 | Looping experience audio                     | No dedicated provenance file in the repository                  |
| Style references   | [`docs/style-references/`](style-references/)                                        | Art-direction images for scenery and clouds; not loaded or shipped | No provenance file in the repository |

`assets-src/` holds the masters (the original JPEG, PNG, and GLB files), which are never imported or shipped; `src/textures/` and `public/plane-toy/` hold the encoded runtime files (see [Encoding Pipeline](#encoding-pipeline)). The unused PBR maps (`arm`, `diff`, `col`, `rough`, `spec_ior`), the `olive_veneer` set, `tessuto.jpg`, `wood.jpg`, `wood-grain.png`, and the `scripts/generate-wood-texture.mjs` generator were removed; git history keeps them. `public/` still holds the former airplane and the dormant boat with their license files, so every build copies them into `dist/` although the runtime never requests them.

Do not infer redistribution rights for an asset that lacks provenance metadata. Resolve and record its source and license before publishing a new distribution that depends on it.

## Required Model Attribution

Both Sketchfab models in the repository use CC BY 4.0 and require author credit:

- **Airplane** by TheTime1337, sourced from Sketchfab. It is no longer loaded, but its files stay in the repository and are bundled from `public/`. Preserve the complete credit and links in `public/airplane/license.txt` wherever the model is shared.
- **Boat** by Mario Libera, sourced from Sketchfab. Preserve the complete credit and links in `public/boat/license.txt` wherever the model is shared.

Never delete, rename, or replace either license file without updating the corresponding asset and distribution attribution.

## Loading And Transform Contracts

### Airplane

`main.js` loads the airplane picked by `?plane=<key>` from `AIRPLANE_MODELS` in [`src/airplaneModels.js`](../src/airplaneModels.js): the biplane by default, and `toy` for the monoplane. Unknown keys fall back to the default. Each entry holds the model's public `path`, its load transform, its trail anchor, and its propeller data.

- **File:** both GLBs are packed with gltfpack and require `EXT_meshopt_compression` and `KHR_mesh_quantization`, so the shared `GLTFLoader` has `MeshoptDecoder` from `three/examples/jsm/libs/meshopt_decoder.module.js`. Each holds one node with one mesh and one `MeshStandardMaterial` with embedded base color, ORM (roughness and metalness), and normal textures.
- **Transform:** the geometry is centered, turned about Y by `rotationY` so the nose points to +Z with the wings along X and +Y up, and the mesh is scaled uniformly so its X extent equals `wingspan` (`7.6` world units for both). With the default ribbon width, that puts the trail stripes at the wing tips.
- **Use:** the mesh is stored as `assets.planeModel` and passed to `Plane` with its `AIRPLANE_MODELS` entry.
- **Shadow caster:** `main.js` also loads the model's `shadowPath`, a position-only simplification in the same geometry space. `init()` moves and turns it like the model, by the model's bounding-box center (`assets.planeCenter`, taken before centering) and `rotationY`, and `SceneryShadows` draws it in the near shadow cascade with the model's world matrix. If it fails to load, the cascade draws the full mesh and the console shows a warning.

All measurements below are in geometry units after `center()` and `rotationY`. `trailAnchor` is the trail emission point, the trailing edge at the wing tips. The propeller is fused into each mesh, so it is selected as the set of UV charts that reach beyond `propeller.minZ` and turned about `propeller.axis` by the [propeller shader](RENDERING.md#airplane-propeller). Changing a model, its pivot, units, orientation, or `wingspan` can affect steering, camera composition, and trail alignment; re-measure its entry after a model change.

**Biplane** ([`plane-toy-2.glb`](../public/plane-toy/plane-toy-2.glb), key `biplane`, default)

- **Contents:** about 105,000 vertices and 183,000 triangles, about `3.6` MB.
- **Orientation:** authored with the nose toward +X, so `rotationY` is `-π/2`. Scaled, it is about `7.6` units long and `3.0` tall.
- **Trails:** they leave the upper wing. Its tips reach `x = ±0.488` at heights `0.150`–`0.183`, and the trailing edge at the tip is at `z ≈ 0.148`, so `trailAnchor` is `(0, 0.166, 0.15)`. The lower wing is at about `y = -0.04`.
- **Propeller:** the axis is parallel to +Z through `(-0.0005, 0.0406)`, from spinner circle fits. The cowl is not coaxial: its center is at `y ≈ 0.031`. The cowl charts end at `z = 0.4400`. The blades span about `0.438`–`0.461` and are about `0.18` long from the axis, and the spinner tip reaches `0.49`.
- **Selection:** `minZ = 0.445` selects four blade charts and three spinner charts. A 90-vertex chart near the spinner base, ending at `z = 0.4424`, stays fixed. Turning leaves no openings, so the biplane has no plugs.

**Monoplane** ([`plane-toy.glb`](../public/plane-toy/plane-toy.glb), key `toy`)

- **Contents:** about 126,000 vertices and 206,000 triangles, about `4.2` MB.
- **Orientation:** authored with the nose toward +Z, so `rotationY` is `0`. Scaled, it is about `4.7` units long and `2.1` tall.
- **Trails:** the tips reach `x = ±0.49`, and `trailAnchor` is `(0, 0.014, 0.05)`.
- **Propeller:** the axis is parallel to +Z through `(0, 0.0346)`. The cowl's center is at about `(0, 0.022–0.026)`. The cowl ends at `z = 0.2742`. The blades span about `0.2687`–`0.292` and are about `0.135` long from the axis, and the spinner tip reaches `0.305`.
- **Selection:** `minZ = 0.28` selects two blade charts, two blade-tip charts, and two spinner charts.
- **Fused root and plugs:** the lower-right blade root is fused into the cowl face, which has no surface under it. Turning the blade opens a hole between radii `0.042` and `0.061` from the axis, at angles `-75°` to `-15°` from +X seen from the front, with its rim back to `z = 0.2536`. A ring sector plug at `z = 0.252` (radii `0.03`–`0.062`, `-120°` to `+10°`) closes it from inside the cowl. Thin slits open around the spinner base, at radii `0.028`–`0.042` with the rim back to `z = 0.2437`, and a disc plug at `z = 0.243` (radius `0.043`) closes them.

A model with a separate propeller node would need neither the mask nor plugs.

### Boat

When `worldFeatures.boats` is enabled, `main.js` loads `/boat/scene.gltf`, selects `gltf.scene.children[0].children[0]`, scales it to `1.3`, and stores it as `assets.boatModel`. `Chunk` clones that model, rotates each clone around Y, positions it at Y `0.8`, and injects the boat curvature shader into mesh materials. The current terrain-only configuration makes no boat request.

The hard-coded child selection is part of the current asset contract. A replacement model with a different hierarchy requires a corresponding loader change and browser validation.

### Textures

Terrain normal maps are KTX2 files imported by URL (`?url`) in [`src/terrainNormals.js`](../src/terrainNormals.js). `loadTerrainNormalTextures()` loads each map the layers use once through the shared KTX2 loader and the loading manager, sets repeat wrapping, and swaps it into `uTerrainNormalMaps`; until then every layer samples `FLAT_TERRAIN_NORMAL`. The masters are OpenGL-convention normal maps (`*_nor_gl_1k.jpg`) of slightly different sizes (`curly_teddy` is `1024 × 864`, three others are a few rows off square); the encoder resamples them all to `1024 × 1024`, which keeps the mapping because the shader always stretches the whole image over one square tile. `normal.jpg` has its green channel flipped relative to OpenGL, recorded as `invertGreen` in `TERRAIN_NORMAL_TEXTURES`. A new normal map needs a master, an entry in the encoding script, and an entry there with the right `invertGreen` value.

Scenery (trees, cacti, rocks) and clouds have no model files. Their source meshes are built from Three.js primitives and extruded shapes in `src/impostors/impostorArchetypes.js` and `src/impostors/cloudArchetypes.js`, and `init()` bakes them into in-memory atlases at startup (see [Rendering](RENDERING.md#impostor-scenery) and [Clouds](RENDERING.md#clouds)). The cloud shapes follow [`docs/style-references/cloud-reference.png`](style-references/cloud-reference.png).

`white_oak_veneer_diff_1k` is the only scenery and cloud file asset.

- **Format:** a `1024 × 1024` tileable sRGB color image whose grain lines run vertically (along V), encoded as KTX2 (ETC1S) with a full mip chain from a JPEG master without EXIF rotation. Only the color map is kept.
- **Loading:** `main.js` loads it with `loadKTX2Texture()` through the shared loading manager, with repeat wrapping, and only when `worldFeatures.scenery` or `worldFeatures.clouds` is enabled.
- **Use:** `main.js` sets `SRGBColorSpace`. The bakes and the near meshes share one triplanar function ([`scenery-detail-pars-fragment.glsl`](../src/shaders/scenery-detail-pars-fragment.glsl)) that multiplies each part's vertex color by the texture color, so both look the same. Its side projections map U to height, so the grain renders horizontally. Clouds divide the sample by the texture's mean color (its smallest mip), so their grain does not darken them; this needs the full mip chain the encoder writes. It is not used as bump.
- **Replacing it:** any tileable sRGB color image with its grain along V works; a darker texture darkens every scenery impostor. A replacement needs its license recorded here.

### Audio

[`src/soundtrack.js`](../src/soundtrack.js) streams the soundtrack through an `Audio` media element instead of downloading and decoding it before startup, so it is not part of the loading manager and a failed load only leaves the music silent. The file is a `3.5` MB, `128` kbps stereo MP3 (re-encoded from `256` kbps; a placeholder until the final music and sound effects are chosen); the media element plays it while it downloads. Playback starts only from the user play action to satisfy browser interaction requirements; see [Experience](EXPERIENCE.md#audio).

### Encoding Pipeline

`pnpm assets:encode` runs [`scripts/encode-assets.mjs`](../scripts/encode-assets.mjs), which turns the masters in `assets-src/` into the runtime files with fixed settings. It needs `basisu` (Basis Universal 2.x, `brew install basis_universal`) on `PATH`; the glTF steps use the `@gltf-transform/*` and `meshoptimizer` dev dependencies. All outputs are KTX2 with Basis ETC1S and Zstandard supercompression and a full mip chain; the GPU receives ETC2, BC7, ASTC, or BC1/BC3 depending on what `KTX2Loader.detectSupport()` finds, at a quarter (or less) of the RGBA8 memory.

- **Terrain normal maps:** the normal's X in the color channels and Y in alpha (`-separate_rg_to_color_alpha`, two independent slices; the shader rebuilds Z), resampled to `1024 × 1024`. Mipmaps are box-filtered in linear space without renormalization, like the GPU-generated mipmaps of the former JPEG maps: averaged normals get shorter with distance, so the strongly scaled fabric detail flattens instead of turning into noise (a sharper, renormalized chain looked visibly noisier). About `400` KB per map instead of about `1` MB of JPEG; measured angular error against the JPEG at level 0: `4.2°` mean.
- **Wood detail:** sRGB color, about `210` KB instead of `595` KB; PSNR `37`–`40` dB against the JPEG.
- **Airplane models:** each texture is re-encoded in place inside the GLB at its source size (`2048 × 2048`) and the file requires `KHR_texture_basisu`: base color as sRGB ETC1S (PSNR `36`–`41` dB), the metallic-roughness map as linear ETC1S (`44` dB), and the normal map with normal-map tuning (`0.9°` mean error). The meshopt geometry is written back unchanged; the script compares every accessor and fails otherwise. The biplane goes from `3.59` to `2.24` MB and the monoplane from `4.21` to `2.65` MB.
- **Airplane shadow casters:** each model is also simplified to `<name>-shadow.glb` with meshoptimizer: vertices split only by uv or normal seams are welded by position, the mesh is simplified toward `4,000` triangles with an error bound of `2%` of its extent, and the result is written as positions and 16-bit indices only (about `48` KB, uncompressed). The fused parts leave non-manifold vertices that the simplifier locks by default (the biplane stalled at about `24,000` triangles, the monoplane at `36,000`), so it runs with `Permissive`. Results: biplane `3,992` triangles (error `0.0015` of its extent, about `1` cm at scale), monoplane `4,000` (`0.0012`).
- **Transcoder:** `KTX2Loader` loads three's own `basis_transcoder.js` and `.wasm` (Apache-2.0, Binomial LLC), which Vite bundles as hashed assets (about `0.6` MB, `0.25` MB gzipped for the WebAssembly), so they always match the installed three.

Re-run the script after changing a master or a setting, and commit the outputs. Measured in headless Chrome with an empty cache, the transfer before the Play action fell from `9.39` to `5.43` MB.

## Adding Or Replacing An Asset

1. Add source, author, license, modification, and attribution details next to the asset.
2. Keep glTF buffers and referenced textures at paths that match the glTF document exactly, including filename case.
3. Decide whether the asset belongs under `public/` as a URL-addressed bundle or under `src/` as a Vite import. Put texture and model masters in `assets-src/` and add them to `scripts/encode-assets.mjs`, so the runtime file is KTX2 or a GLB with KTX2 textures.
4. Register startup-critical requests with the shared loading manager or add an explicit failure/loading state.
5. Inspect the model hierarchy rather than assuming existing child indices still apply.
6. Verify units, pivot, orientation, material sharing, color space, and texture wrapping.
7. Confirm resource disposal semantics before cloning geometry or materials per chunk.
8. Run the build and the asset checks in [Quality](QUALITY.md).
9. Update this inventory and all required distribution credits.

## Open Questions

- What are the source and redistribution terms for `plane-toy.glb`, `plane-toy-2.glb`, the soundtrack, `white_oak`, and the other texture files without a provenance file?
- Should the dormant boat and the former airplane move out of `public/` (about `10.6` MB copied into every build) while keeping their license files?
- Should model extraction use names instead of hierarchy indices?
