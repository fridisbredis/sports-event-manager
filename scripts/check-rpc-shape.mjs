#!/usr/bin/env node
// MNT: catches the 0045 regression class (PR #123) — a `create or replace
// function` migration that silently drops a jsonb_build_object(...) key an
// earlier version returned. See .claude/CLAUDE.md "RPC return-shape
// contracts" and project memory project_rpc_shape_ci_guard_proposal.
//
// Node only (no shell scripting) so this runs the same way on the Windows
// and macOS machines this team develops on, and in CI.
//
// Usage: node scripts/check-rpc-shape.mjs [baseRef] [headRef]
//   Defaults: baseRef from $BASE_SHA, else "HEAD^"; headRef "HEAD".

import { execFileSync } from 'node:child_process';

const MIGRATIONS_GLOB = 'supabase/migrations/*.sql';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function listMigrationFilesAt(ref) {
  return git(['ls-tree', '-r', '--name-only', ref, '--', 'supabase/migrations'])
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.sql'));
}

function readFileAt(ref, path) {
  try {
    return git(['show', `${ref}:${path}`]);
  } catch {
    return null;
  }
}

// Splits a migration file into one entry per `create or replace function
// public.<name>(...) ... $$;` block, keyed by function name.
function extractFunctionBodies(sql) {
  const bodies = new Map();
  const re = /create\s+or\s+replace\s+function\s+public\.(\w+)\s*\(/gi;
  let match;
  while ((match = re.exec(sql)) !== null) {
    const name = match[1];
    // Find the `as $$ ... $$;` body following this signature.
    const tail = sql.slice(match.index);
    const bodyMatch = tail.match(/as\s+\$\$([\s\S]*?)\$\$\s*;/i);
    if (bodyMatch) {
      bodies.set(name, bodyMatch[1]);
    }
  }
  return bodies;
}

// Extracts string-literal keys from single-line `jsonb_build_object(...)`
// calls that appear in a `return jsonb_build_object(...)` statement.
//
// jsonb_build_object args alternate key, value, key, value — but only the
// key half is ever a quoted string literal in this codebase's RPCs (values
// are bare identifiers/expressions like `v_role_granted`), so every quoted
// string found is a key; no odd/even position filtering needed. (A value
// that also happens to be a string literal, e.g. jsonb_build_object('status',
// 'ok'), would be wrongly counted as a key too — not a problem in practice
// here since a spurious extra "key" only makes the check stricter, never
// blind to a real drop, and no current RPC returns a literal string value.)
//
// Deliberately does not attempt to parse multi-line calls or calls built up
// via `||` (e.g. `v_occ := v_occ || jsonb_build_object(v_key, true)`) —
// those don't occur in this codebase's RPC-return style today (checked
// against 0028/0033/0043/0045/0046) and a dynamic key can't be statically
// diffed anyway.
function extractReturnedJsonbKeys(body) {
  const keys = new Set();
  const re = /return\s+jsonb_build_object\(([^)]*)\)/gi;
  let match;
  while ((match = re.exec(body)) !== null) {
    const args = match[1];
    const keyRe = /'((?:[^'\\]|\\.)*)'/g;
    let keyMatch;
    while ((keyMatch = keyRe.exec(args)) !== null) {
      keys.add(keyMatch[1]);
    }
  }
  return keys;
}

function findFunctionsByName(migrationFiles, ref) {
  // name -> { file, keys }
  const byName = new Map();
  for (const file of migrationFiles) {
    const content = readFileAt(ref, file);
    if (!content) continue;
    const bodies = extractFunctionBodies(content);
    for (const [name, body] of bodies) {
      const keys = extractReturnedJsonbKeys(body);
      if (keys.size === 0) continue;
      // Later migration files (lexically greater filename = higher number
      // prefix) win, since they're the most recent definition as of `ref`.
      const existing = byName.get(name);
      if (!existing || file > existing.file) {
        byName.set(name, { file, keys });
      }
    }
  }
  return byName;
}

// The migration header convention (.claude/CLAUDE.md "Forward-fix plan") is:
//   -- ===...===   (title fence open, line 1)
//   -- Migration NNNN: <title>
//   -- ===...===   (title fence close)
//   --
//   -- <free-text description, Forward-fix block, etc.>
//   -- ===...===   (header fence close)
// i.e. the header body ends at the THIRD `-- ===` fence line, not the
// second — the title itself is wrapped in its own fence pair first.
function headerMentionsKey(newFileContent, key) {
  const fenceRe = /^-- ={10,}\s*$/gm;
  let headerEnd = -1;
  for (let i = 0; i < 3; i++) {
    const m = fenceRe.exec(newFileContent);
    if (!m) {
      headerEnd = -1;
      break;
    }
    headerEnd = m.index;
  }
  const header = headerEnd === -1 ? newFileContent : newFileContent.slice(0, headerEnd);
  return header.includes(key);
}

function main() {
  const baseRef = process.argv[2] || process.env.BASE_SHA || 'HEAD^';
  const headRef = process.argv[3] || 'HEAD';

  const baseFunctions = findFunctionsByName(listMigrationFilesAt(baseRef), baseRef);
  const headFunctions = findFunctionsByName(listMigrationFilesAt(headRef), headRef);

  const failures = [];

  for (const [name, baseInfo] of baseFunctions) {
    const headInfo = headFunctions.get(name);
    if (!headInfo) continue; // function removed entirely — not this check's concern
    if (headInfo.file === baseInfo.file) continue; // definition unchanged in this diff

    const headFileContent = readFileAt(headRef, headInfo.file) || '';
    const missingKeys = [...baseInfo.keys].filter((k) => !headInfo.keys.has(k));

    for (const key of missingKeys) {
      if (headerMentionsKey(headFileContent, key)) {
        console.log(
          `OK   ${headInfo.file}: '${key}' dropped from ${name}(), but Forward-fix header mentions it`
        );
        continue;
      }
      failures.push({ file: headInfo.file, name, key, previousFile: baseInfo.file });
    }
  }

  if (failures.length === 0) {
    console.log('No RPC jsonb return-shape regressions found.');
    return;
  }

  console.log('');
  console.log('FAIL: the following migrations silently change an RPC jsonb return shape:');
  console.log('');
  for (const f of failures) {
    console.log(
      `  ${f.file}: public.${f.name}() no longer returns key '${f.key}' ` +
        `(present in ${f.previousFile})`
    );
  }
  console.log('');
  console.log(
    'If this is intentional, mention the key name in the migration\'s Forward-fix header ' +
      '(e.g. in the Blast: or a note about the return shape) — see .claude/CLAUDE.md ' +
      '"RPC return-shape contracts".'
  );
  console.log(
    'If it is not intentional, this is the exact class of bug PR #123 fixed (0045 silently ' +
      "dropped confirm_official_invite_by_phone's role_granted key) — check the app's " +
      '.rpc(...) call sites for this function before merging.'
  );
  process.exitCode = 1;
}

main();
