#!/usr/bin/env bash
set -euo pipefail

: "${ACADEMY_PRIVATE_BACKUP_REPOSITORY:?ACADEMY_PRIVATE_BACKUP_REPOSITORY is required}"
: "${ACADEMY_PRIVATE_BACKUP_BRANCH:?ACADEMY_PRIVATE_BACKUP_BRANCH is required}"
: "${ACADEMY_PRIVATE_BACKUP_ROOT:?ACADEMY_PRIVATE_BACKUP_ROOT is required}"
: "${ACADEMY_PRIVATE_BACKUP_TOKEN:?ACADEMY_PRIVATE_BACKUP_TOKEN is required}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"

export GH_TOKEN="${ACADEMY_PRIVATE_BACKUP_TOKEN}"

visibility="$(gh repo view "${ACADEMY_PRIVATE_BACKUP_REPOSITORY}" --json visibility --jq '.visibility' 2>/dev/null || true)"
if [[ "${visibility}" != "PRIVATE" ]]; then
  echo "[Academy Backup] Refusing backup because ${ACADEMY_PRIVATE_BACKUP_REPOSITORY} is not confirmed PRIVATE. visibility=${visibility:-unknown}" >&2
  exit 2
fi

work_root="${RUNNER_TEMP:-/tmp}/obserra-academy-private-backup"
rm -rf "${work_root}"
mkdir -p "${work_root}"
cd "${work_root}"

gh auth setup-git >/dev/null
gh repo clone "${ACADEMY_PRIVATE_BACKUP_REPOSITORY}" backup -- --branch "${ACADEMY_PRIVATE_BACKUP_BRANCH}" --single-branch --depth 1
cd backup

git lfs install --local
git lfs track "*.mp4" "*.mov" "*.mkv" "*.webm" "*.wav" "*.flac"

backup_rel="${ACADEMY_PRIVATE_BACKUP_ROOT}/runs/run-${GITHUB_RUN_ID}-${GITHUB_SHA:0:12}"
backup_dir="${PWD}/${backup_rel}"
mkdir -p "${backup_dir}"

source_root="${GITHUB_WORKSPACE}"

copy_path() {
  local source="$1"
  local destination="$2"
  if [[ -e "${source}" ]]; then
    mkdir -p "$(dirname "${destination}")"
    if [[ -d "${source}" ]]; then
      mkdir -p "${destination}"
      rsync -a --delete "${source}/" "${destination}/"
    else
      cp -p "${source}" "${destination}"
    fi
  fi
}

mkdir -p "${backup_dir}/catalog" "${backup_dir}/courses" "${backup_dir}/releases" "${backup_dir}/sources" "${backup_dir}/brand"

for course_dir in "${source_root}"/courses/*; do
  [[ -d "${course_dir}" ]] || continue
  course_id="$(basename "${course_dir}")"
  destination="${backup_dir}/courses/${course_id}"
  mkdir -p "${destination}"
  copy_path "${course_dir}/course-manifest.json" "${destination}/course-manifest.json"
  copy_path "${course_dir}/authoritative-sources.generated.json" "${destination}/authoritative-sources.generated.json"
  copy_path "${course_dir}/generated" "${destination}/generated"
done

copy_path "${source_root}/releases" "${backup_dir}/releases"
copy_path "${source_root}/sources/authoritative-sources.json" "${backup_dir}/sources/authoritative-sources.json"
copy_path "${source_root}/brand" "${backup_dir}/brand"

for evidence in \
  academy-61-completion-evidence.json \
  ACADEMY-61-COMPLETION-EVIDENCE.md \
  academy-61-source-research-summary.json \
  academy-61-research-registry-merge.json \
  academy-61-cinematic-authoring-summary.json \
  academy-61-independent-review-summary.json \
  academy-local-ollama-evidence-summary.json \
  academy-61-local-media-render-summary.json \
  academy-free-source-context-summary.json \
  academy-hollywood-compliance-staging.json; do
  copy_path "${source_root}/catalog/${evidence}" "${backup_dir}/catalog/${evidence}"
done

cat > "${backup_dir}/BACKUP-METADATA.json" <<EOF
{
  "schemaVersion": "1.1",
  "sourceRepository": "${GITHUB_REPOSITORY}",
  "sourceCommit": "${GITHUB_SHA}",
  "sourceRunId": "${GITHUB_RUN_ID}",
  "privateBackupRepository": "${ACADEMY_PRIVATE_BACKUP_REPOSITORY}",
  "privateBackupBranch": "${ACADEMY_PRIVATE_BACKUP_BRANCH}",
  "backupPath": "${backup_rel}",
  "classification": "OBSERRA PROPRIETARY INFORMATION. NOT FOR DISTRIBUTION.",
  "publicRepositoryStorageAuthorized": false,
  "commercialModelApiExpected": false,
  "commercialMediaApiExpected": false
}
EOF

if grep -RIlE --exclude='BACKUP-SHA256SUMS.txt' --exclude-dir='.git' \
  '(sk-[A-Za-z0-9_-]{20,}|github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{20,}|postgres(ql)?://[^[:space:]]+:[^[:space:]]+@)' \
  "${backup_dir}" >/tmp/academy-backup-secret-findings.txt 2>/dev/null; then
  echo "[Academy Backup] Potential secret material detected in backup payload. Refusing commit." >&2
  sed -n '1,100p' /tmp/academy-backup-secret-findings.txt >&2
  exit 3
fi

(
  cd "${backup_dir}"
  find . -type f ! -name 'BACKUP-SHA256SUMS.txt' -print0 \
    | sort -z \
    | xargs -0 sha256sum > BACKUP-SHA256SUMS.txt
)

course_count="$(find "${backup_dir}/courses" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
video_count="$(find "${backup_dir}" -type f \( -iname '*.mp4' -o -iname '*.mov' -o -iname '*.mkv' -o -iname '*.webm' \) | wc -l | tr -d ' ')"
certificate_count="$(find "${backup_dir}" -type f -path '*/certificate/*' | wc -l | tr -d ' ')"

if [[ "${course_count}" != "61" ]]; then
  echo "[Academy Backup] Expected 61 course backup folders, found ${course_count}." >&2
  exit 4
fi
if [[ "${video_count}" -lt "1" ]]; then
  echo "[Academy Backup] No final course videos found in private backup payload." >&2
  exit 5
fi
if [[ "${certificate_count}" -lt "61" ]]; then
  echo "[Academy Backup] Expected certificate assets for all courses; found ${certificate_count} certificate files." >&2
  exit 6
fi
if [[ ! -s "${backup_dir}/catalog/academy-local-ollama-evidence-summary.json" ]]; then
  echo "[Academy Backup] Local model zero-cost evidence is missing." >&2
  exit 7
fi
if [[ ! -s "${backup_dir}/catalog/academy-61-local-media-render-summary.json" ]]; then
  echo "[Academy Backup] Local media zero-cost evidence is missing." >&2
  exit 8
fi

cat > "${backup_dir}/BACKUP-SUMMARY.md" <<EOF
# Obserra Academy Private Backup

Source repository: ${GITHUB_REPOSITORY}
Source commit: ${GITHUB_SHA}
Source workflow run: ${GITHUB_RUN_ID}
Courses backed up: ${course_count}
Final video files backed up: ${video_count}
Certificate files backed up: ${certificate_count}
Model/media production mode: local-only, no commercial generation API expected
Classification: OBSERRA PROPRIETARY INFORMATION. NOT FOR DISTRIBUTION.
Public repository storage authorized: no
EOF

git config user.name "Obserra Academy Backup Bot"
git config user.email "academy-backup@obserra.invalid"
git add .gitattributes "${backup_rel}"
if git diff --cached --quiet; then
  echo "[Academy Backup] No backup changes to commit."
  exit 0
fi

git commit -m "Backup completed Academy 61-course materials run ${GITHUB_RUN_ID}"
git push origin "HEAD:${ACADEMY_PRIVATE_BACKUP_BRANCH}"

commit_sha="$(git rev-parse HEAD)"
echo "[Academy Backup] Private GitHub backup complete: ${ACADEMY_PRIVATE_BACKUP_REPOSITORY}@${commit_sha}:${backup_rel}"
