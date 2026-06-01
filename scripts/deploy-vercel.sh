#!/usr/bin/env bash
#
# 一键部署 arxiv-radar 到 Vercel
#
# 用法:
#   scripts/deploy-vercel.sh                    # 仅部署（同步环境变量 + 构建）
#   scripts/deploy-vercel.sh --sync-db          # 部署 + 同步本地数据库到远程
#   scripts/deploy-vercel.sh --migrate-only     # 仅运行远程数据库迁移
#
# 前置条件:
#   - vercel CLI 已安装并登录
#   - .env 文件存在（环境变量来源）
#   - 如需 --sync-db: 本地 PostgreSQL 可访问，NEON_DIRECT_URL 已设置
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env"

# ─── 颜色 ──────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

info()  { echo -e "${CYAN}▸${NC} $*"; }
ok()    { echo -e "${GREEN}✔${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
fail()  { echo -e "${RED}✘${NC} $*" >&2; exit 1; }

# ─── 参数解析 ──────────────────────────────────────────
SYNC_DB=false
MIGRATE_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --sync-db)       SYNC_DB=true ;;
    --migrate-only)  MIGRATE_ONLY=true ;;
    -h|--help)
      echo "用法: $0 [--sync-db] [--migrate-only]"
      echo "  --sync-db        部署并同步本地数据库到远程 Neon"
      echo "  --migrate-only   仅运行远程数据库迁移"
      exit 0
      ;;
    *) fail "未知参数: $arg" ;;
  esac
done

# ─── 检查前置条件 ──────────────────────────────────────
command -v vercel >/dev/null 2>&1 || fail "请先安装 vercel CLI: npm i -g vercel"
[ -f "$ENV_FILE" ] || fail ".env 文件不存在: $ENV_FILE"

cd "$PROJECT_DIR"

# ─── 读取 .env 文件 ────────────────────────────────────
get_env() {
  grep "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-
}

# ─── 数据库迁移 ────────────────────────────────────────
run_migration() {
  local db_url="$1"
  info "运行数据库迁移..."
  DATABASE_URL="$db_url" npm run db:migrate
  ok "迁移完成"
}

# ─── 数据库同步 ────────────────────────────────────────
sync_database() {
  local local_url="$1"
  local remote_url="$2"

  info "验证本地数据库连接..."
  psql "$local_url" -c "SELECT 1" >/dev/null 2>&1 || fail "无法连接本地数据库: $local_url"

  info "验证远程数据库连接..."
  psql "$remote_url" -c "SELECT 1" >/dev/null 2>&1 || fail "无法连接远程数据库"

  # FK 依赖顺序：父表在前
  local TABLES="schema_migrations papers users user_settings user_analysis_runs user_analysis_failures user_papers user_favorites user_paper_tags user_conductor_task_bindings"

  info "清空远程数据..."
  psql "$remote_url" -c "TRUNCATE papers, users, schema_migrations CASCADE;" 2>&1 | grep -v NOTICE

  local errors=0
  for t in $TABLES; do
    printf "  导入 %-35s" "$t..."
    err_count=$(pg_dump "$local_url" --data-only --no-owner --no-privileges -t "$t" 2>/dev/null | \
      grep -v "^SET\|^SELECT\|^--\|^$\|ALTER TABLE.*DISABLE\|ALTER TABLE.*ENABLE" | \
      psql "$remote_url" 2>&1 | grep -c "ERROR" || true)
    if [ "$err_count" -eq 0 ]; then
      local count
      count=$(psql -t -A "$remote_url" -c "SELECT count(*) FROM $t" 2>/dev/null)
      echo -e "${GREEN}✔${NC} ($count 行)"
    else
      echo -e "${RED}✘${NC} ($err_count 个错误)"
      errors=$((errors + err_count))
    fi
  done

  if [ "$errors" -gt 0 ]; then
    warn "同步完成，但有 $errors 个错误"
  else
    ok "数据库同步完成，0 个错误"
  fi

  # 验证
  info "数据对比:"
  printf "  %-35s %7s %7s %s\n" "表名" "本地" "远程" ""
  printf "  %-35s %7s %7s %s\n" "---" "----" "----" ""
  for t in $TABLES; do
    local l r match
    l=$(psql -t -A "$local_url" -c "SELECT count(*) FROM $t" 2>/dev/null)
    r=$(psql -t -A "$remote_url" -c "SELECT count(*) FROM $t" 2>/dev/null)
    match="✅"; [ "$l" != "$r" ] && match="❌"
    printf "  %-35s %7s %7s %s\n" "$t" "$l" "$r" "$match"
  done
}

# ─── 同步环境变量到 Vercel ─────────────────────────────
sync_env_vars() {
  info "同步环境变量到 Vercel Production..."

  # 需要从 .env 同步的变量（DATABASE_URL 单独处理）
  local VARS="DEEPSEEK_BASE_URL DEEPSEEK_API_KEY DEEPSEEK_MODEL OPENAI_URL OPENAI_API_KEY OPENAI_MODEL APP_TIME_ZONE ARXIV_LIMIT OPENAI_CONCURRENCY MAX_STORED_PAPERS CONDUCTOR_BASE_URL CONDUCTOR_TOKEN CONDUCTOR_DAEMON_HOST CONDUCTOR_WORKSPACE_PATH CONDUCTOR_APP_NAME CONDUCTOR_BACKEND_TYPE CONDUCTOR_SSO_CLIENT_ID CONDUCTOR_SSO_CLIENT_SECRET ARXIV_AUTH_SECRET"

  local count=0
  for var in $VARS; do
    local val
    val=$(get_env "$var")
    if [ -n "$val" ]; then
      printf '%s' "$val" | vercel env add "$var" production --force >/dev/null 2>&1
      count=$((count + 1))
    fi
  done

  # CRON_SECRET（可能不在 .env 中）
  local cron_secret
  cron_secret=$(get_env "CRON_SECRET")
  if [ -n "$cron_secret" ]; then
    printf '%s' "$cron_secret" | vercel env add CRON_SECRET production --force >/dev/null 2>&1
    count=$((count + 1))
  fi

  ok "已同步 $count 个环境变量"
}

# ─── 设置 APP_URL ──────────────────────────────────────
set_app_url() {
  local app_url="$1"
  info "设置 APP_URL = $app_url"
  printf '%s' "$app_url" | vercel env add APP_URL production --force >/dev/null 2>&1
  ok "APP_URL 已更新"
}

# ─── 设置 DATABASE_URL ────────────────────────────────
set_database_url() {
  local db_url="$1"
  info "设置 DATABASE_URL（Pooler 连接串）..."
  printf '%s' "$db_url" | vercel env add DATABASE_URL production --force >/dev/null 2>&1
  ok "DATABASE_URL 已更新"
}

# ─── 部署 ─────────────────────────────────────────────
deploy() {
  info "部署到 Vercel Production..."
  local output
  output=$(vercel --prod --yes 2>&1 | tail -3)
  echo "$output"
  ok "部署完成"
}

# ─── 验证 ─────────────────────────────────────────────
verify() {
  local base_url="$1"
  info "运行端到端验证..."

  local pass=0 total=0

  check() {
    local name="$1" url="$2" expect="$3"
    total=$((total + 1))
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null)
    if [ "$code" = "$expect" ]; then
      printf "  ${GREEN}✔${NC} %-30s HTTP %s\n" "$name" "$code"
      pass=$((pass + 1))
    else
      printf "  ${RED}✘${NC} %-30s HTTP %s (期望 %s)\n" "$name" "$code" "$expect"
    fi
  }

  check "首页"           "$base_url"                     "200"
  check "SSO 登录跳转"   "$base_url/api/auth/login"      "307"
  check "登录状态"       "$base_url/api/auth/me"         "200"
  check "Papers API"     "$base_url/api/papers"          "401"
  check "Cron 定时任务"  "$base_url/api/cron/arxiv"      "200"

  echo ""
  if [ "$pass" -eq "$total" ]; then
    ok "全部通过 ($pass/$total)"
  else
    warn "部分失败 ($pass/$total)"
  fi
}

# ═══════════════════════════════════════════════════════
#  主流程
# ═══════════════════════════════════════════════════════

echo ""
echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   arxiv-radar Vercel 部署脚本        ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════╝${NC}"
echo ""

# 仅迁移模式
if [ "$MIGRATE_ONLY" = true ]; then
  read -rp "请输入 Neon 直连地址: " NEON_DIRECT
  [ -z "$NEON_DIRECT" ] && fail "直连地址不能为空"
  run_migration "$NEON_DIRECT"
  exit 0
fi

# 完整部署流程
echo -e "${YELLOW}请提供以下信息（首次部署需要，后续可直接回车跳过）：${NC}"
echo ""

read -rp "Neon Pooler 连接串 (DATABASE_URL，回车跳过): " NEON_POOLER
read -rp "Neon 直连地址 (用于迁移/同步，回车跳过): " NEON_DIRECT
read -rp "Vercel 生产域名 (如 https://arxiv-radar.vercel.app，回车跳过): " APP_URL

echo ""

# Step 1: 数据库迁移
if [ -n "$NEON_DIRECT" ]; then
  run_migration "$NEON_DIRECT"
fi

# Step 2: 同步数据库（可选）
if [ "$SYNC_DB" = true ]; then
  LOCAL_DB=$(get_env "DATABASE_URL")
  [ -z "$LOCAL_DB" ] && read -rp "本地数据库连接串: " LOCAL_DB
  [ -z "$LOCAL_DB" ] && fail "本地数据库连接串不能为空"
  [ -z "$NEON_DIRECT" ] && fail "--sync-db 需要提供 Neon 直连地址"
  sync_database "$LOCAL_DB" "$NEON_DIRECT"
fi

# Step 3: 同步环境变量
sync_env_vars

# Step 4: 设置 DATABASE_URL
if [ -n "$NEON_POOLER" ]; then
  set_database_url "$NEON_POOLER"
fi

# Step 5: 设置 APP_URL
if [ -n "$APP_URL" ]; then
  set_app_url "$APP_URL"
fi

# Step 6: 部署
deploy

# Step 7: 验证
VERIFY_URL="${APP_URL:-https://arxiv-radar.vercel.app}"
verify "$VERIFY_URL"

echo ""
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo -e "${GREEN}  部署完成！${NC}"
echo -e "${GREEN}  地址: ${VERIFY_URL}${NC}"
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}提示: 如果是首次部署，请确保 Conductor 端已注册回调地址:${NC}"
echo -e "  ${VERIFY_URL}/api/auth/callback"
echo ""
