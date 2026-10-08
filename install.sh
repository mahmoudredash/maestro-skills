#!/usr/bin/env bash
# Install Maestro skills globally for one or more agents, then create the global config.
#
#   ./install.sh                     # all targets, copy mode
#   ./install.sh --link              # symlink instead of copy (edits in this repo apply live)
#   ./install.sh --target claude     # only one target: claude | opencode | agents | pi | all
#   ./install.sh --project <repo>    # install into <repo>/.claude/skills instead of globally
#   ./install.sh --with omniroute    # also install an optional extension pack (repeatable)
#
# Recommended alternative:  npx skills add <owner>/maestro-skills
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE=copy
TARGET=all
PROJECT=""
WITH=()

while [ $# -gt 0 ]; do
  case "$1" in
    --link) MODE=link ;;
    --target) TARGET="${2:?}"; shift ;;
    --project) PROJECT="${2:?}"; shift ;;
    --with) WITH+=("maestro-${2#maestro-}"); shift ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

dests=()
if [ -n "$PROJECT" ]; then
  dests+=("$PROJECT/.claude/skills")
else
  case "$TARGET" in
    claude)   dests+=("$HOME/.claude/skills") ;;
    opencode) dests+=("$HOME/.config/opencode/skills") ;;
    agents)   dests+=("$HOME/.agents/skills") ;;
    pi)       dests+=("$HOME/.pi/agent/skills") ;;
    all)      dests+=("$HOME/.claude/skills" "$HOME/.config/opencode/skills" "$HOME/.agents/skills" "$HOME/.pi/agent/skills") ;;
    *) echo "unknown target: $TARGET" >&2; exit 2 ;;
  esac
fi

for d in "${dests[@]}"; do
  mkdir -p "$d"
  for s in "$HERE"/skills/*/; do
    name="$(basename "$s")"
    # Extension packs (skills shipping maestro-agents/) are opt-in via --with.
    if [ -d "$s/maestro-agents" ] && [[ ! " ${WITH[*]-} " =~ " $name " ]]; then continue; fi
    rm -rf "${d:?}/$name"
    if [ "$MODE" = link ]; then ln -s "${s%/}" "$d/$name"; else cp -R "${s%/}" "$d/$name"; fi
  done
  echo "installed → $d ($MODE)"
done

# Global config (never overwrites an existing one)
node "$HERE/skills/maestro-router/scripts/maestro.mjs" init --global >/dev/null && echo "config → ${XDG_CONFIG_HOME:-$HOME/.config}/maestro/"

cat <<'EOF'

Next:
  1. Dependencies (if not installed yet):
       npx skills add amElnagdy/delegate-skills                       # dispatch relays (required)
       uv tool install specify-cli --from git+https://github.com/github/spec-kit.git   # speckit (optional)
     and the agent CLIs you want: opencode / pi / cmd
  2. Edit ~/.config/maestro/agents/*.yaml (models, tiers, status) and ~/.config/maestro/config.yaml
  3. Check everything:
       node ~/.claude/skills/maestro-router/scripts/maestro.mjs doctor
  4. Make it automatic: add templates/CLAUDE.md.snippet (or AGENTS.md.snippet) to your
     global ~/.claude/CLAUDE.md or the project's CLAUDE.md / AGENTS.md
EOF
