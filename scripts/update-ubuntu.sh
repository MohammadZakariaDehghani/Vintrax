#!/usr/bin/env bash
#
# Update a running Atlas server to the latest code.
#
#   ./scripts/update-ubuntu.sh                 pull, build and restart
#   ./scripts/update-ubuntu.sh --branch NAME   from a specific branch
#   ./scripts/update-ubuntu.sh --no-pull       build and restart what is on disk
#
# The one thing this deliberately does not do is touch .env, the database
# password or the seed. Those belong to the installed deployment, not to a
# release.
#
# Why a build is not optional: both web applications are compiled ahead of
# time. `git pull` alone leaves the running server serving the previous build,
# which looks exactly like a change that did not work — the page renders, the
# new controls are simply absent.

set -Eeuo pipefail

C_BLUE=$'\033[34m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
C_RED=$'\033[31m'; C_DIM=$'\033[2m'; C_BOLD=$'\033[1m'; C_RESET=$'\033[0m'
if [[ ! -t 1 ]]; then C_BLUE=; C_GREEN=; C_YELLOW=; C_RED=; C_DIM=; C_BOLD=; C_RESET=; fi

step() { printf '\n%s==>%s %s%s%s\n' "$C_BLUE" "$C_RESET" "$C_BOLD" "$*" "$C_RESET"; }
info() { printf '    %s\n' "$*"; }
skip() { printf '    %s%s%s\n' "$C_DIM" "$*" "$C_RESET"; }
ok()   { printf '    %s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '    %s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
die()  { printf '\n%serror:%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; exit 1; }

REPO_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
BRANCH=""
PULL=true

while (( $# )); do
  case $1 in
    --branch) BRANCH=${2:?--branch needs a name}; shift 2 ;;
    --no-pull) PULL=false; shift ;;
    # The header comment is the help text, so the two cannot drift apart.
    -h|--help)
      awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "${BASH_SOURCE[0]}"
      exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

have() { command -v "$1" >/dev/null 2>&1; }
has_systemd() { [[ -d /run/systemd/system ]]; }
as_root() { if [[ $EUID -eq 0 ]]; then "$@"; else sudo "$@"; fi; }

cd "$REPO_ROOT"
have pnpm || die "pnpm is not installed — run ./scripts/setup-ubuntu.sh first"
[[ -f .env ]] || die ".env is missing — this looks like a fresh checkout, run ./scripts/setup-ubuntu.sh"

# --- Pull -------------------------------------------------------------------

if [[ $PULL == true ]]; then
  step "Fetching the latest code"

  if [[ -n $(git status --porcelain) ]]; then
    warn "there are uncommitted changes in the working tree"
    warn "commit or stash them first, or re-run with --no-pull to build what is here"
    die "refusing to pull over local changes"
  fi

  local_branch=${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}
  info "branch: ${local_branch}"

  # Retry: a transient network failure should not leave a half-updated server.
  for attempt in 1 2 3 4; do
    if git fetch origin "$local_branch"; then break; fi
    (( attempt == 4 )) && die "could not reach the remote after 4 attempts"
    warn "fetch failed — retrying in $(( 2 ** attempt ))s"
    sleep $(( 2 ** attempt ))
  done

  git checkout "$local_branch"
  before=$(git rev-parse --short HEAD)
  git merge --ff-only "origin/${local_branch}"
  after=$(git rev-parse --short HEAD)

  if [[ $before == "$after" ]]; then
    skip "already up to date at ${after}"
  else
    ok "updated ${before} → ${after}"
    git --no-pager log --oneline "${before}..${after}" | sed 's/^/    /'
  fi
else
  skip "--no-pull: building the code already on disk"
fi

# --- Dependencies and database ---------------------------------------------

step "Installing dependencies"
pnpm install --frozen-lockfile
ok "dependencies installed"

step "Applying migrations"
pnpm --filter @atlas/backend prisma:generate >/dev/null
pnpm db:migrate
ok "database is at the latest migration"

# --- Build ------------------------------------------------------------------

step "Building"
# Next.js serves a compiled bundle. Removing the previous output avoids the
# case where the server holds an old page referencing chunk names the new
# build no longer wrote, which fails as a blank page rather than an error.
rm -rf frontend/.next mobile/.next
NODE_ENV=production pnpm build
ok "API, web and mobile built"

# --- Restart ----------------------------------------------------------------

step "Restarting"

UNITS=(atlas-api atlas-web atlas-mobile)
installed=()
for unit in "${UNITS[@]}"; do
  if has_systemd && systemctl list-unit-files "${unit}.service" >/dev/null 2>&1 &&
    systemctl cat "${unit}.service" >/dev/null 2>&1; then
    installed+=("$unit")
  fi
done

if (( ${#installed[@]} > 0 )); then
  as_root systemctl restart "${installed[@]}"
  sleep 3
  for unit in "${installed[@]}"; do
    if systemctl is-active --quiet "$unit"; then
      ok "${unit} running"
    else
      warn "${unit} is not running — journalctl -u ${unit} -n 50"
    fi
  done
else
  skip "no systemd units installed"
  info "Atlas is not managed by systemd here, so nothing was restarted."
  info "Stop the running process and start it again with: pnpm start"
  info "A build alone changes nothing until the server process is replaced."
fi

# --- Check ------------------------------------------------------------------

step "Checking"

api_port=$(grep -E '^API_PORT=' .env | tail -1 | cut -d= -f2 | tr -d '"' || true)
web_port=$(grep -E '^WEB_PORT=' .env | tail -1 | cut -d= -f2 | tr -d '"' || true)
api_port=${api_port:-3001}
web_port=${web_port:-3000}

if have curl; then
  if curl -fsS "http://127.0.0.1:${api_port}/api/health" >/dev/null 2>&1; then
    ok "API healthy on :${api_port}"
  else
    warn "API is not answering on :${api_port}"
  fi
  if curl -fsS -o /dev/null "http://127.0.0.1:${web_port}/" 2>/dev/null; then
    ok "web answering on :${web_port}"
  else
    warn "web is not answering on :${web_port}"
  fi
fi

printf '\n%s✓%s Update complete. Reload the page in your browser — a hard reload\n' "$C_GREEN" "$C_RESET"
printf '  (Ctrl-Shift-R) if the old version is cached.\n\n'
