#!/usr/bin/env bash
# Deploy or update the stack on a VM.
#
#   ./scripts/deploy.sh            # build + start
#   ./scripts/deploy.sh --tunnel   # also start cloudflared
#   ./scripts/deploy.sh --pull     # refresh base images first
#
# Requires Docker Engine + Compose v2 and a filled-in .env file.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  echo "Missing .env. Copy .env.production.example to .env and fill in secrets." >&2
  exit 1
fi

PROFILE_ARGS=()
PULL_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --tunnel) PROFILE_ARGS=(--profile tunnel) ;;
    --pull) PULL_ARGS=(--pull always) ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

echo "→ Validating compose configuration"
docker compose config >/dev/null

if (( ${#PULL_ARGS[@]} )); then
  echo "→ Pulling base images"
  docker compose pull postgres redis nginx frontend cloudflared 2>/dev/null || true
fi

echo "→ Building and starting services"
docker compose "${PROFILE_ARGS[@]}" up -d --build --remove-orphans

echo "→ Waiting for the edge to report healthy"
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${EDGE_PORT:-8080}/health/ready" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo "→ Running smoke checks"
EDGE_URL="http://127.0.0.1:${EDGE_PORT:-8080}" ./scripts/smoke.sh

echo
docker compose "${PROFILE_ARGS[@]}" ps
echo
echo "Deployed. Put Cloudflare (Tunnel or proxy) in front of 127.0.0.1:${EDGE_PORT:-8080}."
