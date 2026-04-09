#!/usr/bin/env node
/**
 * directus-sync
 * Export / import Flows, Roles, Policies, Permissions, Presets, and Styling between Directus environments.
 * Compatible with Directus 11+ (roles/policies split model).
 *
 * Usage:
 *   npx @revodigital/directus-tools directus-sync export --url http://localhost:8630 --token <token> --out scripts/config/
 *   npx @revodigital/directus-tools directus-sync import --url https://prod.example.com --token <token> --in  scripts/config/
 *
 * Requirements: Node 18+ (uses native fetch — no dependencies)
 *
 * Get an admin token from Directus → Settings → Access Tokens, or via login:
 *   curl -X POST http://localhost:8630/auth/login \
 *     -H "Content-Type: application/json" \
 *     -d '{"email":"admin@example.com","password":"password"}' | jq .data.access_token
 *
 * Directus 11 access control model:
 *   - roles        : organisational unit — has id, name, description, icon, parent, children
 *                    admin_access / app_access / ip_access / enforce_tfa have MOVED to policies
 *   - policies     : set of permissions — has admin_access, app_access, ip_access, enforce_tfa
 *   - directus_access : junction table linking roles (or users) to policies
 *   - permissions  : individual CRUDS rules, attached to a policy
 *
 * UUID reconciliation strategy:
 *   - Roles     : matched by name
 *   - Policies  : matched by name
 *   - Access    : matched by (role + policy) after remapping
 *   - Flows     : matched by name
 *   - Operations: matched by (flow + key)
 *   - Permissions: matched by (policy + collection + action)
 *   - Presets   : matched by (collection + user + role + bookmark)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';

// ─── helpers ──────────────────────────────────────────────────────────────────

function usage() {
  console.log(`
Usage:
  directus-sync export --url <directus_url> --token <admin_token> [--out <dir>]
  directus-sync import --url <directus_url> --token <admin_token> [--in  <dir>]

Options:
  --url      Directus base URL (no trailing slash)
  --token    Admin static token or access token
  --out      Output directory for export (default: ./config-export)
  --in       Input directory for import  (default: ./config-export)
  --dry-run  (import only) print all operations without executing them
  --only     Comma-separated list of entities to process:
             roles, policies, access, permissions, flows, presets, styling
             Default: all

  Styling syncs: project name/descriptor, brand color, custom CSS,
                 theme overrides (light/dark), module bar order.
                 Logo and favicon are excluded (manage manually).
`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      args[key] = (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
    } else if (!args._cmd) {
      args._cmd = argv[i];
    }
  }
  return args;
}

async function api(baseUrl, token, method, path, body) {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${url} → ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function getSystemAll(baseUrl, token, endpoint, fields = ['*']) {
  const params = new URLSearchParams({ fields: fields.join(','), limit: '-1' });
  const res = await api(baseUrl, token, 'GET', `/${endpoint}?${params}`);
  return res?.data ?? [];
}

function saveJson(dir, name, data) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  console.log(`  ✓ saved ${file} (${data.length} items)`);
}

function loadJson(dir, name) {
  const file = join(dir, `${name}.json`);
  if (!existsSync(file)) {
    console.warn(`  ⚠ file not found: ${file} — skipping`);
    return [];
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

// ─── export ───────────────────────────────────────────────────────────────────

async function doExport(baseUrl, token, outDir, only) {
  console.log(`\n📤  EXPORT → ${outDir}`);
  console.log(`    source: ${baseUrl}\n`);

  // Roles — Directus 11: id, name, description, icon, parent only
  // admin_access / app_access / ip_access / enforce_tfa live on policies now
  if (only.includes('roles')) {
    const roles = await getSystemAll(baseUrl, token, 'roles', [
      'id', 'name', 'description', 'icon', 'parent',
    ]);
    saveJson(outDir, 'roles', roles);
  }

  // Policies — Directus 11: admin_access etc. live here
  if (only.includes('policies')) {
    const policies = await getSystemAll(baseUrl, token, 'policies', [
      'id', 'name', 'description', 'icon', 'admin_access', 'app_access', 'ip_access', 'enforce_tfa',
    ]);
    saveJson(outDir, 'policies', policies);
  }

  // directus_access — junction: links roles (or users) to policies
  // Only export role-based assignments (user === null).
  // User-specific entries reference a user UUID that won't exist on the target instance.
  if (only.includes('access')) {
    const access = await getSystemAll(baseUrl, token, 'access', [
      'id', 'role', 'user', 'policy', 'sort',
    ]);
    const roleAccess = access.filter(a => a.user === null);
    if (roleAccess.length < access.length) {
      console.log(`  ⚠ filtered out ${access.length - roleAccess.length} user-specific access entries`);
    }
    saveJson(outDir, 'access', roleAccess);
  }

  // Permissions — attached to policies in Directus 11
  if (only.includes('permissions')) {
    const permissions = await getSystemAll(baseUrl, token, 'permissions', [
      'id', 'policy', 'collection', 'action', 'fields', 'permissions', 'validation', 'presets',
    ]);
    saveJson(outDir, 'permissions', permissions);
  }

  // Flows + Operations
  if (only.includes('flows')) {
    const flows = await getSystemAll(baseUrl, token, 'flows', [
      'id', 'name', 'description', 'icon', 'color', 'status', 'trigger',
      'accountability', 'options', 'operation',
    ]);
    saveJson(outDir, 'flows', flows);

    const operations = await getSystemAll(baseUrl, token, 'operations', [
      'id', 'name', 'key', 'type', 'position_x', 'position_y',
      'options', 'resolve', 'reject', 'flow',
    ]);
    saveJson(outDir, 'operations', operations);
  }

  // Presets
  if (only.includes('presets')) {
    const presets = await getSystemAll(baseUrl, token, 'presets', [
      'id', 'collection', 'user', 'role', 'search', 'filter', 'layout',
      'layout_query', 'layout_options', 'refresh_interval', 'bookmark', 'icon', 'color',
    ]);
    saveJson(outDir, 'presets', presets);
  }

  // Styling — singleton at /settings
  // Excludes file-based fields: project_logo, project_favicon, public_foreground, public_background
  if (only.includes('styling')) {
    const STYLING_FIELDS = [
      'project_name', 'project_descriptor',
      'project_color', 'custom_css',
      'theme_light_overrides', 'theme_dark_overrides',
      'module_bar',
    ];
    const params = new URLSearchParams({ fields: STYLING_FIELDS.join(',') });
    const res = await api(baseUrl, token, 'GET', `/settings?${params}`);
    const settings = res?.data ?? {};
    mkdirSync(outDir, { recursive: true });
    const file = join(outDir, 'styling.json');
    writeFileSync(file, JSON.stringify(settings, null, 2), 'utf8');
    console.log(`  ✓ saved ${file}`);
  }

  console.log('\n✅  Export complete.\n');
}

// ─── import ───────────────────────────────────────────────────────────────────

async function upsertSystem(baseUrl, token, endpoint, items, matchFn, getPayload, dryRun, label) {
  console.log(`\n  → ${label} (${items.length} items)`);
  const existing = await getSystemAll(baseUrl, token, endpoint, ['*']);
  const uuidMap = {};

  for (const item of items) {
    const found = existing.find(e => matchFn(e, item));
    const payload = getPayload(item);

    if (found) {
      uuidMap[item.id] = found.id;
      if (dryRun) {
        console.log(`    [DRY-RUN] PATCH /${endpoint}/${found.id}  (${item.name || item.id})`);
      } else {
        await api(baseUrl, token, 'PATCH', `/${endpoint}/${found.id}`, payload);
        console.log(`    ✓ updated: ${item.name || item.id}`);
      }
    } else {
      if (dryRun) {
        uuidMap[item.id] = `[NEW:${item.id}]`;
        console.log(`    [DRY-RUN] POST /${endpoint}  (new: ${item.name || item.id})`);
      } else {
        const created = await api(baseUrl, token, 'POST', `/${endpoint}`, payload);
        const newId = created?.data?.id ?? created?.id;
        uuidMap[item.id] = newId;
        console.log(`    ✓ created: ${item.name || item.id}  →  ${newId}`);
      }
    }
  }
  return uuidMap;
}

async function doImport(baseUrl, token, inDir, only, dryRun) {
  console.log(`\n📥  IMPORT ← ${inDir}`);
  console.log(`    target: ${baseUrl}${dryRun ? '  [DRY-RUN — no changes will be written]' : ''}\n`);

  const rolemap   = {};
  const policymap = {};
  const flowmap   = {};
  const opmap     = {};

  // 1. Roles (Directus 11 fields only)
  if (only.includes('roles')) {
    const roles = loadJson(inDir, 'roles');
    // parent remapping: first pass without parent, second pass to wire parent
    const map = await upsertSystem(
      baseUrl, token, 'roles', roles,
      (e, s) => e.name === s.name,
      ({ name, description, icon }) => ({ name, description, icon }),
      dryRun, 'Roles'
    );
    Object.assign(rolemap, map);

    // Wire parent relationships after all roles are created
    if (!dryRun) {
      for (const role of roles) {
        if (role.parent) {
          const targetId = rolemap[role.id];
          const targetParent = rolemap[role.parent] ?? role.parent;
          if (targetId && !String(targetId).startsWith('[')) {
            await api(baseUrl, token, 'PATCH', `/roles/${targetId}`, { parent: targetParent });
          }
        }
      }
    }
  }

  // 2. Policies (admin_access, app_access, etc. live here in Directus 11)
  if (only.includes('policies')) {
    const policies = loadJson(inDir, 'policies');
    const map = await upsertSystem(
      baseUrl, token, 'policies', policies,
      (e, s) => e.name === s.name,
      ({ name, description, icon, admin_access, app_access, ip_access, enforce_tfa }) =>
        ({ name, description, icon, admin_access, app_access, ip_access, enforce_tfa }),
      dryRun, 'Policies'
    );
    Object.assign(policymap, map);
  }

  // 3. Access — junction between roles/users and policies
  if (only.includes('access')) {
    const accessItems = loadJson(inDir, 'access');
    console.log(`\n  → Access links (${accessItems.length} items)`);

    const existing = await getSystemAll(baseUrl, token, 'access', ['id', 'role', 'user', 'policy']);

    for (const item of accessItems) {
      const targetRole   = item.role   ? (rolemap[item.role]     ?? item.role)   : null;
      const targetPolicy = item.policy ? (policymap[item.policy] ?? item.policy) : null;

      const found = existing.find(e =>
        e.role   === targetRole &&
        e.user   === item.user &&
        e.policy === targetPolicy
      );

      const payload = { role: targetRole, user: item.user, policy: targetPolicy, sort: item.sort };

      if (found) {
        if (dryRun) {
          console.log(`    [DRY-RUN] PATCH /access/${found.id}  (role:${targetRole} → policy:${targetPolicy})`);
        } else {
          await api(baseUrl, token, 'PATCH', `/access/${found.id}`, payload);
          console.log(`    ✓ updated access link: role:${targetRole} → policy:${targetPolicy}`);
        }
      } else {
        if (dryRun) {
          console.log(`    [DRY-RUN] POST /access  (role:${targetRole} → policy:${targetPolicy})`);
        } else {
          await api(baseUrl, token, 'POST', '/access', payload);
          console.log(`    ✓ created access link: role:${targetRole} → policy:${targetPolicy}`);
        }
      }
    }
  }

  // 4. Permissions (linked to policies in Directus 11)
  if (only.includes('permissions')) {
    const permissions = loadJson(inDir, 'permissions');
    console.log(`\n  → Permissions (${permissions.length} items)`);

    // ⚠ Do NOT use fields=* here: Directus expands relational fields as nested objects
    //   (e.g. policy → {id:"...", name:"..."}) which breaks the string equality match.
    //   Request only the flat scalar fields needed for matching.
    const existing = await getSystemAll(baseUrl, token, 'permissions', [
      'id', 'policy', 'collection', 'action',
    ]);

    // Warn about unmapped policy UUIDs (happens when --only permissions is used alone)
    const unmappedPolicies = new Set();

    for (const perm of permissions) {
      // perm.policy is the SOURCE UUID — map it to the TARGET UUID via policymap
      const targetPolicyId = policymap[perm.policy] ?? perm.policy;
      if (!policymap[perm.policy]) unmappedPolicies.add(perm.policy);

      const found = existing.find(e =>
        e.policy     === targetPolicyId &&
        e.collection === perm.collection &&
        e.action     === perm.action
      );

      const payload = {
        policy:      targetPolicyId,
        collection:  perm.collection,
        action:      perm.action,
        fields:      perm.fields,
        permissions: perm.permissions,
        validation:  perm.validation,
        presets:     perm.presets,
      };

      if (found) {
        if (!found.id) {
          console.warn(`    ⚠ skipped ${perm.collection}.${perm.action}: match found but id is missing. raw=${JSON.stringify(found)}`);
          continue;
        }
        if (dryRun) {
          console.log(`    [DRY-RUN] PATCH /permissions/${found.id}  (${perm.collection}.${perm.action})`);
        } else {
          await api(baseUrl, token, 'PATCH', `/permissions/${found.id}`, payload);
          console.log(`    ✓ updated permission: ${perm.collection}.${perm.action}`);
        }
      } else {
        if (dryRun) {
          console.log(`    [DRY-RUN] POST /permissions  (new: ${perm.collection}.${perm.action})`);
        } else {
          await api(baseUrl, token, 'POST', '/permissions', payload);
          console.log(`    ✓ created permission: ${perm.collection}.${perm.action}`);
        }
      }
    }

    if (unmappedPolicies.size > 0) {
      console.warn(`\n    ⚠ ${unmappedPolicies.size} permission(s) used unmapped policy UUIDs (source UUID used as-is):`);
      for (const uuid of unmappedPolicies) console.warn(`      ${uuid}`);
      console.warn(`      → always run sync with roles+policies+permissions together`);
    }
  }

  // 5. Flows + Operations (4-pass strategy to handle circular UUID references)
  //   a) Upsert flows without `operation`
  //   b) Upsert operations without `resolve` / `reject`
  //   c) Patch operations to wire resolve / reject
  //   d) Patch flows to set entry operation
  if (only.includes('flows')) {
    const flows      = loadJson(inDir, 'flows');
    const operations = loadJson(inDir, 'operations');
    console.log(`\n  → Flows (${flows.length} flows, ${operations.length} operations)`);

    const existingFlows = await getSystemAll(baseUrl, token, 'flows',      ['id', 'name', 'operation']);
    const existingOps   = await getSystemAll(baseUrl, token, 'operations', ['id', 'name', 'key', 'flow']);

    // a) Flows — omit `operation`
    for (const flow of flows) {
      const found = existingFlows.find(e => e.name === flow.name);
      const payload = {
        name: flow.name, description: flow.description, icon: flow.icon,
        color: flow.color, status: flow.status, trigger: flow.trigger,
        accountability: flow.accountability, options: flow.options,
      };
      if (found) {
        flowmap[flow.id] = found.id;
        if (!dryRun) {
          await api(baseUrl, token, 'PATCH', `/flows/${found.id}`, payload);
          console.log(`    ✓ flow updated: ${flow.name}`);
        } else {
          console.log(`    [DRY-RUN] flow PATCH: ${flow.name}`);
        }
      } else {
        if (!dryRun) {
          const created = await api(baseUrl, token, 'POST', '/flows', payload);
          const newId = created?.data?.id ?? created?.id;
          flowmap[flow.id] = newId;
          console.log(`    ✓ flow created: ${flow.name}  →  ${newId}`);
        } else {
          flowmap[flow.id] = `[NEW:${flow.id}]`;
          console.log(`    [DRY-RUN] flow POST: ${flow.name}`);
        }
      }
    }

    // b) Operations — omit `resolve` / `reject`
    for (const op of operations) {
      const targetFlowId = flowmap[op.flow] ?? op.flow;
      const found = existingOps.find(e => e.flow === targetFlowId && e.key === op.key);
      const payload = {
        name: op.name, key: op.key, type: op.type,
        position_x: op.position_x, position_y: op.position_y,
        options: op.options, flow: targetFlowId,
      };
      if (found) {
        opmap[op.id] = found.id;
        if (!dryRun) await api(baseUrl, token, 'PATCH', `/operations/${found.id}`, payload);
        else console.log(`    [DRY-RUN] operation PATCH: ${op.name}`);
      } else {
        if (!dryRun) {
          const created = await api(baseUrl, token, 'POST', '/operations', payload);
          const newId = created?.data?.id ?? created?.id;
          opmap[op.id] = newId;
          console.log(`    ✓ operation created: ${op.name}  →  ${newId}`);
        } else {
          opmap[op.id] = `[NEW:${op.id}]`;
          console.log(`    [DRY-RUN] operation POST: ${op.name}`);
        }
      }
    }

    // c) Wire operation resolve / reject
    if (!dryRun) {
      for (const op of operations) {
        const targetOpId = opmap[op.id];
        if (!targetOpId || String(targetOpId).startsWith('[')) continue;
        const patch = {};
        if (op.resolve) patch.resolve = opmap[op.resolve] ?? op.resolve;
        if (op.reject)  patch.reject  = opmap[op.reject]  ?? op.reject;
        if (Object.keys(patch).length > 0) {
          await api(baseUrl, token, 'PATCH', `/operations/${targetOpId}`, patch);
        }
      }
      console.log(`    ✓ operation links wired (resolve / reject)`);
    }

    // d) Set flow entry operations
    if (!dryRun) {
      for (const flow of flows) {
        const targetFlowId = flowmap[flow.id];
        if (!targetFlowId || String(targetFlowId).startsWith('[')) continue;
        if (flow.operation) {
          const targetOpId = opmap[flow.operation] ?? flow.operation;
          await api(baseUrl, token, 'PATCH', `/flows/${targetFlowId}`, { operation: targetOpId });
        }
      }
      console.log(`    ✓ flow entry operations set`);
    }
  }

  // 6. Presets
  if (only.includes('presets')) {
    const presets = loadJson(inDir, 'presets');
    console.log(`\n  → Presets (${presets.length} items)`);

    const existing = await getSystemAll(baseUrl, token, 'presets', [
      'id', 'collection', 'user', 'role', 'bookmark',
    ]);

    for (const preset of presets) {
      // Skip user-specific presets: user UUIDs differ between instances
      // Only sync global presets (user: null) — role-scoped or collection defaults
      if (preset.user) {
        console.log(`    ⚠ skipped user-specific preset: ${preset.collection} (user: ${preset.user})`);
        continue;
      }
      const targetRoleId = preset.role ? (rolemap[preset.role] ?? preset.role) : null;
      const found = existing.find(e =>
        e.collection === preset.collection &&
        e.user       === preset.user &&
        e.role       === targetRoleId &&
        e.bookmark   === preset.bookmark
      );
      const payload = {
        collection: preset.collection, user: preset.user, role: targetRoleId,
        search: preset.search, filter: preset.filter, layout: preset.layout,
        layout_query: preset.layout_query, layout_options: preset.layout_options,
        refresh_interval: preset.refresh_interval,
        bookmark: preset.bookmark, icon: preset.icon, color: preset.color,
      };
      if (found) {
        if (dryRun) console.log(`    [DRY-RUN] PATCH /presets/${found.id}  (${preset.collection})`);
        else {
          await api(baseUrl, token, 'PATCH', `/presets/${found.id}`, payload);
          console.log(`    ✓ updated preset: ${preset.collection}`);
        }
      } else {
        if (dryRun) console.log(`    [DRY-RUN] POST /presets  (${preset.collection})`);
        else {
          await api(baseUrl, token, 'POST', '/presets', payload);
          console.log(`    ✓ created preset: ${preset.collection}`);
        }
      }
    }
  }

  // 7. Styling — singleton PATCH /settings
  if (only.includes('styling')) {
    const file = join(inDir, 'styling.json');
    if (!existsSync(file)) {
      console.warn(`\n  ⚠ styling.json not found in ${inDir} — skipping`);
    } else {
      const settings = JSON.parse(readFileSync(file, 'utf8'));
      console.log(`\n  → Styling (project settings)`);

      // Only send the fields we manage — never touch logo/favicon/file refs
      const payload = {
        project_name:          settings.project_name          ?? null,
        project_descriptor:    settings.project_descriptor    ?? null,
        project_color:         settings.project_color         ?? null,
        custom_css:            settings.custom_css            ?? null,
        theme_light_overrides: settings.theme_light_overrides ?? {},
        theme_dark_overrides:  settings.theme_dark_overrides  ?? {},
        module_bar:            settings.module_bar            ?? [],
      };

      if (dryRun) {
        console.log(`    [DRY-RUN] PATCH /settings`);
        console.log(`    project_name: ${payload.project_name}`);
        console.log(`    project_color: ${payload.project_color}`);
        console.log(`    custom_css: ${payload.custom_css ? `(${payload.custom_css.length} chars)` : 'null'}`);
        console.log(`    module_bar: ${payload.module_bar.length} entries`);
      } else {
        await api(baseUrl, token, 'PATCH', '/settings', payload);
        console.log(`    ✓ settings updated`);
        if (payload.project_name)  console.log(`      project_name:  ${payload.project_name}`);
        if (payload.project_color) console.log(`      project_color: ${payload.project_color}`);
        if (payload.custom_css)    console.log(`      custom_css:    ${payload.custom_css.length} chars`);
        console.log(`      module_bar:    ${payload.module_bar.length} entries`);
      }
    }
  }

  console.log('\n✅  Import complete.\n');
}

// ─── main ─────────────────────────────────────────────────────────────────────

const ALL_ENTITIES = ['roles', 'policies', 'access', 'permissions', 'flows', 'presets', 'styling'];

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args._cmd || !['export', 'import'].includes(args._cmd)) usage();
  if (!args.url)   { console.error('❌  --url is required');   usage(); }
  if (!args.token) { console.error('❌  --token is required'); usage(); }

  const baseUrl = args.url.replace(/\/$/, '');
  const token   = args.token;
  const dryRun  = args['dry-run'] === true;
  const only    = args.only
    ? args.only.split(',').map(s => s.trim()).filter(Boolean)
    : ALL_ENTITIES;

  try {
    const info = await api(baseUrl, token, 'GET', '/server/info');
    const version = info?.data?.directus?.version ?? '?';
    console.log(`🔗  Connected: Directus ${version} at ${baseUrl}`);
    if (version && parseInt(version) < 11) {
      console.warn(`⚠   Warning: this script targets Directus 11+. Your version (${version}) may use a different roles/policies model.`);
    }
  } catch (e) {
    console.error(`❌  Cannot connect to ${baseUrl}: ${e?.message ?? e}`);
    process.exit(1);
  }

  if (args._cmd === 'export') {
    const outDir = resolve(args.out ?? './config-export');
    await doExport(baseUrl, token, outDir, only);
  } else {
    const inDir = resolve(args.in ?? './config-export');
    await doImport(baseUrl, token, inDir, only, dryRun);
  }
}

main().catch((e) => {
  console.error('\n❌  Fatal error:', e?.message ?? e);
  process.exit(1);
});
