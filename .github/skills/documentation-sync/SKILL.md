---
name: documentation-sync
description: 'Keep repository documentation synchronized with every project modification. Use after changing source code, shaders, UI, assets, dependencies, configuration, architecture, workflows, validation, or documentation, and before declaring the task complete.'
user-invocable: false
disable-model-invocation: false
---

# Documentation Sync

## Outcome

Keep project documentation consistent with the repository state produced by the current task. Every task that modifies workspace files requires a documentation-impact review. Update documentation when the change affects a documented fact, contract, workflow, or user-visible behavior.

## Required Timing

Use this skill after the implementation is understood and before final validation. Repeat the review when validation or follow-up fixes change the final behavior.

Do not use stale context: read the current version of every documentation file before editing it.

## Documentation Map

| Changed area                                                                        | Documentation owner                                     |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Agent-wide rules or task routing                                                    | [`AGENTS.md`](../../../AGENTS.md)                       |
| Installation, commands, dependencies, toolchain, or coding workflow                 | [`docs/DEVELOPMENT.md`](../../../docs/DEVELOPMENT.md)   |
| Bootstrap, frame loop, ownership, lifecycle, or cross-module data flow              | [`docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md) |
| Noise, height generation, chunks, LOD, streaming, or world decoration               | [`docs/TERRAIN.md`](../../../docs/TERRAIN.md)           |
| Renderer, materials, uniforms, GLSL, instancing, lighting, fog, or GPU resources    | [`docs/RENDERING.md`](../../../docs/RENDERING.md)       |
| Loader, DOM, controls, movement, camera, audio, or responsive behavior              | [`docs/EXPERIENCE.md`](../../../docs/EXPERIENCE.md)     |
| Models, textures, audio files, transforms, provenance, or licensing                 | [`docs/ASSETS.md`](../../../docs/ASSETS.md)             |
| Tests, build checks, browser QA, performance measurements, or CI                    | [`docs/QUALITY.md`](../../../docs/QUALITY.md)           |
| Technical debt, performance analysis, implementation sequencing, or future features | [`docs/ROADMAP.md`](../../../docs/ROADMAP.md)           |
| Human-facing project overview or quick-start instructions                           | [`README.md`](../../../README.md)                       |

A change may require more than one owner. Follow links between guides when a contract spans CPU code, shaders, assets, and user experience.

## Procedure

1. Identify only the files and behavior changed by the current task. Do not absorb unrelated user changes from a dirty worktree.
2. Compare the final implementation with the documentation map and read every potentially affected document.
3. Decide whether each change alters a documented command, dependency, ownership boundary, runtime sequence, parameter, invariant, asset requirement, validation step, known gap, or user-visible behavior.
4. Update all affected documents in the same task. Keep detailed facts in their owning guide and keep `AGENTS.md` concise.
5. Remove or revise statements that became stale. Do not append a new description while leaving a contradictory old description in place.
6. Document only verified current behavior. Put undecided future work under an explicit open-question or future-work heading.
7. Cross-check terminology against source identifiers and commands against `package.json`.
8. Validate changed Markdown links, exact filename casing, frontmatter when present, and whitespace.
9. Run the project checks required by [`docs/QUALITY.md`](../../../docs/QUALITY.md); documentation maintenance does not replace runtime validation.
10. In the final task report, state which documentation was updated. If review proves that no documentation fact or contract changed, state that documentation was reviewed and no update was necessary.

## Update Criteria

Documentation must change when the task changes any of the following:

- Setup commands, supported runtime versions, package manager, dependencies, or build configuration.
- Module responsibilities, control flow, lifecycle, shared state, or extension boundaries.
- Terrain algorithms, coordinate rules, LOD, streaming, placement, or resource ownership.
- Shader includes, uniforms, attributes, material hooks, render settings, or visual validation requirements.
- DOM contracts, controls, camera behavior, audio behavior, responsive policy, or loading states.
- Asset paths, hierarchy assumptions, transforms, provenance, licenses, or distribution credits.
- Required checks, test coverage, CI, supported environments, known limitations, or completion criteria.

A documentation edit is not required for a purely internal change that preserves every documented fact and contract. The impact review and final report are still required; do not create documentation churn merely to prove the skill ran.

## Guardrails

- Preserve user-authored documentation changes and work with the current file contents.
- Do not copy large code blocks into guides when a source link and invariant are clearer.
- Do not duplicate detailed content across guides; update the single owning document and its incoming links.
- Do not describe planned behavior as if it already exists.
- Do not weaken attribution, licensing, or validation requirements to match an implementation shortcut.
- Do not modify unrelated documentation during a focused task.
