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
    echo "요청 실패 (${code}): ${path}" >&2
    if [[ -n "$body_out" ]]; then
      echo "$body_out" >&2
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
  const description = String((it.description || '').replace(/\r?\n/g, ' ').slice(0, 180));
  const priceMin = String(it.price_min ?? '-');
  const priceMax = String(it.price_max ?? '-');
  const platforms = String(it.platforms || '-');
  process.stdout.write(`${i + 1}\t${id}\t${name}\t${city}\t${country}\t${platforms}\t${priceMin}\t${priceMax}\t${description}\n`);
}
NODE

  rm -f "$tmp_file"

  if [[ -f "$JOIN_TMP_FILE" ]] && [[ -s "$JOIN_TMP_FILE" ]]; then
    JOIN_ITEM_COUNT="$(wc -l < "$JOIN_TMP_FILE" | tr -d ' ')"
  else
    JOIN_ITEM_COUNT=0
  fi
}

is_listing_visible_by_slug() {
  local slug="$1"
  if [[ -z "$slug" ]]; then
    echo "0"
    return 0
  fi

  local encoded_slug
  encoded_slug="$(node - "$slug" <<'NODE'
const slug = String(process.argv[2] || '');
process.stdout.write(encodeURIComponent(slug));
NODE
)"

  local json
  json="$(api_call GET "/api/listings?slug=${encoded_slug}&page=1&pageSize=100")" || {
    echo "0"
    return 1
  }

  local visible
  visible="$(node - "$slug" <<'NODE'
const fs = require('fs');
const targetSlug = String(process.argv[2] || '').toLowerCase();
const raw = fs.readFileSync(0, 'utf8');
try {
  const parsed = JSON.parse(raw || '{}');
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const found = items.some((item) => String(item.slug || '').toLowerCase() === targetSlug);
  process.stdout.write(found ? '1' : '0');
} catch {
  process.stdout.write('0');
}
NODE
)"

  echo "$visible"
}

extract_json_value() {
  local json="$1"
  local key="$2"

  node - "$key" <<'NODE'
const key = process.argv[2];
const raw = require('fs').readFileSync(0, 'utf8');
try {
  const parsed = JSON.parse(raw || '{}');
  const value = parsed?.[key] ?? '';
  process.stdout.write(String(value));
} catch {
  process.exit(0);
}
NODE
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

reconcile_join_request() {
  local request_id="$1"
  local response
  local response_retry
  local slug
  local owner_token
  local visible
  local visible_after_retry

  response="$(api_call POST "/api/admin/update-join" "{\"id\":\"${request_id}\",\"status\":\"approved\"}")" || {
    echo "  [실패] 승인 API 호출 실패"
    return 1
  }

  slug="$(extract_json_value "$response" slug)"
  owner_token="$(extract_json_value "$response" ownerToken)"

  if [[ -z "$slug" ]]; then
    echo "  [실패] 응답에 slug가 없어 목록 반영 검증 불가"
    return 1
  fi

  echo "  Listing slug: $slug"
  visible="$(is_listing_visible_by_slug "$slug" || true)"
  if [[ "$visible" == "1" ]]; then
    echo "  [완료] listings 반영 확인"
    if [[ -n "$owner_token" ]]; then
      echo "  Owner token: $owner_token"
      echo "  리드 조회 링크: ${BASE_URL}/owner?token=${owner_token}"
    else
      echo "  Owner token: (미생성)"
    fi
    return 0
  fi

  echo "  [재시도] listings 미반영 감지, 동일 요청 1회 재호출"
  response_retry="$(api_call POST "/api/admin/update-join" "{\"id\":\"${request_id}\",\"status\":\"approved\"}")" || {
    echo "  [실패] 재승인 API 호출 실패"
    return 1
  }

  slug="$(extract_json_value "$response_retry" slug)"
  owner_token="$(extract_json_value "$response_retry" ownerToken)"
  if [[ -z "$slug" ]]; then
    echo "  [실패] 재호출 응답에 slug가 없어 목록 반영 검증 불가"
    return 1
  fi

  visible_after_retry="$(is_listing_visible_by_slug "$slug" || true)"
  if [[ "$visible_after_retry" == "1" ]]; then
    echo "  [완료] 재시도 후 listings 반영 확인"
    if [[ -n "$owner_token" ]]; then
      echo "  Owner token: $owner_token"
      echo "  리드 조회 링크: ${BASE_URL}/owner?token=${owner_token}"
    else
      echo "  Owner token: (미생성)"
    fi
    return 0
  fi

  echo "  [실패] 재시도 후에도 listings 미반영"
  echo "  수동 점검 권장: 요청 ${request_id}, slug ${slug}"
  return 1
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
  while IFS=$'\t' read -r idx id name city country platforms priceMin priceMax description; do
    printf "%2s) %-12s %-28s %s / %s (price: %s~%s)\n" "$idx" "${id:0:12}" "$name" "$city/$country" "$priceMin" "$priceMax"
    printf "   Platforms: %s\n" "$platforms"
    printf "   Desc: %s\n" "$description"
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

  local selected_line request_id req_name req_city req_country
  selected_line="$(get_nth_line "$choice" "$JOIN_TMP_FILE")"
  IFS=$'\t' read -r _ request_id req_name req_city req_country _ _ _ _ <<< "$selected_line"
  echo "요청 상세: $req_name (${req_city}/${req_country})"
  echo "  요청 ID: $request_id"

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

  if [[ "$status" == "rejected" ]]; then
    echo -n "반려 사유(선택): "
    local reason
    read -r reason
    if [[ -n "$reason" ]]; then
      echo "사유: $reason"
    fi
    local response
    response="$(api_call POST "/api/admin/update-join" "{\"id\":\"${request_id}\",\"status\":\"${status}\"}")"
    if [[ -n "$response" ]]; then
      echo "적용 완료: ${status}"
    else
      return 1
    fi
    return 0
  fi

  echo -n "승인 즉시 listings 정합성 점검/재처리 실행 [Y/n]: "
  local reconcile_answer
  local run_reconcile="y"
  read -r reconcile_answer
  if [[ "$reconcile_answer" == "n" || "$reconcile_answer" == "N" ]]; then
    run_reconcile="n"
  fi

  if [[ "$run_reconcile" == "y" ]]; then
    reconcile_join_request "$request_id"
  else
    local response
    response="$(api_call POST "/api/admin/update-join" "{\"id\":\"${request_id}\",\"status\":\"${status}\"}")"
    if [[ -n "$response" ]]; then
      echo "적용 완료: ${status}"
      local approved_slug
      local owner_token
      approved_slug="$(extract_json_value "$response" slug)"
      owner_token="$(extract_json_value "$response" ownerToken)"

      if [[ -n "$approved_slug" ]]; then
        echo "  Listing slug: $approved_slug"
      fi

      if [[ -n "$owner_token" ]]; then
        echo "  Owner token: $owner_token"
        echo "  리드 조회 링크: ${BASE_URL}/owner?token=${owner_token}"
      else
        echo "  Owner token: (미생성)"
      fi
    else
      return 1
    fi
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

reconcile_approved_join_requests() {
  local json
  json="$(api_call GET "/api/admin/join-agencies?status=approved")"
  pick_join_requests "$json"

  if (( JOIN_ITEM_COUNT == 0 )); then
    echo "현재 approved 신청이 없습니다."
    return 0
  fi

  echo "[approved 신청 listings 반영 점검/재처리]"
  while IFS=$'\t' read -r idx id name city country platforms priceMin priceMax description; do
    printf "%2s) %-12s %-28s %s / %s (price: %s~%s)\n" "$idx" "${id:0:12}" "$name" "$city/$country" "$priceMin" "$priceMax"
    printf "   Platforms: %s\n" "$platforms"
    printf "   Desc: %s\n" "$description"
  done < "$JOIN_TMP_FILE"

  echo "1) 전체 항목 처리"
  echo "2) 항목 선택"
  echo -n "작업 선택: "
  local run_mode
  read -r run_mode

  local total=0
  local ok=0
  local fail=0

  if [[ "$run_mode" == "1" ]]; then
    while IFS=$'\t' read -r _ request_id req_name req_city req_country _ _ _ _; do
      ((total += 1))
      echo "승인 항목 재처리: $request_id ($req_name / $req_city/$req_country)"
      if reconcile_join_request "$request_id"; then
        ((ok += 1))
      else
        ((fail += 1))
      fi
      echo ""
    done < "$JOIN_TMP_FILE"
  elif [[ "$run_mode" == "2" ]]; then
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

    local selected_line request_id req_name req_city req_country
    selected_line="$(get_nth_line "$choice" "$JOIN_TMP_FILE")"
    IFS=$'\t' read -r _ request_id req_name req_city req_country _ _ _ _ <<< "$selected_line"
    echo "승인 항목 재처리: $request_id ($req_name / $req_city/$req_country)"
    total=1
    if reconcile_join_request "$request_id"; then
      ok=1
    else
      fail=1
    fi
    echo ""
  else
    echo "잘못된 입력입니다."
    return 1
  fi

  echo "요약: 총 ${total}건 / 반영됨 ${ok}건 / 실패 ${fail}건"
}

while true; do
  print_header
  echo "1) 신규 신청(join) 승인/거절"
  echo "2) 기존 목록 verified 토글 (/api/admin/listings)"
  echo "3) approved 목록 listings 반영 점검/재처리"
  echo "4) 종료"
  echo -n "작업 선택: "
  read -r menu

  case "$menu" in
    1)
      approve_join
      ;;
    2)
      approve_listings
      ;;
    3)
      reconcile_approved_join_requests
      ;;
    4|"")
      echo "종료합니다."
      break
      ;;
    *)
      echo "유효하지 않은 메뉴"
      ;;
  esac
  echo ""
done
