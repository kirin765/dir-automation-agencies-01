#!/usr/bin/env bash

set -euo pipefail

BASE_URL="${BASE_URL:-${PUBLIC_SITE_URL:-https://automationagencydirectory.com}}"
ADMIN_API_KEY="${ADMIN_API_KEY:-}"
JOIN_TMP_FILE=""
LIST_TMP_FILE=""
JOIN_ITEM_COUNT=0
LIST_ITEM_COUNT=0

if [[ -z "${ADMIN_API_KEY}" ]]; then
  echo "[필수] ADMIN_API_KEY가 필요합니다."
  echo "환경변수로 미리 설정하거나 아래에 입력하세요."
  echo -n "ADMIN_API_KEY: "
  read -r ADMIN_API_KEY
fi

if [[ -z "${ADMIN_API_KEY}" ]]; then
  echo "ADMIN_API_KEY가 비어 있습니다."
  exit 1
fi

if [[ "${BASE_URL: -1}" == "/" ]]; then
  BASE_URL="${BASE_URL%/}"
fi

cleanup_admin_tmp() {
  [[ -n "${JOIN_TMP_FILE:-}" ]] && [[ -f "$JOIN_TMP_FILE" ]] && rm -f "$JOIN_TMP_FILE"
  [[ -n "${LIST_TMP_FILE:-}" ]] && [[ -f "$LIST_TMP_FILE" ]] && rm -f "$LIST_TMP_FILE"
}

trap cleanup_admin_tmp EXIT

api_call() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local response_file
  response_file="$(mktemp)"
  local code

  if [[ -n "$body" ]]; then
    code=$(curl -sS -o "$response_file" -w "%{http_code}" \
      -X "$method" \
      -H "x-admin-key: ${ADMIN_API_KEY}" \
      -H "content-type: application/json" \
      --data "$body" \
      "${BASE_URL}${path}")
  else
    code=$(curl -sS -o "$response_file" -w "%{http_code}" \
      -X "$method" \
      -H "x-admin-key: ${ADMIN_API_KEY}" \
      "${BASE_URL}${path}")
  fi

  local body_out
  body_out="$(cat "$response_file")"
  rm -f "$response_file"

  if [[ "$code" -lt 200 || "$code" -gt 299 ]]; then
    echo "요청 실패 (${code}): ${path}"
    if [[ -n "$body_out" ]]; then
      echo "$body_out"
    fi
    return 1
  fi

  echo "$body_out"
}

pick_join_requests() {
  local json="$1"
  local tmp_file
  tmp_file="$(mktemp)"

  printf '%s' "$json" > "$tmp_file"
  JOIN_TMP_FILE="${tmp_file}.join.tsv"
  node - "$tmp_file" > "$JOIN_TMP_FILE" <<'NODE'
const fs = require('fs');
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8') || '{}');
const items = Array.isArray(data.items) ? data.items : [];
for (let i = 0; i < items.length; i += 1) {
  const it = items[i];
  const id = String(it.id || '');
  const name = String(it.company_name || it.companyName || '-');
  const city = String(it.city || '-');
  const country = String(it.country || '-');
  process.stdout.write(`${i + 1}\t${id}\t${name}\t${city}\t${country}\n`);
}
NODE

  rm -f "$tmp_file"

  if [[ -f "$JOIN_TMP_FILE" ]] && [[ -s "$JOIN_TMP_FILE" ]]; then
    JOIN_ITEM_COUNT="$(wc -l < "$JOIN_TMP_FILE" | tr -d ' ')"
  else
    JOIN_ITEM_COUNT=0
  fi
}

pick_listings() {
  local json="$1"
  local tmp_file
  tmp_file="$(mktemp)"

  printf '%s' "$json" > "$tmp_file"
  LIST_TMP_FILE="${tmp_file}.listings.tsv"
  node - "$tmp_file" > "$LIST_TMP_FILE" <<'NODE'
const fs = require('fs');
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8') || '{}');
const items = Array.isArray(data.items) ? data.items : [];
for (let i = 0; i < items.length; i += 1) {
  const it = items[i];
  const verified = Number(it.verified || 0);
  if (verified !== 0 && verified !== 1 && String(it.verified).toLowerCase() !== 'true' && String(it.verified).toLowerCase() !== 'false') {
    continue;
  }
  if (Number(it.verified) === 1) {
    continue;
  }
  const slug = String(it.slug || '');
  const name = String(it.name || '-');
  const city = String(it.city || '-');
  const country = String(it.country || '-');
  process.stdout.write(`${i + 1}\t${slug}\t${name}\t${city}\t${country}\n`);
}
NODE

  rm -f "$tmp_file"

  if [[ -f "$LIST_TMP_FILE" ]] && [[ -s "$LIST_TMP_FILE" ]]; then
    LIST_ITEM_COUNT="$(wc -l < "$LIST_TMP_FILE" | tr -d ' ')"
  else
    LIST_ITEM_COUNT=0
  fi
}

get_nth_line() {
  local line_number="$1"
  local file="$2"
  awk "NR==${line_number} { print; exit }" "$file"
}

print_header() {
  echo "========================================"
  echo "AI Automation Agencies - Admin TUI"
  echo "Base URL: ${BASE_URL}"
  echo "========================================"
}

approve_join() {
  local json
  json="$(api_call GET "/api/admin/join-agencies?status=pending")"
  pick_join_requests "$json"

  if (( JOIN_ITEM_COUNT == 0 )); then
    echo "현재 보류 중인 신규 업체 신청이 없습니다."
    return 0
  fi

  echo "[신규 업체 신청 승인]"
  while IFS=$'\t' read -r idx id name city country; do
    printf "%2s) %-12s %-28s %s / %s\n" "$idx" "${id:0:12}" "$name" "$city/$country"
  done < "$JOIN_TMP_FILE"

  echo -n "선택 번호 (빈 값 입력 시 종료): "
  local choice
  read -r choice
  if [[ -z "$choice" ]]; then
    return 0
  fi
  if ! [[ "$choice" =~ ^[0-9]+$ ]] || (( choice < 1 || choice > JOIN_ITEM_COUNT )); then
    echo "잘못된 입력입니다."
    return 1
  fi

  local selected_line request_id req_name
  selected_line="$(get_nth_line "$choice" "$JOIN_TMP_FILE")"
  IFS=$'\t' read -r _ request_id req_name _ <<< "$selected_line"

  echo "요청: $req_name ($request_id)"
  echo "1) approve   2) reject"
  echo -n "동작 선택: "
  local action
  read -r action
  local status
  case "$action" in
    1) status="approved" ;;
    2) status="rejected" ;;
    *) echo "취소됨"; return 1 ;;
  esac

  if api_call POST "/api/admin/update-join" "{\"id\":\"${request_id}\",\"status\":\"${status}\"}" >/dev/null; then
    echo "적용 완료: ${status}"
  else
    return 1
  fi
}

approve_listings() {
  local json
  json="$(api_call GET "/api/listings?page=1&pageSize=200")"
  pick_listings "$json"

  if (( LIST_ITEM_COUNT == 0 )); then
    echo "현재 미검증 목록이 없습니다."
    return 0
  fi

  echo "[미검증 업체 검증 처리]"
  while IFS=$'\t' read -r idx slug name city country; do
    printf "%2s) %-24s %-20s %s / %s\n" "$idx" "${slug:0:24}" "$name" "$city/$country"
  done < "$LIST_TMP_FILE"

  echo -n "선택 번호 (빈 값 입력 시 종료): "
  local choice
  read -r choice
  if [[ -z "$choice" ]]; then
    return 0
  fi
  if ! [[ "$choice" =~ ^[0-9]+$ ]] || (( choice < 1 || choice > LIST_ITEM_COUNT )); then
    echo "잘못된 입력입니다."
    return 1
  fi

  local selected_line listing_slug listing_name
  selected_line="$(get_nth_line "$choice" "$LIST_TMP_FILE")"
  IFS=$'\t' read -r _ listing_slug listing_name _ <<< "$selected_line"

  echo "슬러그: $listing_slug ($listing_name)"
  echo "1) verified=true   2) verified=false"
  echo -n "동작 선택: "
  local action
  read -r action
  local verified
  case "$action" in
    1) verified=true ;;
    2) verified=false ;;
    *) echo "취소됨"; return 1 ;;
  esac

  if api_call POST "/api/admin/listings" "{\"slug\":\"${listing_slug}\",\"verified\":${verified}}" >/dev/null; then
    echo "업데이트 완료"
  else
    return 1
  fi
}

while true; do
  print_header
  echo "1) 신규 신청(join) 승인/거절"
  echo "2) 기존 목록 verified 토글 (/api/admin/listings)"
  echo "3) 종료"
  echo -n "작업 선택: "
  read -r menu

  case "$menu" in
    1)
      approve_join
      ;;
    2)
      approve_listings
      ;;
    3|"")
      echo "종료합니다."
      break
      ;;
    *)
      echo "유효하지 않은 메뉴"
      ;;
  esac
  echo ""
done
