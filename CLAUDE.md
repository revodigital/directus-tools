# CLAUDE.md — directus-tools

This repo contains two zero-build-step CLI tools for Directus 11 projects, published as `@revodigital/directus-tools` on npm.

## Structure

```
bin/
  directus-sync.mjs   ← export/import roles, policies, flows, presets, styling
  directus-diff.mjs   ← semantic YAML diff for Directus snapshots
package.json          ← bin entries, yaml dependency, no build step
```

## Key facts

- **No build step.** Both files are plain ESM JavaScript. Edit `bin/` directly.
- **No TypeScript.** `directus-sync.mjs` was originally `sync-config.ts` — types were stripped. Keep it plain JS to avoid a compilation step.
- **One dependency:** `yaml` (used only by `directus-diff`). `directus-sync` uses native `fetch` (Node 18+).
- **`directus-diff` resolves paths from `process.cwd()`**, not from the package location — users run it from their project root.

## Making changes

1. Edit `bin/directus-sync.mjs` or `bin/directus-diff.mjs` directly.
2. Test locally in a consuming project:
   ```bash
   # In directus-tools/
   npm link

   # In the consuming project/
   npm link @revodigital/directus-tools
   directus-sync export --url http://localhost:8630 --token <token> --out /tmp/test-export/
   directus-diff snapshots/snapshot.yaml snapshots/snapshot-export.yaml
   ```
3. Bump version and publish (see README.md).

## Releasing

```bash
npm version patch   # or minor / major
npm publish --access public
git push && git push --tags
```

## What NOT to add here

- Project-specific logic (collection names, Italian locale data, etc.) — keep that in each project's `scripts/seed/`.
- A build step — the zero-build approach is intentional for simplicity.
- The `@directus/sdk` wrapper (`seed/lib/directus.mjs`) — it's project-specific enough to stay per-project for now.
