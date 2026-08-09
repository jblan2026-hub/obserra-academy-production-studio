#!/usr/bin/env bash
set -euo pipefail

if ! command -v ffmpeg >/dev/null 2>&1 \
  || ! command -v ffprobe >/dev/null 2>&1 \
  || ! python3 -c 'import venv' >/dev/null 2>&1; then
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ffmpeg python3 python3-venv curl ca-certificates
fi

if [[ "${ACADEMY_REQUIRE_GIT_LFS:-false}" == "true" ]] \
  && ! command -v git-lfs >/dev/null 2>&1; then
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends git-lfs
fi

if [[ "${ACADEMY_REQUIRE_GIT_LFS:-false}" == "true" ]]; then
  git lfs install --local
fi

rm -rf .academy-tools
python3 -m venv .academy-tools
.academy-tools/bin/python -m pip install \
  --disable-pip-version-check \
  --no-cache-dir \
  "piper-tts==1.5.0"

echo "${GITHUB_WORKSPACE:-$PWD}/.academy-tools/bin" >> "${GITHUB_PATH:?GITHUB_PATH is required}"
