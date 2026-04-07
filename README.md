# @revodigital/directus-tools

CLI tools for Directus 11 projects. Centrally maintained, installed as a dev dependency.

## Tools

| Command | Description |
|---|---|
| `directus-sync` | Export / import roles, policies, permissions, flows, presets, and styling between Directus environments |
| `directus-diff` | Semantic diff of two Directus snapshot YAML files (ignores key order and formatting) |

## Requirements

Node 18+ (uses native `fetch`). No other runtime dependencies beyond `yaml`.

## Installation

```bash
npm install -D @revodigital/directus-tools
# or
bun add -d @revodigital/directus-tools
```

## directus-sync

Export / import Directus config between environments. Handles UUID remapping automatically (matches entities by name, not UUID).

> **Note:** `npx directus-sync` resolves to the local binary when the package is installed as a dev dependency (recommended). For one-off use without installing, run `npx --package=@revodigital/directus-tools directus-sync` instead.

### Export

```bash
npx directus-sync export --url http://localhost:8630 --token <admin_token> --out scripts/config/
```

### Import

```bash
npx directus-sync import --url https://prod.example.com --token <admin_token> --in scripts/config/
```

### Dry run

```bash
npx directus-sync import --url https://prod.example.com --token <admin_token> --in scripts/config/ --dry-run
```

### Import only specific entities

```bash
npx directus-sync import --url ... --token ... --in scripts/config/ --only styling
npx directus-sync import --url ... --token ... --in scripts/config/ --only roles,policies,permissions
```

### What is synced

| Entity | Match key |
|---|---|
| Roles | name |
| Policies | name |
| Access (role ↔ policy junctions) | role + policy (UUID-remapped) |
| Permissions | policy + collection + action |
| Flows + Operations | flow name / (flow + key) — 4-pass to handle circular refs |
| Presets | collection + role + bookmark (skips user-specific presets) |
| Styling | project name, color, custom CSS, theme overrides, module bar |

Logo and favicon are **not** synced (manage manually).

### Getting an admin token

```bash
curl -X POST http://localhost:8630/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"password"}' | jq .data.access_token
```

Or create a static token under **Settings → Access Tokens**.

## directus-diff

Semantic diff of two Directus snapshot YAML files. Ignores key order, array order, and YAML formatting — shows only real value changes.

> **Note:** Same as above — use `npx directus-diff` when installed locally, or `npx --package=@revodigital/directus-tools directus-diff` for one-off use.

```bash
# Defaults: snapshots/snapshot.yaml vs snapshots/snapshot-export.yaml (relative to cwd)
npx directus-diff

# Custom paths
npx directus-diff path/to/snapshot.yaml path/to/snapshot-export.yaml
```

Exit code: `0` = no differences, `1` = differences found (suitable for CI).

### Typical workflow

```bash
# 1. Export current schema from running Directus
docker compose exec acl2-directus npx directus schema snapshot --yes /directus/snapshots/snapshot-export.yaml

# 2. Diff against the committed snapshot
npx directus-diff snapshots/snapshot.yaml snapshots/snapshot-export.yaml

# 3. If diff looks correct, replace the snapshot
mv snapshots/snapshot-export.yaml snapshots/snapshot.yaml
```

## Publishing a new version

```bash
cd /path/to/directus-tools

# Bump version
npm version patch   # or minor / major

# Publish to npm
npm publish --access public

# Push the version tag
git push && git push --tags
```

### First publish (one-time setup)

```bash
# Log in to npm (create account at npmjs.com if needed)
npm login

# Create the @revodigital org on npmjs.com if not yet done
# Then publish:
npm publish --access public
```
