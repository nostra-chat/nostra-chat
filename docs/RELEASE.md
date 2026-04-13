# Release & Deployment

Detailed reference for the Nostra.chat release pipeline. For the day-to-day rules, see the "Release & Deployment" section in `CLAUDE.md`.

## Pipeline

`.github/workflows/deploy.yml` triggers **only** on `push: tags: v*`. Daily commits to `main` do NOT run CI or deploy — `main` is unprotected, push directly. Tag push runs `pnpm lint` → `npx tsc --noEmit` → `pnpm build` as a server-side gate, then publishes to 4 mirrors.

**Do NOT re-add `push: branches: main` or `pull_request:` triggers** — the pipeline is intentionally tag-triggered so every production update flows through a version tag.

## Live Mirrors

| Mirror | URL |
|---|---|
| Cloudflare (primary) | https://nostra.chat |
| Cloudflare fallback | https://nostra-chat.pages.dev |
| GitHub Pages | https://nostra-chat.github.io/nostra-chat/ |
| IPFS (Filebase) | CID per release |

## Two Release Paths

1. **release-please PR** — merge the open `chore(main): release X.Y.Z` PR that release-please maintains. Creates the tag and triggers deploy with full CHANGELOG. **Do NOT enable auto-merge** on this PR — it accumulates commits, merge it manually when you want to release.
2. **Local `pnpm version patch|minor|major`** — `preversion` runs lint + tsc locally, bumps `package.json`, tags, `postversion` auto-pushes commit + tag.

Never edit `package.json` version or `CHANGELOG.md` manually — one of the two paths always owns them.

## Conventional Commits

| Prefix | Effect |
|---|---|
| `feat:` / `fix:` / `perf:` / `revert:` | Bump version, shown in changelog |
| `docs:` / `chore:` / `style:` / `build:` / `ci:` / `refactor:` / `test:` | Hidden from changelog, non-releasing |
| `feat!:` or `BREAKING CHANGE:` footer | Major bump |

## CI Gotchas

- **release-please PRs don't trigger CI** (`GITHUB_TOKEN` anti-recursion). Under tag-triggered deploy this is harmless — merge immediately.
- **`deploy-ipfs` job permissions**: needs explicit `permissions: contents: read, statuses: write`. Without `statuses: write` the IPFS upload succeeds but the job fails when posting the CID as a commit status.
- **Pinata rejected**: `ipshipyard/ipfs-deploy-action@v1` rejects Pinata as sole provider and requires a CAR upload provider (Filebase works). Do not re-add Pinata.

## Required Secrets

`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `FILEBASE_ACCESS_KEY`, `FILEBASE_SECRET_KEY`, `FILEBASE_BUCKET`.

## Repo Settings

- Settings → Actions → General → Workflow permissions: **"Allow GitHub Actions to create and approve pull requests" MUST stay enabled** or release-please can't open its release PR.
- "Allow auto-merge" is on and usable on feature PRs via `gh pr merge N --auto --squash --delete-branch`. Never on the release-please release PR.
