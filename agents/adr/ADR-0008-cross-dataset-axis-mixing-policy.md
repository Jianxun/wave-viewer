# ADR-0008: Cross-Dataset Axis Mixing Policy

## Status
Accepted

## Context
Wave Viewer supports exploratory plotting across multiple simulation outputs. Traces may come from different datasets, analysis types, and independent-variable semantics.

A strict compatibility gate would reduce accidental misuse but would also block valid exploratory workflows.

## Decision
- Allow mixing traces from different datasets on the same plot/lane by default.
- Do not enforce unit/axis-consistency guards in MVP.
- User is responsible for semantic consistency of mixed traces.

## Consequences
- Maximum flexibility for exploration and comparison workflows.
- Higher risk of semantically inconsistent overlays if users mix incompatible traces.
- Future guardrails (warnings, linting, or compatibility hints) remain open as optional enhancements.

## Alternatives
- Hard block incompatible mixes:
  - Rejected because it adds friction and constrains exploratory use cases.
- Soft warnings with opt-in override:
  - Rejected for MVP to keep behavior simple while protocol/data model changes are in flight.
