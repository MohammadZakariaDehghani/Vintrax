import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Compose is deployment configuration, and it is where a laptop-safe default
 * quietly becomes an internet-facing one. Docker publishes ports through its
 * own NAT rules, ahead of the host firewall, so `5432:5432` on a machine with
 * a public interface is a database on the internet whether or not ufw is on.
 *
 * The file is read as text and sliced by indentation rather than parsed: no
 * YAML library is a dependency here, and adding one to assert four lines would
 * cost more than it proves.
 */

const COMPOSE_PATH = join(__dirname, '..', '..', 'docker-compose.yml');
const compose = readFileSync(COMPOSE_PATH, 'utf8');

/** The lines belonging to one service, from its key to the next sibling key. */
function serviceBlock(name: string): string {
  const lines = compose.split('\n');
  const start = lines.findIndex((line) => line === `  ${name}:`);
  if (start === -1) throw new Error(`docker-compose.yml has no service "${name}"`);

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^ {2}\S/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

/** Port mappings published by a service, as written. */
function publishedPorts(name: string): string[] {
  const block = serviceBlock(name);
  const ports = block.match(/^ {4}ports:\n((?: {6}- .*\n?)+)/m);
  if (!ports) return [];
  return [...ports[1]!.matchAll(/- '([^']+)'/g)].map((match) => match[1]!);
}

/** Services holding data or credentials. None of these belongs on 0.0.0.0. */
const BACKING_SERVICES = ['postgres', 'redis', 'minio', 'opensearch'];

/** Services a reverse proxy or another host has to reach. */
const PUBLIC_SERVICES = ['api', 'web', 'mobile'];

describe('published ports', () => {
  it.each(BACKING_SERVICES)('binds %s to loopback only', (name) => {
    const ports = publishedPorts(name);

    expect(ports.length).toBeGreaterThan(0);
    for (const mapping of ports) {
      expect(mapping).toMatch(/^127\.0\.0\.1:/);
    }
  });

  it.each(PUBLIC_SERVICES)('leaves %s reachable, because something must reach it', (name) => {
    const ports = publishedPorts(name);

    expect(ports.length).toBeGreaterThan(0);
    for (const mapping of ports) {
      expect(mapping).not.toMatch(/^127\.0\.0\.1:/);
    }
  });

  it('reads the real file, not an empty one', () => {
    expect(compose).toContain('services:');
    expect(publishedPorts('postgres')).toEqual(['127.0.0.1:5432:5432']);
  });
});

describe('redis', () => {
  const redis = serviceBlock('redis');

  it('requires a password', () => {
    // Unauthenticated Redis is not merely a readable cache — a client can
    // rewrite the RDB path and have the server write a file wherever it can.
    expect(redis).toContain('--requirepass');
  });

  it('takes that password from the environment rather than hard-coding one', () => {
    expect(redis).toMatch(/--requirepass\n\s+- \$\{REDIS_PASSWORD/);
  });

  it('health-checks as an authenticated client, so a healthy container is a usable one', () => {
    expect(redis).toMatch(/healthcheck:[\s\S]*'-a'/);
  });

  it('is addressed by the API with that password', () => {
    // redis://:PASSWORD@host — the empty username is how a Redis URL carries a
    // requirepass secret.
    expect(serviceBlock('api')).toMatch(/REDIS_URL: redis:\/\/:\$\{REDIS_PASSWORD[^@]*@redis:6379/);
  });
});

describe('postgres', () => {
  it('takes its password from the environment rather than hard-coding one', () => {
    expect(serviceBlock('postgres')).toContain('POSTGRES_PASSWORD: ${POSTGRES_PASSWORD');
  });
});

describe('the example environment', () => {
  const env = readFileSync(join(__dirname, '..', '..', '.env.example'), 'utf8');

  it('ships a REDIS_URL that carries a password, matching the compose default', () => {
    expect(env).toMatch(/^REDIS_URL="redis:\/\/:[^@]+@/m);
  });

  it('names REDIS_PASSWORD, so compose and the URL cannot drift apart silently', () => {
    expect(env).toMatch(/^REDIS_PASSWORD=/m);
  });
});

/**
 * The production stack is a different file with the opposite defaults: nothing
 * is reachable from outside the host, because Nginx is the only thing the
 * internet talks to. These assertions are the ones that matter most — the
 * development file above is a laptop, this one is a server.
 */
describe('the production stack', () => {
  const PROD_PATH = join(__dirname, '..', '..', 'compose', 'docker-compose.prod.yml');
  const prod = readFileSync(PROD_PATH, 'utf8');

  function prodBlock(name: string): string {
    const lines = prod.split('\n');
    const start = lines.findIndex((line) => line === `  ${name}:`);
    if (start === -1) throw new Error(`docker-compose.prod.yml has no service "${name}"`);
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => /^ {2}\S/.test(line));
    return (end === -1 ? rest : rest.slice(0, end)).join('\n');
  }

  it('reads the real file, not an empty one', () => {
    expect(prod).toContain('services:');
    expect(prod).toContain('vintrax-api');
  });

  it.each(['postgres', 'redis'])('publishes no host port at all for %s', (name) => {
    // Stronger than loopback: on a server there is no reason for either to be
    // reachable from the host, and `docker compose exec` still works without it.
    expect(prodBlock(name)).not.toMatch(/^ {4}ports:/m);
  });

  it.each(['api', 'web', 'mobile'])('binds %s to loopback, for Nginx to reach', (name) => {
    const block = prodBlock(name);
    const mappings = [...block.matchAll(/- '([^']+)'/g)].map((match) => match[1]!);

    expect(mappings.length).toBeGreaterThan(0);
    for (const mapping of mappings) {
      expect(mapping).toMatch(/^127\.0\.0\.1:/);
    }
  });

  it('builds nothing — the server runs what the registry holds', () => {
    // A `build:` here would mean the artefact CI verified is not the artefact
    // that runs, and that a rollback needs a working toolchain on the server.
    expect(prod).not.toMatch(/^ {4}build:/m);
  });

  it('hard-codes no secret, and fails loudly when one is missing', () => {
    for (const secret of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'POSTGRES_PASSWORD']) {
      // `:?` makes compose refuse to start rather than substitute an empty
      // string, which is how a JWT secret silently becomes "".
      expect(prod).toContain(`\${${secret}:?`);
    }
  });

  it('pins an image version rather than defaulting to a moving tag', () => {
    // A `:-latest` default would mean `up -d` could quietly change versions.
    expect(prod).toContain('${VINTRAX_VERSION:?');
    expect(prod).not.toContain('VINTRAX_VERSION:-');
  });

  it('starts the API only after migrations have succeeded', () => {
    expect(prodBlock('api')).toMatch(/migrate:\n\s+condition: service_completed_successfully/);
  });

  it('migrates with deploy, never with dev', () => {
    expect(prodBlock('migrate')).toContain("'migrate', 'deploy'");

    // Comments are stripped first: the file explains at length why `migrate
    // dev` is not used here, and matching that prose would be the test reading
    // its own documentation back.
    const directives = prod
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');

    expect(directives).not.toContain('migrate dev');
    expect(directives).not.toContain('migrate reset');
  });

  it('keeps uploads and the database on named volumes', () => {
    // The container filesystem is disposable; listing photos are not.
    expect(prodBlock('api')).toContain('uploads-data:/app/backend/uploads');
    expect(prodBlock('postgres')).toContain('postgres-data:/var/lib/postgresql/data');
  });
});

/**
 * The release workflow now ends by deploying to production without a person in
 * the loop, which moves a class of mistake from "someone notices while typing"
 * to "nobody sees it until the site is down". These assert the properties that
 * were reasoned about when it was written, so a later edit that quietly drops
 * one fails here rather than in production.
 *
 * Read as text and matched by directive, the same way the compose assertions
 * above work, and with comments stripped first for the same reason: the file
 * explains itself at length, and matching that prose would be the test reading
 * its own documentation back.
 */
describe('the release workflow', () => {
  const RELEASE_PATH = join(__dirname, '..', '..', '.github', 'workflows', 'release.yml');
  const release = readFileSync(RELEASE_PATH, 'utf8');

  /** The file without its commentary, so a match is a directive. */
  const directives = release
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

  it('reads the real file, not an empty one', () => {
    expect(release).toContain('name: Release');
    expect(release.length).toBeGreaterThan(500);
  });

  it('deploys only after every image has been published', () => {
    // `needs: publish` is the whole matrix. Without it a half-published build
    // could reach the server: two images at the new tag and one at the old.
    expect(directives).toMatch(/deploy:\n(\s+.*\n)*?\s+needs: publish\b/);
  });

  it('deploys the tag that run published, never a moving one', () => {
    // The version comes from the publish job's output rather than being
    // recomputed, and is checked to be an immutable sha- tag before use.
    expect(directives).toContain('VERSION: ${{ needs.publish.outputs.version }}');
    expect(directives).toMatch(/VERSION =~ \^sha-\[0-9a-f\]\{7,40\}\$/);
  });

  it('runs the deploy script that was already on the server', () => {
    // Not a second deployment mechanism. The same script, at its own path,
    // which is what keeps the manual path and rollback working.
    expect(directives).toContain("./deploy.sh '$VERSION'");
    expect(directives).toContain("TARGET_PATH: ${{ vars.DEPLOY_PATH || '/opt/vintrax' }}");
  });

  it('serialises production deployments and never cancels one part-way', () => {
    // A run killed between `prisma migrate deploy` and `compose up` is the
    // worst state this server can be left in.
    expect(directives).toMatch(
      /concurrency:\n\s+group: vintrax-production-deploy\n\s+cancel-in-progress: false/,
    );
  });

  it('deploys from main only, so a tag cut anywhere cannot go live', () => {
    expect(directives).toContain("if: github.ref == 'refs/heads/main'");
  });

  it('verifies the host key rather than trusting whatever answers', () => {
    // Without this the runner hands a key with shell access to production to
    // the first machine that replies on that address.
    expect(directives).toContain('StrictHostKeyChecking yes');
    expect(directives).toContain('DEPLOY_SSH_KNOWN_HOSTS');
    expect(directives).not.toContain('StrictHostKeyChecking no');

    // Mentioning `ssh-keyscan` is fine and is how the failure message tells an
    // operator where the secret comes from. *Running* it here is the problem:
    // it would trust whatever answered, which is the attack the pinned key
    // exists to stop. So this looks for an invocation, not for the word.
    expect(directives).not.toMatch(/(^|[|&;(`$]\s*)ssh-keyscan\b/m);
  });

  it('runs no destructive command on the server', () => {
    // The deploy script keeps old images precisely so rollback works, and the
    // volumes hold the database.
    expect(directives).not.toContain('system prune');
    expect(directives).not.toContain('down -v');
  });

  it('never reverts on its own', () => {
    // The step summary prints the rollback commands, which is the point — a
    // person reads them. What must not happen is this workflow running one:
    // a failed deploy may have applied a migration, and starting the previous
    // image against the new schema is how a bad release becomes data loss.
    // deploy.sh refuses to do it automatically for that reason, and so does
    // this. Hence: rollback.sh may appear, but never after an `ssh`.
    for (const line of directives.split('\n')) {
      if (line.includes('rollback.sh')) expect(line).not.toMatch(/\bssh\b/);
    }
  });

  it('confirms afterwards what the server is actually running', () => {
    expect(directives).toContain('./deploy.sh --list');
  });
});

/**
 * One image namespace, end to end. A release from the new repository published
 * to ghcr.io/variety-project-labs while the server still pulled from the old
 * owner, and the first anyone heard of it was "not found" inside deploy.sh.
 * These pin the namespace in one place and the checks that make the two sides
 * agree before anything on the server runs.
 */
describe('the image namespace', () => {
  const root = join(__dirname, '..', '..');
  const release = readFileSync(join(root, '.github', 'workflows', 'release.yml'), 'utf8');
  const directives = release
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
  const deployJob = directives.slice(directives.indexOf('\n  deploy:'));
  const stepNames = directives
    .split('\n')
    .map((line) => /^\s*- name:\s*(.+?)\s*$/.exec(line)?.[1])
    .filter((name): name is string => Boolean(name));
  const orderOf = (name: string) => stepNames.indexOf(name);

  it('is written down once, as the new repository owner', () => {
    expect(directives).toMatch(/^env:\n\s+IMAGE_NAMESPACE: variety-project-labs$/m);
  });

  it('is what publish pushes to, and only if it is the repository owner GITHUB_TOKEN can write to', () => {
    expect(directives).toContain('echo "name=ghcr.io/$IMAGE_NAMESPACE/vintrax-$SERVICE"');
    expect(directives).toContain('if [[ $IMAGE_NAMESPACE != "$owner" ]]; then');
    expect(directives).not.toMatch(/ghcr\.io\/\$\{GITHUB_REPOSITORY_OWNER/);
  });

  it('names nothing from the repository this one replaced', () => {
    for (const file of [
      '.github/workflows/release.yml',
      '.github/workflows/verify.yml',
      '.github/workflows/ci.yml',
      'compose/docker-compose.prod.yml',
      'scripts/deploy.sh',
      'scripts/rollback.sh',
      '.env.production.example',
    ]) {
      expect(readFileSync(join(root, file), 'utf8').toLowerCase()).not.toContain(
        'mohammadzakariadehghani',
      );
    }
  });

  it('is the value the production example tells the server to use', () => {
    const example = readFileSync(join(root, '.env.production.example'), 'utf8');
    expect(example).toMatch(/^IMAGE_NAMESPACE=variety-project-labs$/m);
  });

  it('is what the production stack pulls, for all three images', () => {
    const prod = readFileSync(join(root, 'compose', 'docker-compose.prod.yml'), 'utf8');
    for (const service of ['api', 'web', 'mobile']) {
      expect(prod).toContain(
        `image: \${REGISTRY:-ghcr.io}/\${IMAGE_NAMESPACE:?set IMAGE_NAMESPACE}/vintrax-${service}:\${VINTRAX_VERSION:?set VINTRAX_VERSION}`,
      );
    }
  });

  it('builds every image from the commit the tag names', () => {
    expect(directives).toMatch(
      /- uses: actions\/checkout@v4\n\s+with:\n\s+ref: \$\{\{ github\.sha \}\}/,
    );
    expect(directives).toContain('if [[ $GITHUB_SHA != "${version#sha-}"* ]]; then');
  });

  it('deploys only from this repository', () => {
    expect(directives).toContain(
      "if: github.ref == 'refs/heads/main' && github.repository == 'variety-project-labs/Vintrax-MarketPlace'",
    );
  });

  it('reads the registry with no more than package read access', () => {
    expect(deployJob).toMatch(/permissions:\n\s+contents: read\n\s+packages: read\n/);
    expect(deployJob).not.toContain('packages: write');
  });

  it('confirms all three images exist at the tag before the server is touched', () => {
    expect(deployJob).toContain('ref="ghcr.io/$IMAGE_NAMESPACE/vintrax-$service:$VERSION"');
    expect(orderOf('Confirm all three images are published at this tag')).toBeLessThan(
      orderOf('Create the SSH directory'),
    );
  });

  it('checks the server would pull exactly those images, and may, before deploying', () => {
    const check = orderOf('Check the server pulls the images this run published');
    expect(check).toBeGreaterThan(orderOf('Test the SSH connection'));
    expect(check).toBeLessThan(orderOf('Run the existing deploy script'));
    expect(directives).toMatch(
      /- name: Check the server pulls the images this run published\n\s+if: success\(\)/,
    );
    expect(deployJob).toContain('config --images');
    expect(deployJob).toContain("docker manifest inspect '$ref'");
    expect(deployJob).toContain('::error::IMAGE NAMESPACE MISMATCH');
    expect(deployJob).toContain('::error::REGISTRY ACCESS');
  });
});

/**
 * SSH preparation, as its own suite.
 *
 * Every one of these exists because the job failed with exit code 255 and the
 * log could not say why. 255 is ssh's own "I gave up" — the same number for a
 * wrong key, a wrong host key, and a server that is not answering — and the
 * only way to tell those apart is to have proven the round trip *before*
 * anything is deployed, and to have written down which of them happened.
 *
 * The other half of that failure was a single preparation step that began
 * `mkdir -p ~/.ssh`. When something later in it failed, the Actions UI marked
 * the step red and showed its first line, which reads as though `mkdir` had
 * failed. It had not. These assert the shape that removed the ambiguity:
 * one named step per thing that can go wrong.
 */
describe('the deployment SSH setup', () => {
  const RELEASE_PATH = join(__dirname, '..', '..', '.github', 'workflows', 'release.yml');
  const release = readFileSync(RELEASE_PATH, 'utf8');

  const directives = release
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

  /** Step names in file order, which is also the order they run in. */
  const stepNames = directives
    .split('\n')
    .map((line) => /^\s*- name:\s*(.+?)\s*$/.exec(line)?.[1])
    .filter((name): name is string => Boolean(name));

  const orderOf = (name: string) => stepNames.indexOf(name);

  it('prepares each credential in its own named step', () => {
    // The point of the split: a red marker now names the thing that failed
    // instead of naming whichever command happened to be written first.
    for (const name of [
      'Create the SSH directory',
      'Write the private key',
      'Write the known_hosts file',
      'Write the SSH client configuration',
      'Test the SSH connection',
    ]) {
      expect(stepNames).toContain(name);
    }
  });

  it('proves the connection works before it deploys anything', () => {
    const test = orderOf('Test the SSH connection');
    const deploy = orderOf('Run the existing deploy script');

    expect(test).toBeGreaterThan(-1);
    expect(deploy).toBeGreaterThan(test);
  });

  it('makes the connectivity test a harmless one', () => {
    // A test that changed something on the server would be a deployment, and
    // the whole point is to learn whether ssh works without deploying.
    expect(directives).toContain("'echo SSH connection successful'");
    expect(directives).toContain('-o BatchMode=yes');
  });

  it('stops before the server if any preparation step fails', () => {
    // Requirement, and the reason the job was failing usefully at the wrong
    // place: nothing may reach production unless the key parsed, the
    // known_hosts parsed, and a round trip succeeded. `if: success()` is the
    // default; it is written out so that a later edit has to delete something
    // visible, and so this can assert it.
    expect(directives).toMatch(/- name: Run the existing deploy script\n\s+if: success\(\)/);
    expect(directives).toMatch(
      /- name: Confirm the server is running this version\n\s+if: success\(\)/,
    );

    // `continue-on-error` anywhere in this job would revoke all of the above
    // by turning a failed preparation step into a passed one.
    expect(directives).not.toContain('continue-on-error');
  });

  it('fails loudly rather than carrying on with a broken credential', () => {
    // Each write is checked at the point it happens, so the error names the
    // secret. Without these, an empty or malformed secret is discovered three
    // steps later as an authentication failure against the server.
    expect(directives).toContain('::error::DEPLOY_SSH_KEY wrote an empty file');
    expect(directives).toContain('::error::DEPLOY_SSH_KEY does not look like a private key');
    expect(directives).toContain('::error::DEPLOY_SSH_KEY could not be read by ssh-keygen');
    expect(directives).toContain('::error::DEPLOY_SSH_KNOWN_HOSTS wrote an empty file');
    expect(directives).toContain('::error::DEPLOY_SSH_KNOWN_HOSTS is not a valid known_hosts file');
  });

  it('writes the private key with owner-only permissions', () => {
    // OpenSSH refuses a key others can read, and says "bad permissions",
    // which is another way to arrive at 255 with no explanation.
    expect(directives).toContain('chmod 700 ~/.ssh');
    expect(directives).toMatch(/chmod 600 "\$key"/);
    expect(directives).toMatch(/chmod 600 "\$hosts"/);
    // `umask 077` before the write, so there is no window in which the file
    // exists and is world-readable.
    expect(directives).toContain('umask 077');
  });

  it('names which kind of failure happened, rather than only the exit code', () => {
    // The four classes asked for. Each is reached by matching ssh's own
    // wording, and the classification is exercised directly by the harness in
    // the scratch script that accompanied this change.
    expect(directives).toContain('::error::HOST-KEY VERIFICATION');
    expect(directives).toContain('::error::AUTHENTICATION');
    expect(directives).toContain('::error::CONNECTION');
    expect(directives).toContain('::error::REMOTE COMMAND FAILURE');
  });

  it('separates an ssh failure from a remote command failure by exit code', () => {
    // This is the load-bearing distinction. ssh reserves 255 for itself and
    // passes any other status straight through from the remote command, so
    // `rc != 255` means the login worked and the command did not.
    expect(directives).toMatch(/\(\(\s*rc\s*!=\s*255\s*\)\)/);
  });

  it('never prints a secret, only the public fingerprint', () => {
    // `ssh-keygen -y` writes the *public* key; `-l` prints its fingerprint.
    // That is the one value worth printing — it is what an operator compares
    // against authorized_keys — and it is not secret.
    expect(directives).toContain('ssh-keygen -lf ~/.ssh/vintrax_key.pub');

    // The private key is never read back out. A `cat` of the key file, or an
    // echo of the secret, would put it in the log; GitHub's masking is a
    // safety net, not a licence to print one.
    //
    // Expanding the secret is unavoidable — it has to be written to disk —
    // so the rule is about where it goes, not whether it is named: every line
    // that expands one must redirect into a file. A line that expands it
    // without a redirect is a line that prints it.
    const expansions = directives
      .split('\n')
      .filter((line) => /\$\{?TARGET_(KEY|KNOWN_HOSTS)\b/.test(line));

    expect(expansions.length).toBeGreaterThan(0);
    for (const line of expansions) {
      // `[[ -n $TARGET_KEY ]]` is a test, not an output; anything else has to
      // end in a redirect to the file it is writing.
      if (/^\s*\[\[/.test(line.trim())) continue;
      expect(line).toMatch(/> "\$(key|hosts)"\s*$/);
    }

    // And the key file itself is never read back to stdout.
    expect(directives).not.toMatch(/\bcat\b[^\n]*\$key/);
  });

  it('removes the key from the runner even when the job fails', () => {
    expect(directives).toMatch(/- name: Remove the private key from the runner\n\s+if: always\(\)/);
  });

  it('sets a strict shell in every step of the deploy job', () => {
    // Without `set -u` a typo'd variable expands to nothing and the step
    // carries on with a blank host; without `pipefail` a failure on the left
    // of a pipe is invisible. `-e` is deliberately absent from the two blocks
    // that carry the exit status by hand so their log group still closes, so
    // this asserts `-u` and `pipefail` rather than one exact flag string.
    //
    // Scoped to the deploy job: it is the one that holds a credential and
    // touches the server. The build jobs above it run `pnpm` one line at a
    // time and are not what this is about.
    const deployJob = directives.slice(directives.indexOf('\n  deploy:'));
    const runBlocks = deployJob.split(/^\s+run: \|/m).slice(1);

    expect(runBlocks.length).toBeGreaterThan(5);
    for (const block of runBlocks) {
      const first = block.split('\n').find((line) => line.trim().startsWith('set '));

      expect(first?.trim()).toMatch(/^set -e?uo pipefail$/);
    }
  });
});
