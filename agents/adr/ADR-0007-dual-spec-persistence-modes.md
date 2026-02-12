# ADR-0007: Dual Spec Persistence Modes (Reference vs Portable Archive)

## Status
Accepted

## Context
Wave Viewer specs need to support two distinct workflows:
- Regeneration workflow: rerun simulation and reapply plotting intent to fresh results.
- Archival workflow: preserve exact plot data for durable replay and sharing.

A single persistence mode cannot satisfy both ergonomics and portability goals well.

## Decision
- Support two explicit spec persistence modes:
  - `reference-only`: stores data-source references and plotting intent, without embedding full trace samples.
  - `portable-archive`: embeds full plot data required for offline replay.
- Keep both modes deterministic:
  - same inputs must produce stable ordering and stable serialization output.
- UX must make mode selection explicit at export time.

## Consequences
- Users can choose between lightweight rerunnable specs and portable frozen archives.
- Implementation complexity increases (two export/import paths and validation rules).
- Portable archives can be significantly larger; this is expected and acceptable for archive use.

## Alternatives
- Reference-only mode only:
  - Rejected because it cannot guarantee portable replay when source data is unavailable/changed.
- Embedded-data mode only:
  - Rejected because it is heavy for everyday rerun workflows and creates unnecessary file bloat.
