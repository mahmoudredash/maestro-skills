# Extensions

The core (v1) has **no dependency** on any extension. Extension packs are optional and are added later without editing the core.

The core exposes these extension points:

1. **Agent files accept any model.** A pack can add models that run through it as ordinary entries in `agents/*.yaml`. For example, a gateway pack might add `id: <gateway>/auto-coding` under the opencode agent. The router treats it like any other model.
2. **Pack agent files.** A skill that ships `maestro-agents/*.yaml` is discovered by the router automatically. Agent files can declare a `preflight` command, which runs once per dispatch: exit 0 = ok, exit 3 = fallback only, anything else = skip the agent and cool it down. Models can carry `roles` and `sensitive_ok` limits.
3. **This folder.** A pack lives in `extensions/<pack>/`, with its own skills and scripts, and documents which phase it hooks into: triage, routing hints, quota checks before dispatch, review gating, and so on. The `maestro` skill reads `extensions/*/EXTENSION.md` only when the folder exists.

Planned packs (not part of v1):
- **omniroute**: shipped as `skills/maestro-omniroute`. It uses the pack agent files and preflight mechanism above.
- **decision-engine**: use a decision model (for example Command Code's *jev*) for cheap typed decisions: task triage, sensitivity classification, review gating.
