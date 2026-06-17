# SOP：部署到 Volc 生产环境

本文档描述如何把 **arxiv-radar**（Next.js 应用，默认 SQLite 后端）部署 / 更新到火山引擎（Volcengine）生产服务器，并把本地数据同步上去。

> 适用对象：有服务器 SSH 私钥的维护者。**本文档不含真实服务器地址 / 私钥**；命令里统一用占位变量 `$SERVER_IP` / `$SSH_KEY` / `$SERVER`，执行前先按 [1.1](#11-设置连接占位变量必做) 设置。

---

## 0. 架构与关键事实

**设计要点**
- 后端由 `DATABASE_URL` 的 scheme 决定：`sqlite:...` 用内嵌文件库（生产默认，无需数据库服务器），`postgres://...` 用 PG。
- `better-sqlite3` 是原生模块，**必须在服务器上按其 node 版本编译**（pnpm 通过 `package.json` 的 `pnpm.onlyBuiltDependencies` 放行构建）。
- 数据库是单个 SQLite 文件，部署自包含；数据迁移 = 拷文件。

**发布铁律（必须遵守）**
> **部署前一定先把本地改动 `commit` + `push` 到远程；服务器只通过 `git fetch` + `git reset --hard origin/main` 同步代码，再构建、重启。绝不绕过 git 直接传代码、也不在服务器上手改代码。** 数据库文件不在 git 里，单独走 [§4](#4-数据库同步local--remote)（用 `scp`）。

---

## 1. 首次部署（全新机器）

> 已经部署过、只是更新代码 → 跳到 [第 2 节](#2-日常更新redeploy)。

### 1.1 设置连接占位变量（必做）
> 本文档**不包含**真实服务器地址与私钥。执行前先按你的实际环境设置以下变量，
> 真实值从**内部凭证管理**获取（不要写回本文档）：
```sh
export SERVER_IP=<服务器IP>            # 生产服务器公网 IP
export SSH_KEY=<SSH私钥路径>           # 例如 ~/path/to/key.pem
export SERVER="root@$SERVER_IP"
```
> 下文所有命令均引用这三个变量。

### 1.2 确认服务器前置条件
```sh
ssh -i $SSH_KEY $SERVER '
  node -v; pnpm -v;
  for t in gcc g++ make python3 nginx certbot git; do printf "%s: " $t; command -v $t || echo MISSING; done
'
```
缺 `gcc/g++/make/python3` 会导致 `better-sqlite3` 编译失败。

### 1.3 拉取代码（git clone）+ 落地数据
> **代码一律走 git**：服务器是仓库的 git 工作副本，靠 `git` 同步，**不绕过 git 传代码**。
> 前置：服务器装了 `git`，且对仓库有只读访问（deploy key 或 token）。`GIT_REPO` = 仓库地址（如 `git@github.com:<org>/<repo>.git`）。

```sh
ssh -i $SSH_KEY $SERVER 'git clone <GIT_REPO> /opt/arxiv-radar && cd /opt/arxiv-radar && git rev-parse --short HEAD'
```
> **目录还不是 git 工作副本时，转成 git（一次性）**：
> ```sh
> ssh -i $SSH_KEY $SERVER '
>   cd /opt/arxiv-radar
>   git init -q && git remote add origin <GIT_REPO>
>   git fetch origin && git reset --hard origin/main   # .env / .runtime 是 gitignored，不受影响
> '
> ```

数据（SQLite 文件**不在 git 里**）单独传，二选一：
```sh
# A) 已有就绪的库：WAL 落盘后用 scp 传这个文件
node -e "const D=require('better-sqlite3');const db=new D('.runtime/arxiv-radar.sqlite');db.pragma('wal_checkpoint(TRUNCATE)');db.close()"
ssh -i $SSH_KEY $SERVER 'mkdir -p /opt/arxiv-radar/.runtime'
scp -i $SSH_KEY .runtime/arxiv-radar.sqlite $SERVER:/opt/arxiv-radar/.runtime/arxiv-radar.sqlite
# B) 全新空库：跳过，下面 1.6 用 pnpm db:migrate 建表
```

### 1.4 配置生产 `.env`
`.env` 不进 git（gitignored，`git clone` 不会带它），需单独落地：先把本地 `.env` 拷过去，再改差异项：
```sh
scp -i $SSH_KEY .env $SERVER:/opt/arxiv-radar/.env
ssh -i $SSH_KEY $SERVER '
  cd /opt/arxiv-radar
  sed -i "s|^APP_URL=.*|APP_URL=https://arxiv-radar.conductor-ai.top|" .env
  # 生产用 SQLite（相对路径相对 WorkingDirectory 解析）
  grep -q "^DATABASE_URL=sqlite:" .env || sed -i "s|^DATABASE_URL=.*|DATABASE_URL=sqlite:.runtime/arxiv-radar.sqlite|" .env
  # 保护 /api/cron/arxiv 不被公网白嫖触发
  grep -q "^CRON_SECRET=" .env || printf "\nCRON_SECRET=%s\n" "$(openssl rand -base64 24)" >> .env
  # cron 白名单（手机号，逗号分隔，* 放开所有；默认 18707151525）
  grep -q "^CRON_WHITELIST=" .env || printf "CRON_WHITELIST=18707151525\n" >> .env
'
```
关键变量：`APP_URL`、`DATABASE_URL`、`CRON_SECRET`、`CRON_WHITELIST`、`OPENAI_*`、`CONDUCTOR_*`、`ARXIV_AUTH_SECRET`。

### 1.5 安装依赖（编译 better-sqlite3）
```sh
ssh -i $SSH_KEY $SERVER '
  cd /opt/arxiv-radar
  pnpm config set registry https://registry.npmjs.org
  pnpm install        # 会按 onlyBuiltDependencies 编译 better-sqlite3
  node -e "new (require(\"better-sqlite3\"))(\".runtime/arxiv-radar.sqlite\",{readonly:true}); console.log(\"sqlite ok\")"
'
```
若提示 `Ignored build scripts: better-sqlite3` → 确认 `package.json` 里有：
```json
"pnpm": { "onlyBuiltDependencies": ["better-sqlite3"] }
```
然后 `pnpm rebuild better-sqlite3`。

### 1.6 建表 / 同步数据
- 全新空库：`pnpm db:migrate`（按 `DATABASE_URL` 自动走 SQLite，建 `db/sqlite/0001_schema.sql`）。
- 从 PostgreSQL 迁数据到 SQLite：`pnpm db:sync-sqlite`（见 [第 4 节](#4-数据库同步local--remote)）。
- 直接上传本地已就绪的 `.sqlite`（1.3 已做）：跳过。

### 1.7 构建
**构建在服务器上跑，且建议 detached**，避免 SSH 掉线打断（本机器出现过 sshd 在长会话中断连）：
```sh
ssh -i $SSH_KEY $SERVER '
  cd /opt/arxiv-radar
  nohup sh -c "pnpm build >/tmp/arxiv_build.log 2>&1 && echo BUILD_OK >>/tmp/arxiv_build.log || echo BUILD_FAIL >>/tmp/arxiv_build.log" >/dev/null 2>&1 &
  echo "build pid $!"
'
# 轮询直到结束
until ssh -i $SSH_KEY $SERVER 'grep -qE "BUILD_OK|BUILD_FAIL" /tmp/arxiv_build.log'; do sleep 20; done
ssh -i $SSH_KEY $SERVER 'tail -3 /tmp/arxiv_build.log'
```

### 1.8 systemd 服务
`next start` 的真实入口是 `node_modules/next/dist/bin/next`（`.bin/next` 是 shell shim，不能 `node` 它）。
```sh
ssh -i $SSH_KEY $SERVER 'cat > /etc/systemd/system/arxiv-radar.service <<"UNIT"
[Unit]
Description=arxiv-radar Next.js app
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/arxiv-radar
Environment=NODE_ENV=production
Environment=PATH=/usr/bin:/bin
ExecStart=/usr/bin/node /opt/arxiv-radar/node_modules/next/dist/bin/next start -p 6160 -H 127.0.0.1
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now arxiv-radar.service
sleep 4; systemctl is-active arxiv-radar.service
curl -s -o /dev/null -w "local 6160 -> %{http_code}\n" http://127.0.0.1:6160/'
```

### 1.9 nginx 反向代理
```sh
ssh -i $SSH_KEY $SERVER 'cat > /etc/nginx/sites-available/arxiv-radar <<"NGINX"
map $http_upgrade $arxiv_connection_upgrade { default upgrade; "" close; }

server {
  listen 80;
  server_name arxiv-radar.conductor-ai.top;
  client_max_body_size 20m;

  location /_next/static/ {
    alias /opt/arxiv-radar/.next/static/;
    expires 1y; access_log off;
    add_header Cache-Control "public, immutable";
  }
  location / {
    proxy_pass http://127.0.0.1:6160;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $arxiv_connection_upgrade;
    proxy_read_timeout 86400;
    proxy_cache_bypass 1; proxy_no_cache 1;
  }
}
NGINX
ln -sf /etc/nginx/sites-available/arxiv-radar /etc/nginx/sites-enabled/arxiv-radar
nginx -t && systemctl reload nginx'
```

### 1.10 DNS（Volcengine 控制台 / 手动）
本地无 Volcengine API 凭证，**A 记录需在控制台改**：
- 进 Volcengine DNS 控制台 → `conductor-ai.top` → 把 `arxiv-radar` 的 **A 记录指向 `$SERVER_IP`**（删掉旧的，如指向 Vercel 的 `76.76.21.21`）。
- 校验（权威 NS 立刻生效，公共缓存按 TTL）：
```sh
dig +short @vip1.volcengine-dns.com arxiv-radar.conductor-ai.top   # 期望 $SERVER_IP
dig +short @223.5.5.5 arxiv-radar.conductor-ai.top
```

### 1.11 TLS 证书
DNS 指向服务器后（certbot 走权威解析，权威生效即可签，不必等公共缓存）：
```sh
ssh -i $SSH_KEY $SERVER '
  certbot --nginx -d arxiv-radar.conductor-ai.top --non-interactive --redirect --keep-until-expiring'
```
> 复用已有 certbot 账户；自动加 443 server 块 + HTTP→HTTPS 跳转 + 自动续期 timer。

### 1.12 每日定时抓取（cron）
应用本身不自触发，需外部周期性调 `/api/cron/arxiv`。用带鉴权的包装脚本 + root crontab：
```sh
ssh -i $SSH_KEY $SERVER 'cat > /opt/arxiv-radar/scripts/cron-trigger.sh <<"SH"
#!/bin/sh
SECRET=$(grep "^CRON_SECRET=" /opt/arxiv-radar/.env | cut -d= -f2-)
code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $SECRET" "http://127.0.0.1:6160/api/cron/arxiv?limit=100")
echo "[$(date -Is)] http=$code" >> /opt/arxiv-radar/.runtime/cron-arxiv.log
SH
chmod +x /opt/arxiv-radar/scripts/cron-trigger.sh
# 每天 09:30 / 21:30（服务器时区 = 北京时间 CST）。保留已有 conductor 行。
( crontab -l 2>/dev/null | grep -v "cron-trigger.sh"; echo "30 9,21 * * * /opt/arxiv-radar/scripts/cron-trigger.sh" ) | crontab -
crontab -l | grep -v "^#"'
```
> 触发是**全局单点**：一次调用会循环处理所有 `cron_enabled=1` 的用户（用各自的 `arxivDailyUrl` 抓取、各自去重）。当前应用**不按各用户的 `cron_local_time` 分时触发**。频率够用的依据：arxiv 工作日每天公告一批；recent 页保留 ~5 天 + 去重，单次失败会被后续任务自愈。

### 1.13 验收
```sh
H=arxiv-radar.conductor-ai.top
curl -s -o /dev/null -w "http  -> %{http_code} (->%{redirect_url})\n" --resolve $H:80:$SERVER_IP  http://$H/
curl -s -o /dev/null -w "https -> %{http_code}\n"                     --resolve $H:443:$SERVER_IP https://$H/
curl -s --resolve $H:443:$SERVER_IP https://$H/ | grep -oiE "<title>[^<]*</title>"
```

---

## 2. 日常更新（redeploy）

**发布铁律：先 `commit` + `push`，服务器只 `git` 拉取，绝不绕过 git 传代码。** 数据库文件另走 [§4](#4-数据库同步local--remote)（`scp`）。顺序固定：自检 → 提交推送 → 服务器拉取 → 构建 → 重启 → 验收。

```sh
# 0) 本地：自检（不过不部署）
npx tsc --noEmit && npm run build

# 1) 本地：提交并推送（部署前必做，否则服务器拉不到改动）
git add -A                                   # 或按需选择性 add
git commit -m "feat: ..."                    # 有意义的提交信息
git push origin main

# 2) 服务器：拉取到与远程完全一致
#    用 reset --hard 而非 pull：避免服务器上任何意外改动导致冲突；tracked 文件以远程为准。
#    .env / .runtime（gitignored）和 scripts/cron-trigger.sh（未跟踪）都会保留。
ssh -i $SSH_KEY $SERVER '
  cd /opt/arxiv-radar
  git fetch origin && git reset --hard origin/main
  echo "HEAD -> $(git rev-parse --short HEAD)"'

# 3) 服务器：装依赖（有依赖变化时）+ detached 构建（detached 防 SSH 掉线打断）
ssh -i $SSH_KEY $SERVER '
  cd /opt/arxiv-radar
  nohup sh -c "pnpm install >/tmp/arxiv_build.log 2>&1 && pnpm build >>/tmp/arxiv_build.log 2>&1 && echo BUILD_OK >>/tmp/arxiv_build.log || echo BUILD_FAIL >>/tmp/arxiv_build.log" >/dev/null 2>&1 &
  echo started'

# 4) 等构建完成
until ssh -i $SSH_KEY $SERVER 'grep -qE "BUILD_OK|BUILD_FAIL" /tmp/arxiv_build.log'; do sleep 20; done
ssh -i $SSH_KEY $SERVER 'tail -3 /tmp/arxiv_build.log'

# 5) 构建 OK 才重启
ssh -i $SSH_KEY $SERVER '
  grep -q BUILD_OK /tmp/arxiv_build.log && systemctl restart arxiv-radar.service && sleep 4 && systemctl is-active arxiv-radar.service'

# 6) 验收：HTTP 200 + 线上 commit == 刚推的 commit
curl -s -o /dev/null -w "https -> %{http_code}\n" --resolve arxiv-radar.conductor-ai.top:443:$SERVER_IP https://arxiv-radar.conductor-ai.top/
echo "local  HEAD: $(git rev-parse --short HEAD)"
ssh -i $SSH_KEY $SERVER 'echo "server HEAD: $(git -C /opt/arxiv-radar rev-parse --short HEAD)"'
```

> - 有 schema 变更时，第 5 步重启前先在服务器 `pnpm db:migrate`（迁移文件 `IF NOT EXISTS`，幂等）。
> - 没改依赖时第 3 步可省 `pnpm install`，只 `pnpm build`，更快。
> - 服务器若把 `scripts/cron-trigger.sh` 纳入了 git（tracked），`reset --hard` 会按仓库版本覆盖它；当前它是**未跟踪**的服务器本地文件，会被保留。

---

## 3. 数据库迁移（PostgreSQL → SQLite，首次切换用）

仅在从 PG 切到 SQLite 时需要（本项目已完成，留作参考）。
```sh
# 本地：把 PG 数据导入本地 SQLite 文件（FK 顺序、可重复跑）
npm run db:sync-sqlite      # scripts/pg-to-sqlite.mjs，默认源=本地 PG，目标=.runtime/arxiv-radar.sqlite
# 逐表核对行数后再上线
```

---

## 4. 数据库同步（local → remote）

把本地处理好的 SQLite 覆盖到生产（如批量补抓后）。**务必先停服务 + 备份**，避免覆盖期写冲突 / 误删数据。

```sh
# 1) 本地：WAL 落盘
node -e "const D=require('better-sqlite3');const db=new D('.runtime/arxiv-radar.sqlite');db.pragma('wal_checkpoint(TRUNCATE)');db.close()"

# 2) 远端：停服务 + 备份 + 清理 wal/shm
ssh -i $SSH_KEY $SERVER '
  cd /opt/arxiv-radar
  systemctl stop arxiv-radar.service
  cp .runtime/arxiv-radar.sqlite .runtime/arxiv-radar.sqlite.bak-$(date +%Y%m%d-%H%M%S)
  rm -f .runtime/arxiv-radar.sqlite-wal .runtime/arxiv-radar.sqlite-shm'

# 3) 覆盖
scp -i $SSH_KEY .runtime/arxiv-radar.sqlite $SERVER:/opt/arxiv-radar/.runtime/arxiv-radar.sqlite

# 4) 启服务 + 核对行数
ssh -i $SSH_KEY $SERVER '
  cd /opt/arxiv-radar
  systemctl start arxiv-radar.service; sleep 4; systemctl is-active arxiv-radar.service
  node -e "const D=require(\"better-sqlite3\");const db=new D(\".runtime/arxiv-radar.sqlite\",{readonly:true});console.log(\"papers:\",db.prepare(\"select count(*) c from papers\").get().c)"'
```

> 反向（remote → local 拉生产数据）：把上面 scp 的源/目标对调，本地先备份。

---

## 5. 运维速查

**查看日志 / 状态**
```sh
ssh ... 'systemctl status arxiv-radar --no-pager'
ssh ... 'journalctl -u arxiv-radar -n 50 --no-pager'   # 应用报错
ssh ... 'tail -20 /opt/arxiv-radar/.runtime/cron-arxiv.log'   # cron 触发记录
```

**手动触发一次抓取**
```sh
ssh ... '/opt/arxiv-radar/scripts/cron-trigger.sh; tail -1 /opt/arxiv-radar/.runtime/cron-arxiv.log'
```

**回滚**
- 代码：服务器上 `git reset --hard <旧commit或tag>` → 重新构建（§2 第 3-5 步）→ 重启。或本地 revert 后再 commit+push+拉取。
- 数据：用 `.runtime/arxiv-radar.sqlite.bak-<ts>` 覆盖回去（停服务→拷贝→启服务）。

**证书续期**：certbot timer 自动续；手动 `ssh ... 'certbot renew --dry-run'`。

---

## 6. 常见坑

| 现象 | 原因 / 处理 |
|---|---|
| `SyntaxError: missing ) after argument list`（service 起不来） | ExecStart 错指了 `.bin/next`（shell shim）。必须用 `node_modules/next/dist/bin/next`。 |
| `Could not locate the bindings file`（better-sqlite3） | 原生模块没编译。确认 `pnpm.onlyBuiltDependencies` 含 `better-sqlite3`，再 `pnpm rebuild better-sqlite3`。 |
| SSH 长会话中途 `Connection closed by ... port 22` | 本机器偶发。构建/长任务一律 `nohup` detached 跑，再轮询日志；别把 build 放在交互式 SSH 里。 |
| 公网仍解析到旧 IP | 公共 DNS 缓存未过期；权威/`223.5.5.5` 已生效即可。证书签发不受影响（走权威）。 |
| `/api/cron/arxiv` 被公网随意触发 | `.env` 未设 `CRON_SECRET`。设上并重启；cron 用 `cron-trigger.sh` 带 Bearer 调用。 |
| 非白名单用户也跑了 cron | 见 `src/lib/cron-access.ts`；`CRON_WHITELIST`（手机号）控制，应用按尾号匹配。 |
| 部署后线上还是旧代码 | 本地改动没 `commit`/`push` 就部署，服务器 `git` 拉不到。**铁律：先 commit + push**；§2 第 6 步用 `git rev-parse HEAD` 核对 local==server。 |
| 服务器 `git pull` 冲突 / 拉不动 | 服务器上别手改 tracked 文件。用 `git fetch && git reset --hard origin/main`（`.env`/`.runtime` gitignored、`cron-trigger.sh` 未跟踪，都不受影响）。 |
| `.env` / `cron-trigger.sh` 部署后丢了 | 不会：git 只动 tracked 文件，gitignored 与未跟踪文件不受 `reset --hard` 影响。首次 clone 后记得按 §1.4 落地 `.env`、§1.12 建 `cron-trigger.sh`。 |

---

## 7. 涉及文件 / 命令索引

- 应用 DB 层：`src/lib/db/{index,sqlite,postgres}.ts`
- SQLite schema：`db/sqlite/0001_schema.sql`；迁移脚本：`scripts/db-migrate.mjs`
- PG→SQLite 迁移：`scripts/pg-to-sqlite.mjs`（`npm run db:sync-sqlite`）
- 批量补抓：`scripts/backfill-arxiv.mts`（`tsx scripts/backfill-arxiv.mts --user <id> --month YYYY-MM`）
- cron 白名单：`src/lib/cron-access.ts`，环境变量 `CRON_WHITELIST`
- cron 触发器（远端）：`/opt/arxiv-radar/scripts/cron-trigger.sh` + root crontab
- nginx 站点：`/etc/nginx/sites-available/arxiv-radar`
- systemd：`/etc/systemd/system/arxiv-radar.service`
