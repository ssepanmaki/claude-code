#!/bin/bash
# Cloud setup: install deps for each checked-out repo. Never fails the session.
for d in */; do
  d=${d%/}
  [ -f "$d/package.json" ] || continue
  if [ -f "$d/bun.lock" ] || [ -f "$d/bun.lockb" ]; then (cd "$d" && bun install) || true
  elif [ -f "$d/pnpm-lock.yaml" ]; then (cd "$d" && corepack enable && pnpm install --frozen-lockfile) || true
  elif [ -f "$d/package-lock.json" ]; then (cd "$d" && npm ci) || true
  fi
done
