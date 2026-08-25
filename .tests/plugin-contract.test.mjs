import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { validateGhostManifest } from './contracts/plugin-manifest.014a471.mjs';

const root = path.resolve(import.meta.dirname, '..');

const MAX_BASIC_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
const MAX_SERVER_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_ICON_BYTES = 512 * 1024;
const MAX_LOCALE_BYTES = 64 * 1024;
const MAX_SKILL_MD_BYTES = 64 * 1024;
const MAX_MANUAL_MD_BYTES = 64 * 1024;
const ROOT_PACKAGE_FILES = ['LICENSE', 'NOTICE', 'TRADEMARKS.md', 'TRADEMARKS.zh-CN.md'];
const RESERVED_CLIENT_FILES = new Set(['.disabled', '.cindy-trust.json']);
const RESERVED_RECORD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const PUBLIC_SKILL_EXEMPTIONS = new Set(['ios-simulator', 'taptap-maker', 'x-manager']);
const OFFICIAL_SLOTS = new Set([
  'subscribe', 'tool', 'card', 'panel', 'cindy', 'agent', 'node', 'network',
  'notify', 'badge', 'confirm', 'fs', 'session-context', 'pick', 'preview',
  'library', 'skill', 'workspace', 'ios-simulator',
]);

const pluginDirs = pluginRootsAt('HEAD');
const provisioning = readJson(path.join(root, 'provisioning.json'));

function readUtf8(file, maxBytes = Number.POSITIVE_INFINITY) {
  const bytes = fs.readFileSync(file);
  assert.ok(bytes.byteLength <= maxBytes, `${path.relative(root, file)} exceeds ${maxBytes} bytes`);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function readJson(file, maxBytes) {
  return JSON.parse(readUtf8(file, maxBytes));
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

function trackedFiles(pluginDir) {
  const output = execFileSync(
    'git',
    ['ls-tree', '-r', '-z', 'HEAD', '--', pluginDir],
    { cwd: root, encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 },
  );
  const files = new Map();
  for (const record of output.toString('utf8').split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    assert.ok(tab > 0, `unexpected git ls-tree record for ${pluginDir}`);
    const [mode] = record.slice(0, tab).split(' ');
    const fullPath = record.slice(tab + 1);
    const relativePath = fullPath.slice(pluginDir.length + 1);
    files.set(relativePath, { mode, fullPath, absolutePath: path.join(root, fullPath) });
  }
  return files;
}

function requireTrackedFile(files, pluginDir, relativePath, maxBytes) {
  const entry = files.get(relativePath);
  assert.ok(entry, `${pluginDir}: declared file is not tracked: ${relativePath}`);
  assert.ok(entry.mode === '100644' || entry.mode === '100755', `${pluginDir}: not a regular file: ${relativePath}`);
  const size = fs.statSync(entry.absolutePath).size;
  if (maxBytes !== undefined) {
    assert.ok(size <= maxBytes, `${pluginDir}/${relativePath} exceeds ${maxBytes} bytes`);
  }
  return entry.absolutePath;
}

function isSafePackagePath(value) {
  if (!value || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false;
  const segments = value.split('/');
  return segments.every((segment) =>
    segment !== '' &&
    segment !== '.' &&
    segment !== '..' &&
    segment !== '__MACOSX' &&
    !/[\u0000-\u001f<>:"|?*]/.test(segment) &&
    !/[ .]$/.test(segment) &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment));
}

function jsonPointerEscape(value) {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function collectSchemaTextPointers(schema, pointer = '', result = new Map()) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return result;
  const fields = new Set();
  if (typeof schema.title === 'string') fields.add('title');
  if (typeof schema.description === 'string') fields.add('description');
  if (fields.size > 0) result.set(pointer, fields);
  for (const keyword of ['$defs', 'definitions', 'properties', 'patternProperties', 'dependentSchemas']) {
    const children = schema[keyword];
    if (!children || typeof children !== 'object' || Array.isArray(children)) continue;
    for (const [key, child] of Object.entries(children)) {
      collectSchemaTextPointers(child, `${pointer}/${jsonPointerEscape(keyword)}/${jsonPointerEscape(key)}`, result);
    }
  }
  for (const keyword of ['items', 'additionalProperties', 'contains', 'propertyNames', 'if', 'then', 'else', 'not']) {
    collectSchemaTextPointers(schema[keyword], `${pointer}/${jsonPointerEscape(keyword)}`, result);
  }
  for (const keyword of ['allOf', 'anyOf', 'oneOf', 'prefixItems']) {
    const children = schema[keyword];
    if (!Array.isArray(children)) continue;
    children.forEach((child, index) =>
      collectSchemaTextPointers(child, `${pointer}/${jsonPointerEscape(keyword)}/${index}`, result));
  }
  return result;
}

function assertText(value, label, max) {
  assert.equal(typeof value, 'string', `${label} must be a string`);
  assert.ok(value.trim().length > 0 && value.length <= max, `${label} must contain 1-${max} characters`);
}

function validateOfficialManifest(pluginDir, manifest) {
  assert.ok(manifest && typeof manifest === 'object' && !Array.isArray(manifest), `${pluginDir}/ghost.json must be an object`);
  const protocolResult = validateGhostManifest(manifest);
  assert.ok(protocolResult.ok, `${pluginDir}/ghost.json is rejected by Cindy: ${protocolResult.reason}`);
  assert.ok(manifest.schemaVersion === 2 || manifest.schemaVersion === 3, `${pluginDir}: unsupported ghost.json schemaVersion`);
  assert.match(manifest.id ?? '', /^[a-z0-9][a-z0-9-]{0,31}$/, `${pluginDir}: invalid plugin id`);
  stableSemver(manifest.version, pluginDir);
  assertText(manifest.name, `${pluginDir}.name`, 64);
  assertText(manifest.description, `${pluginDir}.description`, 300);
  assertText(manifest.whenToUse, `${pluginDir}.whenToUse`, 300);
  if (manifest.author !== undefined) assertText(manifest.author, `${pluginDir}.author`, 64);
  assert.ok(isSafePackagePath(manifest.entry), `${pluginDir}.entry must be a safe relative path`);
  assert.ok(manifest.launch === undefined || manifest.launch === 'on-demand' || manifest.launch === 'resident', `${pluginDir}.launch must be on-demand or resident`);
  if (manifest.schemaVersion === 2) {
    assert.ok(Array.isArray(manifest.slots), `${pluginDir}.slots must be an array`);
    assert.equal(new Set(manifest.slots).size, manifest.slots.length, `${pluginDir}.slots contains duplicates`);
    for (const slot of manifest.slots) assert.ok(OFFICIAL_SLOTS.has(slot), `${pluginDir}: unknown slot ${JSON.stringify(slot)}`);
  } else {
    assert.equal(Object.hasOwn(manifest, 'slots'), false, `${pluginDir}: Manifest v3 must not contain slots`);
    assertManifestV3Floor(pluginDir, manifest);
  }
  if (manifest.tools !== undefined) {
    assert.ok(Array.isArray(manifest.tools) && manifest.tools.length > 0 && manifest.tools.length <= 16, `${pluginDir}.tools must contain 1-16 entries`);
    const toolNames = new Set();
    for (const tool of manifest.tools) {
      assert.ok(tool && typeof tool === 'object' && !Array.isArray(tool), `${pluginDir}.tools entries must be objects`);
      assert.match(tool.name ?? '', /^[a-z][a-z0-9_-]{0,63}$/, `${pluginDir}: invalid tool name`);
      assert.ok(!toolNames.has(tool.name), `${pluginDir}: duplicate tool name ${tool.name}`);
      toolNames.add(tool.name);
      assertText(tool.description, `${pluginDir}.tools.${tool.name}.description`, 1024);
      if (tool.parameters !== undefined) {
        assert.ok(tool.parameters && typeof tool.parameters === 'object' && !Array.isArray(tool.parameters), `${pluginDir}.tools.${tool.name}.parameters must be an object`);
        assert.ok(JSON.stringify(tool.parameters).length <= 16_384, `${pluginDir}.tools.${tool.name}.parameters exceeds 16KB`);
      }
    }
  }
  if (manifest.schemaVersion === 2) {
    assert.equal(manifest.slots.includes('tool'), manifest.tools !== undefined, `${pluginDir}: tool slot and tools declarations must appear together`);
  }
  return manifest;
}

function validateLocalizedLabels(raw, declarations, label) {
  if (raw === undefined) return;
  assert.ok(declarations.length > 0, `${label} is present but the manifest declares no matching items`);
  assert.ok(raw && typeof raw === 'object' && !Array.isArray(raw), `${label} must be an object`);
  const expected = new Map(declarations.map((item) => [item.key, item]));
  for (const [key, localized] of Object.entries(raw)) {
    const declaration = expected.get(key);
    assert.ok(declaration, `${label} contains unknown key ${key}`);
    assert.ok(localized && typeof localized === 'object' && !Array.isArray(localized), `${label}.${key} must be an object`);
    const allowed = new Set(declaration.hint === undefined ? ['label'] : ['label', 'hint']);
    for (const field of Object.keys(localized)) assert.ok(allowed.has(field), `${label}.${key} contains unknown field ${field}`);
    assertText(localized.label, `${label}.${key}.label`, 64);
    if (localized.hint !== undefined) assertText(localized.hint, `${label}.${key}.hint`, 200);
  }
}

function validateLocaleResource(pluginDir, locale, raw, manifest) {
  const label = `${pluginDir}/locales.${locale}`;
  assert.ok(raw && typeof raw === 'object' && !Array.isArray(raw), `${label} must be an object`);
  const allowed = new Set(['name', 'description', 'whenToUse', 'tools', 'panel', 'network', 'node', 'setup']);
  for (const field of Object.keys(raw)) assert.ok(allowed.has(field), `${label} contains unknown field ${field}`);
  assertText(raw.name, `${label}.name`, 64);
  assertText(raw.description, `${label}.description`, 300);
  assertText(raw.whenToUse, `${label}.whenToUse`, 300);

  const expectedTools = new Map((manifest.tools ?? []).map((tool) => [tool.name, tool]));
  const actualTools = raw.tools ?? {};
  assert.ok(actualTools && typeof actualTools === 'object' && !Array.isArray(actualTools), `${label}.tools must be an object`);
  assert.deepEqual(Object.keys(actualTools).sort(), [...expectedTools.keys()].sort(), `${label}.tools keys`);
  for (const [name, localized] of Object.entries(actualTools)) {
    const tool = expectedTools.get(name);
    assert.ok(tool, `${label}.tools contains unknown tool ${name}`);
    assert.ok(localized && typeof localized === 'object' && !Array.isArray(localized), `${label}.tools.${name} must be an object`);
    for (const field of Object.keys(localized)) {
      assert.ok(field === 'description' || field === 'parameters', `${label}.tools.${name} contains unknown field ${field}`);
    }
    assertText(localized.description, `${label}.tools.${name}.description`, 1024);
    if (localized.parameters !== undefined) {
      assert.ok(localized.parameters && typeof localized.parameters === 'object' && !Array.isArray(localized.parameters), `${label}.tools.${name}.parameters must be an object`);
      const expectedPointers = collectSchemaTextPointers(tool.parameters);
      assert.ok(expectedPointers.size > 0, `${label}.tools.${name}.parameters is present but the schema has no localizable text`);
      for (const [pointer, text] of Object.entries(localized.parameters)) {
        assert.ok(expectedPointers.has(pointer), `${label}.tools.${name}.parameters contains unknown pointer ${pointer}`);
        assert.ok(text && typeof text === 'object' && !Array.isArray(text), `${label}.tools.${name}.parameters.${pointer} must be an object`);
        const allowedFields = expectedPointers.get(pointer);
        for (const field of Object.keys(text)) assert.ok(allowedFields.has(field), `${label}.tools.${name}.parameters.${pointer} contains unknown field ${field}`);
        if (text.title !== undefined) assertText(text.title, `${label}.tools.${name}.parameters.${pointer}.title`, 256);
        if (text.description !== undefined) assertText(text.description, `${label}.tools.${name}.parameters.${pointer}.description`, 1024);
      }
    }
  }

  if (raw.panel !== undefined) {
    assert.ok(manifest.panel?.title, `${label}.panel is present but manifest.panel.title is absent`);
    assert.ok(raw.panel && typeof raw.panel === 'object' && !Array.isArray(raw.panel), `${label}.panel must be an object`);
    assert.deepEqual(Object.keys(raw.panel), ['title'], `${label}.panel fields`);
    assertText(raw.panel.title, `${label}.panel.title`, 64);
  }
  if (raw.network !== undefined) {
    assert.ok(raw.network && typeof raw.network === 'object' && !Array.isArray(raw.network), `${label}.network must be an object`);
    assert.ok((manifest.network?.secrets?.length ?? 0) + (manifest.network?.connections?.length ?? 0) > 0, `${label}.network is present but the manifest declares no credentials or connections`);
    const allowedNetwork = new Set(['secrets', 'connections']);
    for (const field of Object.keys(raw.network)) assert.ok(allowedNetwork.has(field), `${label}.network contains unknown field ${field}`);
    validateLocalizedLabels(raw.network.secrets, manifest.network?.secrets ?? [], `${label}.network.secrets`);
    validateLocalizedLabels(raw.network.connections, manifest.network?.connections ?? [], `${label}.network.connections`);
  }
  if (raw.node !== undefined) {
    assert.ok(raw.node && typeof raw.node === 'object' && !Array.isArray(raw.node), `${label}.node must be an object`);
    assert.ok((manifest.node?.secretBindings?.length ?? 0) > 0, `${label}.node is present but the manifest declares no secret bindings`);
    assert.deepEqual(Object.keys(raw.node), ['secretBindings'], `${label}.node fields`);
    validateLocalizedLabels(raw.node.secretBindings, manifest.node?.secretBindings ?? [], `${label}.node.secretBindings`);
  }
  if (raw.setup !== undefined) {
    assert.ok(raw.setup && typeof raw.setup === 'object' && !Array.isArray(raw.setup), `${label}.setup must be an object`);
    assert.deepEqual(Object.keys(raw.setup), ['kv'], `${label}.setup fields`);
    const declarations = [];
    for (const group of manifest.setup?.requires ?? []) {
      for (const requirement of group.anyOf) {
        if (requirement.kind === 'kv') declarations.push({ key: requirement.key });
      }
    }
    validateLocalizedLabels(raw.setup.kv, declarations, `${label}.setup.kv`);
  }
}

function parseFrontmatterScalar(raw, label) {
  const value = raw.trim();
  if (value.startsWith("'")) {
    assert.ok(value.endsWith("'"), `${label} must be a single-line YAML scalar without a trailing comment`);
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (value.startsWith('"')) {
    assert.ok(value.endsWith('"'), `${label} must be a single-line YAML scalar without a trailing comment`);
    try {
      return JSON.parse(value);
    } catch {
      assert.fail(`${label} must use valid JSON-compatible escapes when double quoted`);
    }
  }
  const comment = value.startsWith('#') ? 0 : value.search(/\s+#/);
  const plain = (comment === -1 ? value : value.slice(0, comment)).trimEnd();
  assert.doesNotMatch(plain, /:\s/, `${label} containing ": " must be quoted`);
  return plain;
}

function validateSkillFrontmatter(pluginDir, file, item) {
  const source = readUtf8(file, MAX_SKILL_MD_BYTES).replaceAll('\r\n', '\n');
  assert.ok(source.startsWith('---\n'), `${pluginDir}/${item.dir}/SKILL.md must start with YAML frontmatter`);
  const end = source.indexOf('\n---\n', 4);
  assert.ok(end > 4, `${pluginDir}/${item.dir}/SKILL.md has unterminated YAML frontmatter`);
  const values = new Map();
  for (const line of source.slice(4, end).split('\n')) {
    const match = /^(name|description):\s*(.+)$/.exec(line);
    if (!match) continue;
    assert.ok(!values.has(match[1]), `${pluginDir}/${item.dir}/SKILL.md repeats ${match[1]}`);
    values.set(match[1], parseFrontmatterScalar(match[2], `${pluginDir}/${item.dir}/SKILL.md ${match[1]}`));
  }
  assert.equal(values.get('name'), item.name, `${pluginDir}/${item.dir}/SKILL.md frontmatter name must match ghost.json`);
  assert.equal(values.get('description'), item.description, `${pluginDir}/${item.dir}/SKILL.md frontmatter description must match ghost.json`);
}

function validateSetup(pluginDir, raw, manifest) {
  if (raw.setup === undefined) return undefined;
  const label = `${pluginDir}/ghost.json.setup`;
  assert.ok(raw.setup && typeof raw.setup === 'object' && !Array.isArray(raw.setup), `${label} must be an object`);
  assert.ok(Array.isArray(raw.setup.requires) && raw.setup.requires.length <= 8, `${label}.requires must contain 0-8 groups`);
  const secrets = new Map([
    ...(manifest.network?.secrets ?? []).map((item) => [item.key, item]),
    ...(manifest.node?.secretBindings ?? []).map((item) => [item.key, item]),
  ]);
  const connections = new Set((manifest.network?.connections ?? []).map((item) => item.key));
  const groups = [];
  for (const [groupIndex, group] of raw.setup.requires.entries()) {
    assert.ok(group && typeof group === 'object' && !Array.isArray(group), `${label}.requires[${groupIndex}] must be an object`);
    assert.ok(Array.isArray(group.anyOf) && group.anyOf.length > 0 && group.anyOf.length <= 8, `${label}.requires[${groupIndex}].anyOf must contain 1-8 items`);
    const seen = new Set();
    const items = [];
    for (const requirement of group.anyOf) {
      let normalized;
      if (typeof requirement === 'string') {
        const match = /^(secret|connection):(.+)$/.exec(requirement);
        assert.ok(match, `${label}: invalid requirement ${JSON.stringify(requirement)}`);
        const [, kind, key] = match;
        if (kind === 'secret') {
          const declaration = secrets.get(key);
          assert.ok(declaration, `${label}: secret ${key} is not declared`);
          assert.notEqual(declaration.source, 'login-email', `${label}: login-email secrets are always ready and cannot be setup requirements`);
        } else {
          assert.ok(connections.has(key), `${label}: connection ${key} is not declared`);
        }
        normalized = { kind, key };
      } else {
        assert.ok(requirement && typeof requirement === 'object' && !Array.isArray(requirement), `${label}: requirements must be secret/connection references or kv objects`);
        assert.match(requirement.kv ?? '', /^[A-Za-z0-9_.-]{1,64}$/, `${label}: invalid kv key`);
        assert.ok(!RESERVED_RECORD_KEYS.has(requirement.kv), `${label}: reserved kv key ${requirement.kv}`);
        assertText(requirement.label, `${label}: kv ${requirement.kv} label`, 64);
        assert.ok(manifest.settingsHtml, `${label}: kv requirements need settingsHtml`);
        normalized = { kind: 'kv', key: requirement.kv, label: requirement.label };
      }
      const ref = `${normalized.kind}:${normalized.key}`;
      assert.ok(!seen.has(ref), `${label}: duplicate requirement ${ref} in one group`);
      seen.add(ref);
      items.push(normalized);
    }
    groups.push({ anyOf: items });
  }
  return { requires: groups };
}

function validatePluginSource(pluginDir, manifest) {
  const files = trackedFiles(pluginDir);
  assert.ok(files.size > 0, `${pluginDir}: no tracked package files`);
  const seenFolded = new Map();
  let totalBytes = 0;
  for (const [relativePath, entry] of files) {
    assert.ok(isSafePackagePath(relativePath), `${pluginDir}: unsafe package path ${relativePath}`);
    assert.ok(entry.mode === '100644' || entry.mode === '100755', `${pluginDir}: symlinks and special files are forbidden: ${relativePath}`);
    const folded = relativePath.normalize('NFC').toLowerCase();
    assert.ok(!seenFolded.has(folded), `${pluginDir}: case-insensitive path conflict: ${seenFolded.get(folded)} / ${relativePath}`);
    seenFolded.set(folded, relativePath);
    totalBytes += fs.statSync(entry.absolutePath).size;
  }
  for (const [folded, relativePath] of seenFolded) {
    const segments = folded.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      const ancestor = segments.slice(0, index).join('/');
      assert.ok(!seenFolded.has(ancestor), `${pluginDir}: file/directory path conflict: ${seenFolded.get(ancestor)} / ${relativePath}`);
    }
  }
  for (const rootFile of ROOT_PACKAGE_FILES) {
    const foldedRootFile = rootFile.toLowerCase();
    for (const [folded, relativePath] of seenFolded) {
      assert.ok(
        folded !== foldedRootFile && !folded.startsWith(`${foldedRootFile}/`),
        `${pluginDir}: ${relativePath} conflicts with the repository ${rootFile} added during packaging`,
      );
    }
    totalBytes += fs.statSync(path.join(root, rootFile)).size;
  }
  for (const reserved of RESERVED_CLIENT_FILES) {
    assert.ok(!seenFolded.has(reserved), `${pluginDir}: package contains client-reserved file ${reserved}`);
  }
  assert.ok(!seenFolded.has('cindy-signatures.json'), `${pluginDir}: source signatures become invalid when legal files are added during packaging`);
  const maxTotal = manifest.node ? MAX_SERVER_UNCOMPRESSED_BYTES : MAX_BASIC_UNCOMPRESSED_BYTES;
  assert.ok(totalBytes <= maxTotal, `${pluginDir}: uncompressed package exceeds ${maxTotal} bytes`);

  requireTrackedFile(files, pluginDir, 'ghost.json', MAX_MANIFEST_BYTES);
  const declaredFiles = [manifest.entry, manifest.panel?.html, manifest.settingsHtml, manifest.icon]
    .filter(Boolean);
  if (manifest.node) declaredFiles.push(manifest.node.entry, ...(manifest.node.entries ?? []));
  for (const relativePath of declaredFiles) {
    requireTrackedFile(files, pluginDir, relativePath, relativePath === manifest.icon ? MAX_ICON_BYTES : undefined);
  }
  if (manifest.icon) {
    assert.ok(fs.statSync(files.get(manifest.icon).absolutePath).size > 0, `${pluginDir}: icon is empty`);
  }

  assert.deepEqual(Object.keys(manifest.locales ?? {}).sort(), ['en', 'ja', 'ko', 'zh-CN'].sort(), `${pluginDir}: official plugins require four locales`);
  for (const [locale, relativePath] of Object.entries(manifest.locales ?? {})) {
    const localeFile = requireTrackedFile(files, pluginDir, relativePath, MAX_LOCALE_BYTES);
    validateLocaleResource(pluginDir, locale, readJson(localeFile, MAX_LOCALE_BYTES), manifest);
  }

  for (const item of manifest.skill?.items ?? []) {
    const skillFile = requireTrackedFile(files, pluginDir, `${item.dir}/SKILL.md`, MAX_SKILL_MD_BYTES);
    validateSkillFrontmatter(pluginDir, skillFile, item);
  }
  for (const item of manifest.manual?.items ?? []) {
    requireTrackedFile(files, pluginDir, `${item.dir}/MANUAL.md`, MAX_MANUAL_MD_BYTES);
    const prefix = `${item.dir}/`;
    const manualFiles = [...files.keys()].filter((name) => name.startsWith(prefix));
    assert.ok(manualFiles.length > 0, `${pluginDir}: manual directory is empty: ${item.dir}`);
    for (const relativePath of manualFiles) {
      assert.ok(relativePath.toLowerCase().endsWith('.md'), `${pluginDir}: manual directories may contain only Markdown: ${relativePath}`);
      const manualFile = requireTrackedFile(files, pluginDir, relativePath, MAX_MANUAL_MD_BYTES);
      const manualText = readUtf8(manualFile, MAX_MANUAL_MD_BYTES);
      assert.doesNotMatch(manualText, /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/, `${pluginDir}/${relativePath} contains forbidden control characters`);
    }
  }
}

function pluginRootsAt(revision) {
  return git(['ls-tree', '-r', '--name-only', revision])
    .split('\n')
    .filter((name) => name.endsWith('/ghost.json'))
    .map((name) => path.posix.dirname(name))
    .sort();
}

function stableSemver(version, pluginDir, field = 'ghost.json.version') {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  assert.ok(match, `${pluginDir}: ${field} must use major.minor.patch SemVer`);
  return match.slice(1).map(BigInt);
}

function assertManifestV3Floor(pluginDir, manifest) {
  const parts = stableSemver(manifest.minCindyVersion, pluginDir, 'minCindyVersion');
  assert.ok(
    parts[0] > 0n || parts[1] > 1n || (parts[1] === 1n && parts[2] >= 61n),
    `${pluginDir}: Manifest v3 minCindyVersion must be at least 0.1.61`,
  );
}

function assertChangedPluginUsesManifestV3(pluginDir, manifest) {
  assert.equal(manifest.schemaVersion, 3, `${pluginDir}: changed plugin packages must migrate to schemaVersion 3`);
  assert.equal(Object.hasOwn(manifest, 'slots'), false, `${pluginDir}: Manifest v3 must not contain slots`);
  assertManifestV3Floor(pluginDir, manifest);
}

function compareStableSemver(left, right, pluginDir) {
  const leftParts = stableSemver(left, pluginDir);
  const rightParts = stableSemver(right, pluginDir);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
}

function validateReleaseDiff() {
  const base = process.env.BASE_SHA;
  const head = process.env.HEAD_SHA;
  if (!base && !head) return;
  assert.match(base ?? '', /^[0-9a-f]{40}$/i, 'BASE_SHA must be a commit SHA');
  assert.match(head ?? '', /^[0-9a-f]{40}$/i, 'HEAD_SHA must be a commit SHA');
  const target = git(['rev-parse', 'HEAD']).trim();
  git(['merge-base', '--is-ancestor', head, target]);
  const baseRoots = pluginRootsAt(base);
  const targetRoots = new Set(pluginRootsAt(target));
  const baseRootSet = new Set(baseRoots);
  const sharedPackageChanged = git([
    'diff', '--name-only', '--no-renames', base, target, '--', ...ROOT_PACKAGE_FILES,
  ]).trim().length > 0;
  for (const pluginDir of baseRoots) {
    assert.ok(targetRoots.has(pluginDir), `${pluginDir}: deleting or renaming an official plugin requires an explicit Server migration`);
    const before = JSON.parse(git(['show', `${base}:${pluginDir}/ghost.json`]));
    const after = readJson(path.join(root, pluginDir, 'ghost.json'), MAX_MANIFEST_BYTES);
    assert.equal(after.id, before.id, `${pluginDir}: changing a published plugin id requires an explicit Server migration`);
    const changed = git(['diff', '--name-only', '--no-renames', base, target, '--', pluginDir]).trim();
    if (changed || sharedPackageChanged) {
      assert.ok(
        compareStableSemver(after.version, before.version, pluginDir) > 0,
        `${pluginDir}: packaged content changed, so ghost.json.version must be greater than ${before.version}`,
      );
      assertChangedPluginUsesManifestV3(pluginDir, after);
    }
  }
  for (const pluginDir of targetRoots) {
    if (baseRootSet.has(pluginDir)) continue;
    const manifest = readJson(path.join(root, pluginDir, 'ghost.json'), MAX_MANIFEST_BYTES);
    stableSemver(manifest.version, pluginDir);
    assertChangedPluginUsesManifestV3(pluginDir, manifest);
  }
}

test('the pinned Cindy manifest contract rejects client-incompatible shapes', () => {
  const legacy = {
    schemaVersion: 2,
    id: 'legacy-contract-fixture',
    name: 'Legacy contract fixture',
    version: '1.0.0',
    entry: 'main.js',
    slots: ['tool'],
    tools: [{ name: 'run', description: 'Run the fixture' }],
  };
  assert.equal(validateGhostManifest(legacy).ok, true, 'legacy fixture must be valid');
  assert.equal(validateGhostManifest({ ...legacy, kind: 'declaration' }).ok, false, 'legacy kind must be rejected');
  assert.equal(
    validateGhostManifest({ ...legacy, panel: { html: legacy.entry } }).ok,
    false,
    'panel declaration without the panel slot must be rejected',
  );
  const direct = {
    schemaVersion: 3,
    minCindyVersion: '0.1.61',
    id: 'direct-contract-fixture',
    name: 'Direct contract fixture',
    version: '1.0.0',
    entry: 'main.js',
    tools: [{ name: 'run', description: 'Run the fixture' }],
    notify: true,
    futureCapability: { mode: 'preserved' },
  };
  const directResult = validateGhostManifest(direct);
  assert.equal(directResult.ok, true, 'Manifest v3 direct declarations must be accepted');
  assert.equal(Object.hasOwn(directResult.manifest, 'slots'), false, 'Manifest v3 output must not contain slots');
  assert.deepEqual(directResult.manifest.futureCapability, { mode: 'preserved' }, 'unknown v3 fields must survive normalization');
  assert.equal(validateGhostManifest({ ...direct, slots: ['tool'] }).ok, false, 'Manifest v3 slots must be rejected');
  assert.equal(validateGhostManifest({ ...direct, notify: false }).ok, false, 'Manifest v3 boolean capabilities must be literal true');
});

test('all official plugins satisfy the repository publish contract', () => {
  assert.ok(pluginDirs.length > 0, 'no official plugins found');
  for (const pluginDir of pluginDirs) {
    assert.equal(pluginDir.includes('/'), false, `${pluginDir}: official plugin directories must be at repository root`);
  }
  const ids = new Map();
  const commands = new Map();
  for (const pluginDir of pluginDirs) {
    const raw = readJson(path.join(root, pluginDir, 'ghost.json'), MAX_MANIFEST_BYTES);
    const validated = validateOfficialManifest(pluginDir, raw);
    const manifest = {
      ...validated,
      ...(raw.setup !== undefined ? { setup: validateSetup(pluginDir, raw, validated) } : {}),
    };
    assert.equal(manifest.id, pluginDir, `${pluginDir}: directory name must equal ghost.json.id`);
    assert.equal(provisioning.ghosts?.[pluginDir] !== undefined, true, `${pluginDir}: missing provisioning.json entry`);
    assert.ok(!ids.has(manifest.id), `${pluginDir}: duplicate plugin id also used by ${ids.get(manifest.id)}`);
    ids.set(manifest.id, pluginDir);
    if (manifest.command) {
      const folded = manifest.command.toLowerCase();
      assert.ok(!commands.has(folded), `${pluginDir}: command /${manifest.command} conflicts with ${commands.get(folded)}`);
      commands.set(folded, pluginDir);
    }
    const usesOidcToken = (manifest.network?.secrets ?? []).some((secret) => secret.source === 'oidc-token');
    assert.equal(usesOidcToken, false, `${pluginDir}: public releases cannot declare oidc-token`);
    if ((manifest.skill?.items.length ?? 0) > 0) {
      assert.ok(PUBLIC_SKILL_EXEMPTIONS.has(manifest.id), `${pluginDir}: public Skill bundles are not accepted by Server`);
    }
    if (manifest.manual) {
      assert.ok(manifest.minCindyVersion, `${pluginDir}: Manual requires minCindyVersion`);
    }
    validatePluginSource(pluginDir, manifest);
  }
  assert.deepEqual(Object.keys(provisioning.ghosts ?? {}).sort(), pluginDirs, 'provisioning.json contains missing or stale plugin entries');
  validateReleaseDiff();
});
