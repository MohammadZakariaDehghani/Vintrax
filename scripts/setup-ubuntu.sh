#!/usr/bin/env bash
#
# Atlas — one command from a bare Ubuntu server to a running platform.
#
# Installs Node.js, pnpm, PostgreSQL and Redis, provisions the database,
# writes environment files with generated secrets, installs dependencies,
# applies migrations, seeds demo data, builds both applications and starts
# them.
#
#   ./scripts/setup-ubuntu.sh                        install, build, run
#   ./scripts/setup-ubuntu.sh --mode dev             run the dev servers
#   ./scripts/setup-ubuntu.sh --systemd              run under systemd
#   ./scripts/setup-ubuntu.sh --no-start             set up only
#   ./scripts/setup-ubuntu.sh --help                 every option
#
# Re-running is safe. Every step checks for the state it is about to create,
# and an existing .env is never overwritten — its secrets and database
# password are reused so a second run does not lock the platform out of its
# own database.
#
set -Eeuo pipefail

# --- What we install when the machine does not already have it -------------

readonly NODE_INSTALL_MAJOR=22   # CI runs 22; the workspace requires >= 20.11
readonly NODE_MIN_MAJOR=20
readonly NODE_MIN_MINOR=11
readonly POSTGRES_INSTALL_MAJOR=16
readonly POSTGRES_MIN_MAJOR=14   # generated columns and websearch_to_tsquery
readonly REDIS_MIN_MAJOR=6       # BullMQ needs 5; 7 is what production uses

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
readonly REPO_ROOT

# --- Settings, all overridable from the environment ------------------------

DB_NAME=${ATLAS_DB_NAME:-atlas}
DB_USER=${ATLAS_DB_USER:-atlas}
DB_HOST=${ATLAS_DB_HOST:-localhost}
DB_PORT=${ATLAS_DB_PORT:-5432}
DB_PASSWORD=${ATLAS_DB_PASSWORD:-}
API_PORT=${ATLAS_API_PORT:-3001}
WEB_PORT=${ATLAS_WEB_PORT:-3000}
MOBILE_PORT=${ATLAS_MOBILE_PORT:-3002}
PUBLIC_URL=${ATLAS_PUBLIC_URL:-}
API_URL=${ATLAS_API_URL:-}
MOBILE_URL=

MODE=production
SKIP_SYSTEM=false
RUN_SEED=true
START=true
USE_SYSTEMD=false

APT_UPDATED=false
ENV_FILE="${REPO_ROOT}/.env"
WEB_ENV_FILE="${REPO_ROOT}/frontend/.env.local"
MOBILE_ENV_FILE="${REPO_ROOT}/mobile/.env.local"

# --- Output ----------------------------------------------------------------

if [[ -t 1 ]]; then
  readonly C_RESET=$'\033[0m' C_BOLD=$'\033[1m' C_DIM=$'\033[2m'
  readonly C_BLUE=$'\033[34m' C_GREEN=$'\033[32m' C_YELLOW=$'\033[33m' C_RED=$'\033[31m'
else
  readonly C_RESET='' C_BOLD='' C_DIM='' C_BLUE='' C_GREEN='' C_YELLOW='' C_RED=''
fi

step() { printf '\n%s==>%s %s%s%s\n' "${C_BLUE}" "${C_RESET}" "${C_BOLD}" "$*" "${C_RESET}"; }
info() { printf '    %s\n' "$*"; }
skip() { printf '    %s%s%s\n' "${C_DIM}" "$*" "${C_RESET}"; }
ok()   { printf '    %s✓%s %s\n' "${C_GREEN}" "${C_RESET}" "$*"; }
warn() { printf '    %s!%s %s\n' "${C_YELLOW}" "${C_RESET}" "$*" >&2; }
die()  { printf '\n%serror:%s %s\n' "${C_RED}" "${C_RESET}" "$*" >&2; exit 1; }

# Report which step failed rather than leaving the reader to guess from the
# last line of a subcommand's output.
trap 'die "failed at line ${LINENO}: ${BASH_COMMAND}"' ERR

usage() {
  cat <<'USAGE'
Atlas setup for Ubuntu.

Usage: ./scripts/setup-ubuntu.sh [options]

Options:
  --mode dev|production   Development servers with hot reload, or a production
                          build. Default: production.
  --skip-system           Do not touch apt. Use when Node, PostgreSQL and Redis
                          are already installed, or in a container.
  --no-seed               Do not load demo data. Use for a real deployment.
  --no-start              Set everything up but do not start the platform.
  --systemd               Install and enable systemd units instead of running
                          in the foreground. Implies --mode production.
  -h, --help              This message.

Environment overrides:
  ATLAS_DB_NAME           Database name.               Default: atlas
  ATLAS_DB_USER           Database role.               Default: atlas
  ATLAS_DB_PASSWORD       Database password.           Default: generated
  ATLAS_DB_HOST           Database host.               Default: localhost
  ATLAS_DB_PORT           Database port.               Default: 5432
  ATLAS_API_PORT          API port.                    Default: 3001
  ATLAS_WEB_PORT          Web port.                    Default: 3000
  ATLAS_MOBILE_PORT       Atlas Mobile port.           Default: 3002
  ATLAS_PUBLIC_URL        Browser-facing web URL.      Default: http://localhost:3000
  ATLAS_API_URL           Browser-facing API URL.      Default: derived from ATLAS_PUBLIC_URL

On a server reachable by hostname or address, set ATLAS_PUBLIC_URL — it becomes
the CORS allowlist, the links in outgoing email, and the WebSocket origin the
browser bundle is compiled against.

  ATLAS_PUBLIC_URL=http://203.0.113.10:3000 ./scripts/setup-ubuntu.sh
USAGE
}

# --- Argument parsing ------------------------------------------------------

while [[ $# -gt 0 ]]; do
  case $1 in
    --mode)
      [[ $# -ge 2 ]] || die "--mode needs a value: dev or production"
      MODE=$2
      [[ $MODE == dev || $MODE == production ]] || die "--mode must be dev or production, got '${MODE}'"
      shift 2
      ;;
    --mode=*)
      MODE=${1#*=}
      [[ $MODE == dev || $MODE == production ]] || die "--mode must be dev or production, got '${MODE}'"
      shift
      ;;
    --skip-system) SKIP_SYSTEM=true; shift ;;
    --no-seed)     RUN_SEED=false; shift ;;
    --no-start)    START=false; shift ;;
    --systemd)     USE_SYSTEMD=true; MODE=production; shift ;;
    -h|--help)     usage; exit 0 ;;
    *)             usage >&2; die "unknown option: $1" ;;
  esac
done

# --- Small helpers ---------------------------------------------------------

have() { command -v "$1" >/dev/null 2>&1; }

# Elevate only when we are not already root. A server admin running this under
# their own account gets one sudo prompt at the first system change.
as_root() {
  if [[ $EUID -eq 0 ]]; then
    "$@"
  elif have sudo; then
    sudo "$@"
  else
    die "this step needs root and sudo is not installed: $*"
  fi
}

# systemd is present on an Ubuntu server and absent in most containers, which
# is why every service action goes through here.
has_systemd() { [[ -d /run/systemd/system ]]; }

start_service() {
  local unit=$1
  if has_systemd; then
    as_root systemctl enable --now "$unit" >/dev/null
  else
    as_root service "$unit" start >/dev/null 2>&1 || true
  fi
}

apt_update_once() {
  if [[ $APT_UPDATED == false ]]; then
    as_root env DEBIAN_FRONTEND=noninteractive apt-get update -qq
    APT_UPDATED=true
  fi
}

apt_install() {
  apt_update_once
  as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "$@"
}

# Adds a signed apt repository. Keyrings rather than the deprecated apt-key,
# and no piping a remote script into a shell.
add_apt_repo() {
  local name=$1 key_url=$2 repo_line=$3
  local keyring="/usr/share/keyrings/${name}.gpg"

  if [[ ! -s $keyring ]]; then
    info "adding the ${name} apt repository"
    curl -fsSL "$key_url" | as_root gpg --dearmor --yes -o "$keyring"
    as_root chmod 0644 "$keyring"
  fi

  printf 'deb [signed-by=%s] %s\n' "$keyring" "$repo_line" |
    as_root tee "/etc/apt/sources.list.d/${name}.list" >/dev/null
  APT_UPDATED=false
}

# psql as the postgres superuser, reading SQL from stdin. Both branches keep
# stdin, and the cd avoids the "could not change directory" warning when root
# runs su from a directory postgres cannot read.
psql_super() {
  local db=${1:-postgres}
  if [[ $EUID -eq 0 ]]; then
    ( cd /tmp && su postgres -c "psql --quiet -v ON_ERROR_STOP=1 -d '${db}'" )
  else
    ( cd /tmp && sudo -u postgres psql --quiet -v ON_ERROR_STOP=1 -d "$db" )
  fi
}

# Prints the first version-looking token, or nothing. Never fails, so callers
# check for an empty string rather than an exit status.
version_of() {
  have "$1" || return 0
  "$1" --version 2>/dev/null | grep -oE '[0-9]+(\.[0-9]+)+' | head -1
}
major_of()   { printf '%s' "${1%%.*}"; }
minor_of()   { local rest=${1#*.}; printf '%s' "${rest%%.*}"; }

# --- Preflight -------------------------------------------------------------

preflight() {
  step "Checking the machine"

  [[ ${BASH_VERSINFO[0]} -ge 4 ]] || die "bash 4 or newer is required"

  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    if [[ ${ID:-} == ubuntu ]]; then
      ok "Ubuntu ${VERSION_ID:-unknown} (${VERSION_CODENAME:-unknown})"
    elif [[ ${ID_LIKE:-} == *debian* ]]; then
      warn "${PRETTY_NAME:-this system} is Debian-like but not Ubuntu — apt steps may differ"
    else
      die "this script targets Ubuntu; ${PRETTY_NAME:-this system} is not supported"
    fi
  else
    die "cannot identify the operating system: /etc/os-release is missing"
  fi

  [[ -f "${REPO_ROOT}/pnpm-workspace.yaml" ]] ||
    die "run this from a checkout of the Atlas repository (looked in ${REPO_ROOT})"

  # Identifiers are interpolated into SQL, so they are constrained rather than
  # escaped — a name outside this set is a mistake, not something to quote.
  [[ $DB_NAME =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die "invalid database name: ${DB_NAME}"
  [[ $DB_USER =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die "invalid database user: ${DB_USER}"
  [[ $API_PORT =~ ^[0-9]+$ && $WEB_PORT =~ ^[0-9]+$ && $MOBILE_PORT =~ ^[0-9]+$ ]] ||
    die "ports must be numeric"

  PUBLIC_URL=${PUBLIC_URL:-http://localhost:${WEB_PORT}}
  PUBLIC_URL=${PUBLIC_URL%/}

  # The browser talks to the API directly for WebSockets, so it needs an
  # address that resolves from the browser, not from the server.
  if [[ -z $API_URL ]]; then
    if [[ $PUBLIC_URL =~ ^(https?)://([^/:]+) ]]; then
      API_URL="${BASH_REMATCH[1]}://${BASH_REMATCH[2]}:${API_PORT}"
    else
      die "ATLAS_PUBLIC_URL must look like http://host[:port], got '${PUBLIC_URL}'"
    fi
  fi
  API_URL=${API_URL%/}

  if [[ $PUBLIC_URL =~ ^(https?)://([^/:]+) ]]; then
    MOBILE_URL="${BASH_REMATCH[1]}://${BASH_REMATCH[2]}:${MOBILE_PORT}"
  else
    MOBILE_URL="http://localhost:${MOBILE_PORT}"
  fi

  info "mode:      ${MODE}"
  info "web:       ${PUBLIC_URL} (port ${WEB_PORT})"
  info "mobile:    ${MOBILE_URL} (port ${MOBILE_PORT})"
  info "api:       ${API_URL} (port ${API_PORT})"
  info "database:  ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
}

# --- System packages -------------------------------------------------------

install_base_packages() {
  step "Installing base packages"
  local missing=()
  have curl || missing+=(curl)
  have gpg || missing+=(gnupg)
  have git || missing+=(git)
  have openssl || missing+=(openssl)
  [[ -s /etc/ssl/certs/ca-certificates.crt ]] || missing+=(ca-certificates)

  if [[ ${#missing[@]} -eq 0 ]]; then
    skip "curl, gnupg, git, openssl and CA certificates are present"
  else
    info "installing: ${missing[*]}"
    apt_install "${missing[@]}"
    ok "base packages installed"
  fi

  # node-gyp builds native modules if a prebuilt binary is missing for this
  # platform. Cheap insurance against an install that fails at the last step.
  if ! have cc && ! have gcc; then
    info "installing build-essential for native module compilation"
    apt_install build-essential python3
  fi
}

node_is_new_enough() {
  have node || return 1
  local version major minor
  version=$(version_of node)
  [[ -n $version ]] || return 1
  major=$(major_of "$version")
  minor=$(minor_of "$version")
  (( major > NODE_MIN_MAJOR )) && return 0
  (( major == NODE_MIN_MAJOR && minor >= NODE_MIN_MINOR ))
}

install_node() {
  step "Installing Node.js"

  if node_is_new_enough; then
    skip "Node $(version_of node) already satisfies >= ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR}"
  else
    if have node; then
      info "Node $(version_of node) is older than ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR} — installing ${NODE_INSTALL_MAJOR}.x"
    else
      info "installing Node ${NODE_INSTALL_MAJOR}.x"
    fi
    add_apt_repo nodesource \
      "https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key" \
      "https://deb.nodesource.com/node_${NODE_INSTALL_MAJOR}.x nodistro main"
    apt_install nodejs
    ok "Node $(version_of node) installed"
  fi
}

install_pnpm() {
  step "Enabling pnpm"

  # corepack ships with Node and reads the pinned version from
  # package.json#packageManager, so the whole team runs the same pnpm.
  if have corepack; then
    as_root corepack enable >/dev/null 2>&1 || corepack enable >/dev/null 2>&1 || true
  fi

  if have pnpm; then
    ok "pnpm $(pnpm --version) available"
  elif have corepack; then
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack prepare --activate >/dev/null
    have pnpm || die "corepack did not put pnpm on PATH; open a new shell and re-run"
    ok "pnpm $(pnpm --version) activated through corepack"
  else
    die "neither pnpm nor corepack is available — install Node ${NODE_INSTALL_MAJOR} and re-run"
  fi
}

install_postgres() {
  step "Installing PostgreSQL"

  if have psql; then
    local version major
    version=$(version_of psql)
    major=$(major_of "${version:-0}")
    if (( major >= POSTGRES_MIN_MAJOR )); then
      skip "PostgreSQL client ${version} already installed"
      (( major < POSTGRES_INSTALL_MAJOR )) &&
        warn "PostgreSQL ${major} works, but ${POSTGRES_INSTALL_MAJOR} is what CI and production use"
      start_service postgresql
      return
    fi
    warn "PostgreSQL ${version} is older than ${POSTGRES_MIN_MAJOR}, which cannot run these migrations"
  fi

  # Ubuntu 24.04 carries PostgreSQL 16; older releases need the PGDG archive.
  apt_update_once
  if ! apt-cache policy "postgresql-${POSTGRES_INSTALL_MAJOR}" 2>/dev/null | grep -q 'Candidate: [0-9]'; then
    local codename
    # shellcheck disable=SC1091
    codename=$(. /etc/os-release && printf '%s' "${VERSION_CODENAME:-}")
    [[ -n $codename ]] || die "cannot determine the Ubuntu codename for the PostgreSQL archive"
    add_apt_repo pgdg \
      "https://www.postgresql.org/media/keys/ACCC4CF8.asc" \
      "https://apt.postgresql.org/pub/repos/apt ${codename}-pgdg main"
  fi

  info "installing postgresql-${POSTGRES_INSTALL_MAJOR}"
  apt_install "postgresql-${POSTGRES_INSTALL_MAJOR}" "postgresql-contrib-${POSTGRES_INSTALL_MAJOR}"
  start_service postgresql
  ok "PostgreSQL $(version_of psql) installed"
}

install_redis() {
  step "Installing Redis"

  if have redis-server || have redis-cli; then
    local version major
    version=$(version_of redis-cli)
    major=$(major_of "${version:-0}")
    if (( major >= REDIS_MIN_MAJOR )); then
      skip "Redis ${version} already installed"
      (( major < 7 )) && warn "Redis ${major} works, but production runs 7"
      start_service redis-server
      return
    fi
    warn "Redis ${version} is older than ${REDIS_MIN_MAJOR} — installing a newer package"
  fi

  info "installing redis-server"
  apt_install redis-server
  start_service redis-server
  ok "Redis $(version_of redis-cli) installed"
}

# --- Services --------------------------------------------------------------

wait_for_postgres() {
  for _ in {1..30}; do
    if pg_isready -h "$DB_HOST" -p "$DB_PORT" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

ensure_services_running() {
  step "Starting PostgreSQL and Redis"

  if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" >/dev/null 2>&1; then
    start_service postgresql
    wait_for_postgres || die "PostgreSQL is not accepting connections on ${DB_HOST}:${DB_PORT}"
  fi
  ok "PostgreSQL accepting connections on ${DB_HOST}:${DB_PORT}"

  if have redis-cli && ! redis-cli ping >/dev/null 2>&1; then
    start_service redis-server
    sleep 1
  fi
  if have redis-cli && redis-cli ping >/dev/null 2>&1; then
    ok "Redis responding"
  else
    # The queue driver falls back to in-process execution, so this is a
    # degraded start rather than a failed one.
    warn "Redis is not responding — set QUEUE_DRIVER=inline in .env to run without it"
  fi
}

# --- Database --------------------------------------------------------------

provision_database() {
  step "Provisioning the database"

  local password_sql=${DB_PASSWORD//\'/\'\'}

  if psql_super postgres <<SQL >/dev/null
DO \$do\$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    ALTER ROLE ${DB_USER} WITH LOGIN PASSWORD '${password_sql}';
  ELSE
    CREATE ROLE ${DB_USER} WITH LOGIN PASSWORD '${password_sql}';
  END IF;
END
\$do\$;

SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}'
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}')\gexec
SQL
  then
    ok "role ${DB_USER} and database ${DB_NAME} ready"
  else
    die "could not provision the database as the postgres superuser"
  fi

  # pg_trgm backs the fuzzy-search fallback. The migration creates it too, but
  # doing it here as superuser means the migration never needs that privilege.
  psql_super "$DB_NAME" <<SQL >/dev/null
CREATE EXTENSION IF NOT EXISTS pg_trgm;
GRANT ALL ON SCHEMA public TO ${DB_USER};
SQL
  ok "pg_trgm enabled and schema granted"
}

# --- Environment files -----------------------------------------------------

# Rewrites KEY=value in place, or appends it when the key is absent. The
# delimiter is | and the escape covers what a generated secret or URL can
# contain.
set_env_var() {
  local file=$1 key=$2 value=$3 escaped
  escaped=$(printf '%s' "$value" | sed -e 's/[|&\\]/\\&/g')
  if grep -qE "^#?[[:space:]]*${key}=" "$file"; then
    sed -i -E "s|^#?[[:space:]]*${key}=.*|${key}=\"${escaped}\"|" "$file"
  else
    printf '%s="%s"\n' "$key" "$value" >>"$file"
  fi
}

read_env_var() {
  local file=$1 key=$2 line
  line=$(grep -E "^[[:space:]]*${key}=" "$file" | tail -1) || return 1
  line=${line#*=}
  line=${line%\"}
  line=${line#\"}
  printf '%s' "$line"
}

write_env_files() {
  step "Writing environment files"

  if [[ -f $ENV_FILE ]]; then
    # Overwriting would rotate the JWT secrets, signing every issued token
    # out, and would desynchronise the database password from the role.
    skip ".env exists — keeping its secrets and database password"

    # One targeted exception to leaving an existing .env alone: adding the
    # mobile origins to the CORS allowlist. Without them the API refuses the
    # WebSocket handshake and live bidding silently degrades to polling — and
    # unlike a secret, an added origin breaks nothing that already worked.
    local existing_origins
    if existing_origins=$(read_env_var "$ENV_FILE" CORS_ORIGINS) && [[ -n $existing_origins ]]; then
      local missing=()
      local origin
      for origin in "http://localhost:${MOBILE_PORT}" "http://127.0.0.1:${MOBILE_PORT}" "$MOBILE_URL"; do
        case ",${existing_origins}," in
          *",${origin},"*) ;;
          *) missing+=("$origin") ;;
        esac
      done
      if [[ ${#missing[@]} -gt 0 ]]; then
        local joined
        joined=$(printf '%s\n' "${missing[@]}" | awk '!seen[$0]++' | paste -sd,)
        set_env_var "$ENV_FILE" CORS_ORIGINS "${existing_origins},${joined}"
        ok "added the Atlas Mobile origins to CORS_ORIGINS"
      fi
    fi

    local existing_url
    if existing_url=$(read_env_var "$ENV_FILE" DATABASE_URL) && [[ -n $existing_url ]]; then
      if [[ $existing_url =~ ^postgresql://([^:]+):([^@]*)@([^:/]+):([0-9]+)/([^?]+) ]]; then
        DB_USER=${BASH_REMATCH[1]}
        DB_PASSWORD=${BASH_REMATCH[2]}
        DB_HOST=${BASH_REMATCH[3]}
        DB_PORT=${BASH_REMATCH[4]}
        DB_NAME=${BASH_REMATCH[5]}
        info "using the database in DATABASE_URL: ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
      else
        warn "DATABASE_URL in .env is not a postgresql:// URL — leaving it alone"
      fi
    fi
  else
    [[ -f "${REPO_ROOT}/.env.example" ]] || die ".env.example is missing from the repository"
    cp "${REPO_ROOT}/.env.example" "$ENV_FILE"

    # Hex rather than base64: no characters that need escaping in a URL, a
    # sed replacement or a systemd EnvironmentFile, and still 192 bits.
    DB_PASSWORD=${DB_PASSWORD:-$(openssl rand -hex 24)}

    set_env_var "$ENV_FILE" NODE_ENV "$([[ $MODE == dev ]] && printf development || printf production)"
    set_env_var "$ENV_FILE" API_PORT "$API_PORT"
    set_env_var "$ENV_FILE" APP_URL "$PUBLIC_URL"
    set_env_var "$ENV_FILE" DATABASE_URL "postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}?schema=public"
    set_env_var "$ENV_FILE" POSTGRES_PASSWORD "$DB_PASSWORD"
    set_env_var "$ENV_FILE" JWT_ACCESS_SECRET "$(openssl rand -hex 48)"
    set_env_var "$ENV_FILE" JWT_REFRESH_SECRET "$(openssl rand -hex 48)"
    # The loopback origins stay in the list so an admin can reach the platform
    # over an SSH tunnel; deduplicated because the public URL is often one of
    # them on a development machine.
    local origins
    origins=$(printf '%s\n%s\n%s\n%s\n%s\n' \
      "$PUBLIC_URL" "http://localhost:${WEB_PORT}" "http://127.0.0.1:${WEB_PORT}" \
      "http://localhost:${MOBILE_PORT}" "http://127.0.0.1:${MOBILE_PORT}" |
      awk '!seen[$0]++' | paste -sd,)
    set_env_var "$ENV_FILE" CORS_ORIGINS "$origins"
    set_env_var "$ENV_FILE" MOBILE_PORT "$MOBILE_PORT"
    set_env_var "$ENV_FILE" NEXT_PUBLIC_API_URL "/api"
    set_env_var "$ENV_FILE" NEXT_PUBLIC_WS_URL "$API_URL"
    set_env_var "$ENV_FILE" API_ORIGIN "http://127.0.0.1:${API_PORT}"

    # Without a broker the queue has to run jobs in-process, or every enqueue
    # fails at runtime.
    if ! { have redis-cli && redis-cli ping >/dev/null 2>&1; }; then
      set_env_var "$ENV_FILE" QUEUE_DRIVER "inline"
      info "Redis unreachable — set QUEUE_DRIVER=inline"
    fi

    chmod 600 "$ENV_FILE"
    ok "wrote .env with generated secrets (mode 600)"
  fi

  # The Prisma CLI loads .env from its working directory, which is backend/,
  # and does not look at the parent. A symlink keeps one file to edit rather
  # than two that drift apart.
  local backend_env="${REPO_ROOT}/backend/.env"
  if [[ -L $backend_env ]]; then
    skip "backend/.env already links to the root .env"
  elif [[ -e $backend_env ]]; then
    warn "backend/.env is a real file, not a link to ../.env — the two can drift"
  else
    ln -s ../.env "$backend_env" 2>/dev/null || cp "$ENV_FILE" "$backend_env"
    ok "linked backend/.env to the root .env"
  fi

  # Next reads env files from its own directory, so the browser-facing values
  # have to live in each application as well as in the root .env the API reads.
  local client_env
  client_env=$(
    cat <<ENV
# Written by scripts/setup-ubuntu.sh. Next.js reads env files from its own
# directory, so these mirror the browser-facing values in the root .env.
#
# NEXT_PUBLIC_* is compiled into the client bundle: changing one needs a
# rebuild, not a restart.
NEXT_PUBLIC_API_URL="/api"
NEXT_PUBLIC_WS_URL="${API_URL}"
API_ORIGIN="http://127.0.0.1:${API_PORT}"
ENV
  )

  printf '%s\n' "$client_env" >"$WEB_ENV_FILE"
  ok "wrote frontend/.env.local"

  printf '%s\n' "$client_env" >"$MOBILE_ENV_FILE"
  ok "wrote mobile/.env.local"
}

# --- Application -----------------------------------------------------------

install_dependencies() {
  step "Installing workspace dependencies"
  cd "$REPO_ROOT"
  pnpm install --frozen-lockfile
  ok "dependencies installed"
}

prepare_database() {
  step "Applying migrations"
  cd "$REPO_ROOT"
  pnpm --filter @atlas/backend prisma:generate >/dev/null
  ok "Prisma client generated"

  pnpm db:migrate
  ok "migrations applied"

  if [[ $RUN_SEED == true ]]; then
    step "Seeding demo data"
    # The seed is idempotent, so a re-run refreshes rather than duplicates.
    pnpm db:seed
    ok "demo data loaded — every account uses the password AtlasDemo123!"
  else
    skip "seeding skipped (--no-seed)"
  fi
}

build_applications() {
  if [[ $MODE == dev ]]; then
    skip "no production build in dev mode"
    return
  fi
  step "Building the API, web and mobile applications"
  cd "$REPO_ROOT"
  NODE_ENV=production pnpm build
  ok "API, web and mobile built"
}

# --- systemd ---------------------------------------------------------------

install_systemd_units() {
  step "Installing systemd units"

  has_systemd || die "--systemd needs a systemd host; this machine is not running systemd"

  local run_user node_bin
  run_user=${SUDO_USER:-$(id -un)}
  node_bin=$(command -v node)

  as_root tee /etc/systemd/system/atlas-api.service >/dev/null <<UNIT
[Unit]
Description=Atlas API
Documentation=https://github.com/MohammadZakariaDehghani/Atlas
After=network-online.target postgresql.service redis-server.service
Wants=network-online.target postgresql.service redis-server.service

[Service]
Type=simple
User=${run_user}
WorkingDirectory=${REPO_ROOT}/backend
Environment=NODE_ENV=production
ExecStart=${node_bin} dist/main.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT

  as_root tee /etc/systemd/system/atlas-web.service >/dev/null <<UNIT
[Unit]
Description=Atlas web
Documentation=https://github.com/MohammadZakariaDehghani/Atlas
After=network-online.target atlas-api.service
Wants=network-online.target

[Service]
Type=simple
User=${run_user}
WorkingDirectory=${REPO_ROOT}/frontend
Environment=NODE_ENV=production
Environment=PORT=${WEB_PORT}
ExecStart=${node_bin} node_modules/next/dist/bin/next start -p ${WEB_PORT}
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT

  as_root tee /etc/systemd/system/atlas-mobile.service >/dev/null <<UNIT
[Unit]
Description=Atlas Mobile
Documentation=https://github.com/MohammadZakariaDehghani/Atlas
After=network-online.target atlas-api.service
Wants=network-online.target

[Service]
Type=simple
User=${run_user}
WorkingDirectory=${REPO_ROOT}/mobile
Environment=NODE_ENV=production
Environment=MOBILE_PORT=${MOBILE_PORT}
ExecStart=${node_bin} node_modules/next/dist/bin/next start -p ${MOBILE_PORT}
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT

  as_root systemctl daemon-reload
  as_root systemctl enable --now atlas-api.service atlas-web.service atlas-mobile.service
  ok "atlas-api, atlas-web and atlas-mobile enabled and started"
  info "logs:    journalctl -u atlas-api -f"
  info "restart: sudo systemctl restart atlas-api atlas-web atlas-mobile"
}

# --- Summary and start -----------------------------------------------------

summary() {
  cat <<SUMMARY

${C_GREEN}${C_BOLD}Atlas is ready.${C_RESET}

  Marketplace   ${PUBLIC_URL}
  Atlas Mobile  ${MOBILE_URL}
  API docs      ${API_URL}/api/docs
  Health        ${API_URL}/api/health

SUMMARY

  if [[ $RUN_SEED == true ]]; then
    cat <<SUMMARY
  Demo accounts, all with the password ${C_BOLD}AtlasDemo123!${C_RESET}

    jordan.lee@example.test         buyer
    sales@northshoremotors.test     dealer
    inspector@atlas.test            inspector
    admin@atlas.test                super admin

SUMMARY
  fi
}

start_platform() {
  cd "$REPO_ROOT"

  if [[ $USE_SYSTEMD == true ]]; then
    install_systemd_units
    summary
    return
  fi

  if [[ $START == false ]]; then
    step "Setup complete"
    info "start it with: $([[ $MODE == dev ]] && printf 'pnpm dev' || printf 'pnpm start')"
    summary
    return
  fi

  summary
  step "Starting Atlas — press Ctrl-C to stop"
  if [[ $MODE == dev ]]; then
    exec pnpm dev
  else
    exec pnpm start
  fi
}

# --- Main ------------------------------------------------------------------

main() {
  preflight

  if [[ $SKIP_SYSTEM == true ]]; then
    step "Skipping system packages (--skip-system)"
    have node || die "Node is not installed and --skip-system was given"
    have pnpm || install_pnpm
    have psql || die "PostgreSQL is not installed and --skip-system was given"
  else
    install_base_packages
    install_node
    install_pnpm
    install_postgres
    install_redis
  fi

  ensure_services_running
  write_env_files
  provision_database
  install_dependencies
  prepare_database
  build_applications
  start_platform
}

main "$@"
