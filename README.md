# SkyBlockGPT

Source of truth for the public SkyBlockGPT Custom GPT, its Cloudflare Worker, OpenAPI Actions, instructions, validation tests, and release packages.

The repository contains no API keys. Hypixel and shared GPT credentials belong in encrypted Cloudflare Worker secrets. The SkyCofl token belongs in the Custom GPT Action's Bearer authentication.

## What is automated

- Every push and pull request validates the Worker, all OpenAPI schemas, ChatGPT-specific schema limits, and mocked profile/market behavior.
- A successful push to `main` that changes Worker code automatically deploys `skyblock-gpt-proxy` through Cloudflare Wrangler.
- A pushed `v*` tag creates a clean GitHub Release ZIP.
- Dependabot checks Wrangler and GitHub Actions weekly.

Updating the Custom GPT's Instructions or Action schemas is still manual. OpenAI's supported workflow is to edit the GPT in the web builder and click **Update**; there is no supported Custom GPT configuration API used by this project.

## Repository layout

```text
AGENTS.md                             Codex and repository-wide agent rules
CLAUDE.md                             Claude Code entry point
docs/PROJECT_CONTEXT.md               Product, architecture, API, and invariants
docs/CHANGE_PLAYBOOK.md               Per-change implementation/sync checklist
src/worker.js                         Cloudflare Worker entry (auth, route table)
src/*.js, src/routes/*.js             Worker domain and route modules
actions/hypixel-worker.openapi.json  Hypixel/Worker Custom GPT Action
actions/minecraft-username.openapi.json
actions/skycofl.openapi.json
gpt/instructions.md                  Text pasted into GPT Instructions
gpt/config.md                        Name, description, starters, capabilities, auth
scripts/validate.mjs                 OpenAPI and ChatGPT-limit validation
scripts/test-worker.mjs              Mocked Worker integration tests
.github/workflows/ci.yml             Validation on pushes and pull requests
.github/workflows/deploy-worker.yml  Automatic production deployment
.github/workflows/release.yml        Tagged release ZIPs
wrangler.jsonc                       Cloudflare Worker configuration
```

## Using Codex or Claude Code

The repository includes durable context so a new coding-agent chat does not need this project's original conversation history:

- Codex reads [`AGENTS.md`](AGENTS.md).
- Claude Code reads [`CLAUDE.md`](CLAUDE.md), which directs it to the same authoritative rules.
- Both use [`docs/PROJECT_CONTEXT.md`](docs/PROJECT_CONTEXT.md) for architecture and product intent and [`docs/CHANGE_PLAYBOOK.md`](docs/CHANGE_PLAYBOOK.md) for the exact change/test/deployment workflow.

Start a task with the outcome you want, for example: “Add a compact endpoint for X, update the Action and tests, run validation, and tell me whether I need to update the GPT Builder.” The agent should inspect these context files before editing.

## One-time local setup

Requirements: Git, Node.js 20 or newer, and a Cloudflare account with the existing Worker.

```bash
git clone https://github.com/GSstarGamer/SkyblockGPT.git
cd SkyblockGPT
npm install
npm test
npm run deploy:dry
```

For local Worker development:

```bash
cp .env.example .dev.vars
npm run dev
```

Fill `.dev.vars` locally. It is ignored by Git. Never commit it.

## One-time Cloudflare setup

The Worker name in `wrangler.jsonc` is `skyblock-gpt-proxy`, so deploying this repository updates the existing workers.dev service instead of creating a differently named service.

Log in and perform the first controlled deployment:

```bash
npx wrangler login
npm test
npm run deploy
```

Verify the two runtime secrets in Cloudflare. If either is missing or needs rotation, enter it through Wrangler's hidden prompt:

```bash
npx wrangler secret put HYPIXEL_API_KEY
npx wrangler secret put GPT_SHARED_SECRET
```

Do not create a `COFLNET_ACCOUNT_TOKEN` Worker secret. SkyCofl is a separate direct Custom GPT Action.

Verify production:

```bash
curl https://skyblock-gpt-proxy.girishsonic8.workers.dev/health
```

The health route should return `success: true` and the current Worker version. Player/market routes also require the private `X-GPT-Key` header, so do not put those test commands in public logs.

## Enable automatic Cloudflare deployment

Cloudflare's official GitHub Actions setup requires an account ID and a scoped API token.

1. Open Cloudflare Dashboard → **My Profile → API Tokens → Create Token**.
2. Use the **Edit Cloudflare Workers** template or equivalent Workers Scripts edit permission.
3. Scope the token to only the Cloudflare account that owns `skyblock-gpt-proxy`.
4. Copy the account ID from the Cloudflare dashboard.
5. In GitHub open this repository → **Settings → Secrets and variables → Actions**.
6. Add these repository secrets:
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_API_TOKEN`
7. Open **Actions → Deploy Worker → Run workflow** for the first test deployment.

The workflow runs `npm test` before deployment. The Hypixel API key and GPT shared secret remain in Cloudflare and are not copied into GitHub.

Official references:

- [Cloudflare: deploy Workers with GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [Cloudflare: Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [GitHub: repository Action secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)

## Normal update workflow

Create a branch instead of editing `main` directly:

```bash
git switch -c update/short-description
# edit files
npm test
npm run deploy:dry
git add src actions gpt scripts .github package.json package-lock.json wrangler.jsonc README.md
git commit -m "Describe the SkyBlockGPT update"
git push -u origin update/short-description
```

Open a pull request and wait for the **Validate** check. Merging to `main` automatically deploys the Worker only when Worker/deployment files changed.

Recommended GitHub protection:

1. Repository **Settings → Rules → Rulesets → New branch ruleset**.
2. Target `main`.
3. Require a pull request.
4. Require the `Validate / test` status check.
5. Block force pushes and branch deletion.

## Updating the Custom GPT

When `gpt/` or `actions/` changes, open the GPT editor on the ChatGPT website:

1. Paste [`gpt/instructions.md`](gpt/instructions.md) into **Instructions**.
2. Replace the existing Worker Action schema with [`actions/hypixel-worker.openapi.json`](actions/hypixel-worker.openapi.json).
3. Replace the username schema only if [`actions/minecraft-username.openapi.json`](actions/minecraft-username.openapi.json) changed.
4. Replace the SkyCofl schema only if [`actions/skycofl.openapi.json`](actions/skycofl.openapi.json) changed.
5. Check the authentication settings from [`gpt/config.md`](gpt/config.md); do not paste keys into any schema.
6. Use Preview for one username lookup, one typed Accessories call, one Collections call, and one Bazaar product call.
7. Click **Update**, then start a fresh chat.

The files can also be opened through their GitHub **Raw** buttons, which avoids downloading or unpacking anything.

## Create a clean release ZIP

Update the version in `package.json`, merge it, then tag the commit:

```bash
git tag v12.4.0
git push origin v12.4.0
```

The **Release package** workflow runs all tests, creates one clean ZIP, and attaches it to the GitHub Release. Local Linux/WSL packaging is also available:

```bash
npm run release:zip
```

## Rollback

For a Worker regression, revert the bad Git commit and push/merge the revert into `main`; the deployment workflow publishes the previous code again. Cloudflare's Worker deployment history can also roll back immediately while the Git fix is prepared.

For a GPT configuration regression, use the GPT editor's version history. Action authentication may need to be re-entered after restoring an old GPT version.

## Secret rotation

- Hypixel key: `npx wrangler secret put HYPIXEL_API_KEY`
- GPT shared key: update the Worker with `npx wrangler secret put GPT_SHARED_SECRET`, then update only the Worker Action's stored `X-GPT-Key` credential in ChatGPT.
- Cloudflare CI token: replace `CLOUDFLARE_API_TOKEN` in GitHub Actions secrets.
- SkyCofl token: replace the separate Action's stored Bearer credential in ChatGPT.

Never paste tokens into an issue, commit, pull request, Actions log, OpenAPI file, or GPT conversation.

Creator contact: Discord `gs._`.
