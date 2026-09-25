# Development Guide

## Purpose

This document is the operational reference for installing, running, and changing the project. For system ownership and runtime flow, see [Architecture](ARCHITECTURE.md).

## Prerequisites

- Node.js `^20.19.0` or `>=22.12.0`.
- pnpm `9.15.9`, as declared by the `packageManager` field in `package.json`.
- A browser with WebGL support.

Use pnpm for dependency changes. Do not introduce a second lockfile.

## Commands

```bash
pnpm install
pnpm dev
pnpm test
pnpm build
pnpm preview
```

- `pnpm dev` starts Vite with network access through `--host`.
- `pnpm test` runs the dependency-free Node test suite.
- `pnpm build` creates the production bundle in `dist/`.
- `pnpm preview` serves the production bundle locally.
- Use the URL printed by Vite; the default port may change when it is already occupied.

Do not edit or commit generated files under `dist/`.

## Current Toolchain

- Vite builds the ES-module application.
- `vite-plugin-glsl` makes GLSL files importable by JavaScript.
- Tailwind CSS is processed through `@tailwindcss/postcss`.
- The application is plain JavaScript. There is no TypeScript compilation step.
- Node's built-in test runner covers pure chunk-policy and deterministic terrain-buffer behavior under `test/`.
- Vite bundles `src/chunkGeometry.worker.js` as a module worker; no separate worker build command is required.
- The repository currently has no formatter, linter, browser test suite, or CI workflow.

See [Quality](QUALITY.md) for the browser and rendering validation that remains outside the pure Node tests.

## Code Conventions

Follow the patterns in the code being changed rather than introducing a parallel style.

- Use ES modules and preserve the existing default-export class boundaries.
- Use tabs in JavaScript files and omit semicolons.
- Keep Three.js object ownership explicit. The bootstrap belongs in `main.js`; terrain lifecycle belongs in `ChunkManager` and `Chunk`; flight behavior belongs in `Plane`.
- Keep worker messages structured-cloneable. Transfer generated typed-array buffers, and create or mutate renderer-owned objects only on the main thread.
- Reuse vectors and matrices in frame-sensitive code where the surrounding module already does so. Avoid allocations inside the render loop without measuring their cost.
- Uniform names use a `u` prefix, such as `uTime` and `uCamera`.
- Keep shader source in `src/shaders/`; do not embed large GLSL strings in JavaScript.
- Preserve responsive behavior at the existing `768px` JavaScript breakpoint unless a task intentionally redesigns it.
- Add comments only for constraints or non-obvious behavior.

## Change Workflow

1. Read the topic guide linked from the root `AGENTS.md` and the owning source module.
2. Make the smallest change that preserves existing ownership boundaries.
3. Run `pnpm test` and `pnpm build` after every source, shader, dependency, or configuration change.
4. Perform the change-specific checks in [Quality](QUALITY.md).
5. Update the relevant guide when behavior, commands, architecture, or asset requirements change.

When updating dependencies, keep `package.json` and `pnpm-lock.yaml` in sync and review upstream migration notes for Three.js, Vite, Tailwind CSS, and `vite-plugin-glsl`.

## Debugging Notes

- The scene starts rendering only after the loading manager completes and `init()` schedules the first animation frame.
- Browser console errors and failed network requests are the first checks when the page remains on the loader.
- Shader compilation failures appear in the browser console, not necessarily during `pnpm build`.
- The optional `lil-gui` setup in `main.js` is currently disabled. Do not make it part of the normal runtime unless the task explicitly requires debug controls.

## Open Questions

- Decide whether to adopt a formatter and linter before documenting stricter style rules.
- Decide which browser and device matrix should become the supported baseline.
- Decide whether dependency updates require visual snapshots or performance measurements.
