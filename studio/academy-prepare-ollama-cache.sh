#!/usr/bin/env bash
set -euo pipefail

: "${OLLAMA_VERSION:?OLLAMA_VERSION is required}"
: "${OLLAMA_LINUX_AMD64_SHA256:?OLLAMA_LINUX_AMD64_SHA256 is required}"
: "${LOCAL_AI_MODEL:?LOCAL_AI_MODEL is required}"

cache_dir="${HOME}/.cache/obserra-academy/ollama"
archive="${cache_dir}/ollama-linux-amd64-${OLLAMA_VERSION}.tar.zst"
mkdir -p "$cache_dir"

if [[ ! -s "$archive" ]]; then
  curl --fail --location --silent --show-error \
    --retry 3 --retry-delay 2 --retry-all-errors \
    "https://github.com/ollama/ollama/releases/download/v${OLLAMA_VERSION}/ollama-linux-amd64.tar.zst" \
    --output "$archive"
fi

printf '%s  %s\n' "$OLLAMA_LINUX_AMD64_SHA256" "$archive" | sha256sum --check --strict

if ! command -v zstd >/dev/null 2>&1; then
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends zstd
fi
sudo tar --zstd --extract --file "$archive" --directory /usr
ollama --version

nohup env \
  OLLAMA_CONTEXT_LENGTH="${OLLAMA_CONTEXT_LENGTH:-24576}" \
  OLLAMA_FLASH_ATTENTION="${OLLAMA_FLASH_ATTENTION:-1}" \
  OLLAMA_KV_CACHE_TYPE="${OLLAMA_KV_CACHE_TYPE:-q8_0}" \
  OLLAMA_NO_CLOUD="${OLLAMA_NO_CLOUD:-1}" \
  OLLAMA_KEEP_ALIVE="${OLLAMA_KEEP_ALIVE:-30m}" \
  OLLAMA_NUM_PARALLEL="${OLLAMA_NUM_PARALLEL:-1}" \
  OLLAMA_MAX_LOADED_MODELS="${OLLAMA_MAX_LOADED_MODELS:-1}" \
  OLLAMA_MAX_QUEUE="${OLLAMA_MAX_QUEUE:-8}" \
  OLLAMA_LOAD_TIMEOUT="${OLLAMA_LOAD_TIMEOUT:-30m}" \
  ollama serve > /tmp/academy-ollama-prepare.log 2>&1 &

for _attempt in $(seq 1 90); do
  if curl --fail --silent http://127.0.0.1:11434/api/tags >/dev/null; then
    break
  fi
  sleep 2
done
curl --fail --silent http://127.0.0.1:11434/api/tags >/dev/null

if ! ollama show "$LOCAL_AI_MODEL" >/dev/null 2>&1; then
  ollama pull "$LOCAL_AI_MODEL"
fi
ollama show "$LOCAL_AI_MODEL" >/dev/null
ollama list
pkill -f "ollama serve" || true
