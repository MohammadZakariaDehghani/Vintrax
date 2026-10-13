# Repository migration: `Vintrax` → `Vintrax-MarketPlace`

The canonical repository for Vintrax is
[`variety-project-labs/Vintrax-MarketPlace`](https://github.com/variety-project-labs/Vintrax-MarketPlace).
Development, pull requests and the release pipeline move there from
[`MohammadZakariaDehghani/Vintrax`](https://github.com/MohammadZakariaDehghani/Vintrax),
which stays intact, read-only in practice, as a fallback until the new pipeline
has shipped a release.

The move changes **where images are built and published**. It does not
change the server, the database, the volumes, the Compose project, the domains
or the environment file, apart from one value in that file (`IMAGE_NAMESPACE`).
There is no new production environment.

## What the pipeline does today

Read from the last release of the old repository (run for `64d0717`,
9 October 2026), not assumed:

| Fact                         | Value                                                                                                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deployment path              | `/opt/vintrax` (`deploy.sh` found `/opt/vintrax/env/vintrax.env`)                                                                                          |
| Command run over SSH         | `cd /opt/vintrax/scripts && ./deploy.sh sha-<commit>`                                                                                                      |
| Images pulled                | `ghcr.io/mohammadzakariadehghani/vintrax-{api,web,mobile}:sha-<commit>`                                                                                    |
| Running version              | `sha-64d0717`, previous `sha-1ed22c8`                                                                                                                      |
| Containers                   | `vintrax-api`, `vintrax-web`, `vintrax-mobile`, `vintrax-migrate`; `vintrax-postgres` and `vintrax-redis` from the `bundled` profile, untouched by deploys |
| SSH key the job uses         | ED25519, `SHA256:5thrcHvnPrPkVTNeHJlPxYZ1gQTKRfAiWF2ZSyxP0I4`, comment `github-actions-vintrax`                                                            |
| `known_hosts`                | one host key                                                                                                                                               |
| `NEXT_PUBLIC_WS_URL`         | **empty** — the socket clients connect to the page's own origin and Nginx proxies `/socket.io/`                                                            |
| `NEXT_PUBLIC_BRAND_LOGO_SRC` | empty — the default logo                                                                                                                                   |

The release workflow names its images after the repository owner,
`ghcr.io/<owner>/vintrax-<service>`. From the new repository that is
`ghcr.io/variety-project-labs/vintrax-*`. `GITHUB_TOKEN` cannot publish into
another account's namespace, so the server has to start pulling from the new
one — that is the `IMAGE_NAMESPACE` change below, and the only reason the
server is touched at all.

## 1. Read-only checks on the server

Nothing here changes anything. Run as the account that will be `DEPLOY_USER`.

```bash
# Which compose file started the running containers. Expect
# /opt/vintrax/compose/docker-compose.prod.yml — this is what tells you whether
# /root/Atlas or /opt/vintrax is the live deployment.
docker inspect vintrax-api \
  --format '{{ index .Config.Labels "com.docker.compose.project.config_files" }}  {{ .Config.Image }}'

# The namespace the server pulls from today (not a secret).
grep '^IMAGE_NAMESPACE=' /opt/vintrax/env/vintrax.env

# What /root/Atlas is: a source checkout, and of which repository.
git -C /root/Atlas remote -v; git -C /root/Atlas log --oneline -1

# The deploy key: these two fingerprints must match each other, and the one
# in the table above.
ssh-keygen -lf /root/.ssh/vintrax_github_actions.pub
ssh-keygen -lf /root/.ssh/authorized_keys | grep 5thrcHvnPrPkVTNeHJlPxYZ1gQTKRfAiWF2ZSyxP0I4

# The server's own host keys, to compare with what ssh-keyscan returns below.
for k in /etc/ssh/ssh_host_*_key.pub; do ssh-keygen -lf "$k"; done
```

If the `authorized_keys` line is missing, the key is not authorised for this
account: stop and decide which account deploys before going further. Do not
overwrite `authorized_keys` or the existing key files.

## 2. Settings in the new repository

Settings → Secrets and variables → Actions. Secret values are never shown in
logs; the workflow prints only the key's public fingerprint.

**Secrets**

| Name                     | Value                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEPLOY_HOST`            | `142.93.146.113`                                                                                                                               |
| `DEPLOY_USER`            | The account whose `authorized_keys` holds the key above — `root` if § 1 found it there                                                         |
| `DEPLOY_SSH_KEY`         | The whole private key file `/root/.ssh/vintrax_github_actions`, BEGIN/END lines included                                                       |
| `DEPLOY_SSH_KNOWN_HOSTS` | The output of `ssh-keyscan -p 22 142.93.146.113`, run from a machine that already trusts the server, checked against the fingerprints from § 1 |

Copy the private key over an existing trusted session (for example
`cat /root/.ssh/vintrax_github_actions` in your own terminal, pasted straight
into the secret field). Do not put it in a file in the repository, an issue, a
chat, or a CI log. `DEPLOY_HOST` must be the IP address, because that is the
name the known-hosts entry is scanned for.

**Variables**

| Name                         | Value                                      |
| ---------------------------- | ------------------------------------------ |
| `DEPLOY_PATH`                | `/opt/vintrax` (also the default if unset) |
| `DEPLOY_PORT`                | `22` (also the default if unset)           |
| `NEXT_PUBLIC_WS_URL`         | leave **unset** — matches production today |
| `NEXT_PUBLIC_BRAND_LOGO_SRC` | leave **unset** for the default logo       |

`GITHUB_TOKEN` is provided by Actions. No personal access token is needed in
the repository.

**Environment.** Settings → Environments → `production` (the deploy job creates
it on first run if it does not exist) → **Required reviewers** → add yourself.
The first release from the new repository then waits for an approval, which is
the moment to finish § 3.

**Organisation.** The organisation's package settings must allow members'
repositories to create private container packages (Organization settings →
Packages). The first release creates `vintrax-api`, `vintrax-web` and
`vintrax-mobile` under the organisation, linked to this repository.

## 3. Cutover

1. **Stop releasing from the old repository.** Merge nothing more into its
   `main`. Its `Release` workflow and the new one serialise only within their
   own repository, so two pipelines pointed at one server could run
   `deploy.sh` at the same time.
2. **Bring the new `main` up to date and merge.** The release run verifies,
   publishes `sha-<new commit>` under `ghcr.io/variety-project-labs/`, then
   waits at **Deploy to production** for the approval.
3. **Prove the server can read the new packages** — a pull, which changes
   nothing that is running:
   ```bash
   docker pull ghcr.io/variety-project-labs/vintrax-api:sha-<new commit>
   ```
   If it is denied, log in with a token that can read the organisation's
   packages (`docker login ghcr.io`, docker.md § 3.6) and pull again.
4. **Keep the current settings, then switch the namespace.** The backup keeps
   the file's mode (600) and is what makes rollback to pre-migration versions
   possible:
   ```bash
   cd /opt/vintrax/env
   cp -p vintrax.env vintrax.env.pre-migration
   sed -i 's/^IMAGE_NAMESPACE=.*/IMAGE_NAMESPACE=variety-project-labs/' vintrax.env
   grep '^IMAGE_NAMESPACE=' vintrax.env
   ```
   Running containers are not affected; nothing restarts until a deploy.
5. **Approve the deployment** in the Actions run. `deploy.sh` pulls, runs
   `prisma migrate deploy`, rolls the three application containers and waits
   for health; the job then confirms the version with `deploy.sh --list`.
   PostgreSQL, Redis and the volumes are not recreated.
6. **Retire the old pipeline** once one release has gone out from the new
   repository: in the old repository, Actions → Release → **Disable workflow**.
   Keep the repository and its secrets until you are satisfied, then delete
   its `DEPLOY_SSH_KEY` secret.

If any step fails before 5, nothing has changed on the server except
possibly the `IMAGE_NAMESPACE` line, which `vintrax.env.pre-migration` restores.
If the deploy job runs before step 4 (no reviewer configured), it stops at
**Check the server pulls the images this run published** with an
`IMAGE NAMESPACE MISMATCH` error that names both namespaces, before
`deploy.sh` runs, and the current version keeps serving. A server that cannot
read the organisation's packages stops at the same step with
`REGISTRY ACCESS` (step 3).

## 4. Rollback after the move

`rollback.sh` pulls the version it rolls back to, so it needs the tag to exist
under the namespace it is reading.

- **To a version released from the new repository:** `./rollback.sh` as usual.
- **To a version from before the move** (`sha-64d0717`, `sha-1ed22c8`, …):
  those exist only under the old namespace, so point the script at the
  pre-migration settings:
  ```bash
  cd /opt/vintrax/scripts
  ./rollback.sh --env-file /opt/vintrax/env/vintrax.env.pre-migration sha-64d0717
  ```
- **Back to the old pipeline entirely:** restore the file
  (`cp -p vintrax.env.pre-migration vintrax.env`) and re-enable the old
  repository's Release workflow.

`deploy.sh` keeps cleaning up only the namespace in the current
`IMAGE_NAMESPACE`, so the old `mohammadzakariadehghani` images stay on disk and
remain available for the rollback above. Remove them by hand, image by image,
once they are no longer needed — never with `docker system prune`.
