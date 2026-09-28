// Generated from Cindy packages/plugin-protocol/src/manifest.ts (bundled with routineEvents.ts)
// source sha256: 20ab276de16e2a56a1722865275fbd3cadb60dacb0e7b2ccb6433513c6959f74
// Do not edit by hand. Licensed under Apache-2.0; see NOTICE.
// packages/plugin-protocol/src/routineEvents.ts
function parseGhostRoutineEvents(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const events = raw.events;
  if (!Array.isArray(events) || events.length < 1 || events.length > 32)
    return null;
  const output = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of events) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const { type, name, fields } = item;
    if (typeof type !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(type) || seen.has(type))
      return null;
    if (typeof name !== "string" || !name.trim() || name.length > 200)
      return null;
    if (!Array.isArray(fields) || fields.length > 32 || fields.some(
      (field) => typeof field !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(field)
    ))
      return null;
    if (new Set(fields).size !== fields.length) return null;
    output.push({ type, name, fields });
    seen.add(type);
  }
  return { events: output };
}

// packages/plugin-protocol/src/manifest.ts
var GHOST_MANIFEST_FILE = "ghost.json";
var CINDY_FILE_EXT = ".cindy";
var GHOST_MANIFEST_SCHEMA_VERSION = 3;
var GHOST_MANIFEST_SUMMARY_MAX_CHARS = 300;
var GHOST_LOCALES = ["zh-CN", "en", "ja", "ko"];
var GHOST_LOCALE_MAX_BYTES = 64 * 1024;
var GHOST_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
var WINDOWS_RESERVED_NAME_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
function isWindowsReservedName(name) {
  return WINDOWS_RESERVED_NAME_RE.test(name);
}
var LEGACY_GHOST_SLOTS = [
  "subscribe",
  "tool",
  "card",
  "panel",
  "main-view",
  "cindy",
  "agent",
  "node",
  "network",
  "notify",
  "badge",
  "confirm",
  "fs",
  "library",
  "session-context",
  "pick",
  "preview",
  "skill",
  "workspace",
  "ios-simulator"
];
var GHOST_SLOT_NAME_RE = /^[a-z][a-z0-9._:-]{0,127}$/;
var GHOST_LAUNCH_MODES = ["on-demand", "resident"];
var GHOST_PANEL_POSITIONS = ["left", "right", "tab"];
var GHOST_MAIN_VIEW_ICONS = [
  "puzzle",
  "globe",
  "code",
  "folder",
  "database",
  "chart-column",
  "image",
  "message-circle",
  "calendar-days"
];
var GHOST_NODE_PROTOCOLS = ["json-rpc-stdio", "mcp-stdio"];
var GHOST_NODE_LIFECYCLES = ["on-demand", "resident"];
var GHOST_NODE_MAX_SECRET_BINDINGS = 4;
var GHOST_NODE_MAX_SECRET_METHODS = 16;
var GHOST_NODE_MCP_RESERVED_METHODS = /* @__PURE__ */ new Set(["initialize", "notifications/initialized"]);
function isGhostNodeMcpReservedMethod(method) {
  return GHOST_NODE_MCP_RESERVED_METHODS.has(method);
}
var GHOST_NODE_MAX_EXTRA_ENTRIES = 4;
var GHOST_MODEL_IMAGE_ACTIONS = ["generate", "edit"];
var GHOST_MODEL_VIDEO_ACTIONS = ["generate", "edit"];
var GHOST_CINDY_MEDIA_ACTIONS = ["deposit"];
var GHOST_CINDY_TEXT_ACTIONS = ["oneshot"];
var GHOST_CINDY_EMBED_ACTIONS = ["text"];
var GHOST_CINDY_SEARCH_ACTIONS = ["web"];
var GHOST_SUBSCRIBE_TOPICS = ["turn", "session"];
var GHOST_SUBSCRIBE_HOOKS = ["will-user-message", "will-assistant-message"];
var GHOST_NETWORK_MAX_HOSTS = 8;
var GHOST_NETWORK_MAX_SECRETS = 4;
var GHOST_NETWORK_MAX_CONNECTION_DECLS = 2;
var GHOST_NETWORK_MAX_CONNECTIONS_PER_DECL = 8;
var GHOST_NETWORK_LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
function isValidGhostNetworkHostPattern(p) {
  if (typeof p !== "string" || p.length === 0 || p.length > 253) return false;
  const bare = p.startsWith("*.") ? p.slice(2) : p;
  const labels = bare.split(".");
  if (labels.length < 2) return false;
  if (labels.every((l) => /^\d+$/.test(l))) return false;
  return labels.every((l) => GHOST_NETWORK_LABEL_RE.test(l));
}
function ghostNetworkHostMatches(pattern, hostname) {
  if (pattern.startsWith("*."))
    return hostname.endsWith(pattern.slice(1)) && hostname.length > pattern.length - 1;
  return hostname === pattern;
}
var GHOST_SECRET_EXCHANGE_CONTENT_TYPES = [
  "application/json",
  "application/x-www-form-urlencoded"
];
var GHOST_SECRET_EXCHANGE_BODY_MAX_CHARS = 2048;
var GHOST_SECRET_EXCHANGE_TTL_DEFAULT_S = 3600;
var GHOST_SECRET_EXCHANGE_TTL_MIN_S = 60;
var GHOST_SECRET_EXCHANGE_TTL_MAX_S = 30 * 24 * 3600;
var GHOST_SECRET_EXCHANGE_TOKEN_PATH_RE = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;
var GHOST_OAUTH_IDENTITY_TEMPLATE_PLACEHOLDER_RE = /\{([^{}]*)\}/g;
var GHOST_OAUTH_IDENTITY_TEMPLATE_MAX_CHARS = 200;
var GHOST_OAUTH_SCOPES_MAX = 256;
var GHOST_OAUTH_CLIENT_ID_ALTERNATIVES_MAX = 8;
var GHOST_OAUTH_EXTRA_PARAMS_MAX = 8;
var GHOST_OAUTH_RESERVED_AUTHORIZE_PARAMS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "state",
  "scope",
  "code_challenge",
  "code_challenge_method"
];
var GHOST_OAUTH_TOKEN_BROKER_RE = /^[a-z][a-z0-9_-]{0,31}$/;
var GHOST_OAUTH_BOUNCE_PATH_RE = /^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;
var GHOST_SECRET_SOURCES = [
  "user",
  "login-email",
  "oauth",
  "login-feishu-token",
  "oidc-token",
  "gh-cli"
];
var GHOST_NETWORK_FORBIDDEN_INJECT_HEADERS = [
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "cookie",
  "origin",
  "referer",
  // content-type 由请求语义决定(上传通道的 multipart boundary 依赖它),
  // 不许被凭证注入声明占用——401 重换/跨域跳转的重注入会砸掉 boundary。
  "content-type"
];
var GHOST_PREVIEW_MAX_HOSTS = 4;
var GHOST_PREVIEW_LOOPBACK_HOSTS = /* @__PURE__ */ new Set([
  "localhost",
  "127.0.0.1",
  "[::1]"
]);
var GHOST_SKILL_MAX_ITEMS = 4;
var GHOST_SKILL_MD_MAX_BYTES = 64 * 1024;
var GHOST_SKILL_NAME_MAX_CHARS = 64;
var GHOST_SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
var GHOST_MANUAL_MAX_ITEMS = 8;
var GHOST_MANUAL_ENTRY_FILE = "MANUAL.md";
var GHOST_MANUAL_MD_MAX_BYTES = 64 * 1024;
var GHOST_MANUAL_DESCRIPTION_MAX_CHARS = GHOST_MANIFEST_SUMMARY_MAX_CHARS;
var GHOST_SETUP_MAX_GROUPS = 8;
var GHOST_SETUP_MAX_ITEMS_PER_GROUP = 8;
var GHOST_SETUP_KV_KEY_RE = /^[A-Za-z0-9_.-]{1,64}$/;
function ghostManifestUsesOidcToken(manifest) {
  return manifest.network?.secrets?.some((secret) => secret.source === "oidc-token") ?? false;
}
function isValidGhostId(id) {
  return typeof id === "string" && GHOST_ID_RE.test(id) && !isWindowsReservedName(id);
}
var GHOST_ICON_MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif"
};
function ghostIconMimeType(p) {
  const dot = p.lastIndexOf(".");
  if (dot < 0) return null;
  return GHOST_ICON_MIME_BY_EXT[p.slice(dot).toLowerCase()] ?? null;
}
var GHOST_PATH_SEGMENT_RE = /^[a-zA-Z0-9_][a-zA-Z0-9._-]{0,63}$/;
function isSafeGhostRelativePath(p) {
  if (typeof p !== "string" || p.length === 0 || p.length > 256) return false;
  if (p.includes("\\")) return false;
  const segments = p.split("/");
  return segments.every(
    (seg) => GHOST_PATH_SEGMENT_RE.test(seg) && seg !== "." && seg !== ".." && !isWindowsReservedName(seg)
  );
}
function compareNumericIdentifiers(left, right) {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
function parseCindyVersion(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
    value
  );
  if (!match) return null;
  const core = [match[1], match[2], match[3]];
  const prerelease = [];
  for (const part of match[4]?.split(".") ?? []) {
    const numeric = /^\d+$/.test(part);
    if (numeric && !/^(0|[1-9]\d*)$/.test(part)) return null;
    prerelease.push({ numeric, value: part });
  }
  return { core, prerelease };
}
function isValidCindyVersion(value) {
  return typeof value === "string" && value.length <= 32 && parseCindyVersion(value) !== null;
}
function isVersionlessCindyVersion(value) {
  return value === "0.0.0" || value.startsWith("0.0.0-");
}
function compareCindyVersions(leftValue, rightValue) {
  const left = parseCindyVersion(leftValue);
  const right = parseCindyVersion(rightValue);
  if (!left || !right) return null;
  for (let index = 0; index < 3; index += 1) {
    const coreComparison = compareNumericIdentifiers(left.core[index], right.core[index]);
    if (coreComparison !== 0) return coreComparison;
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0;
    return left.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === void 0 || rightPart === void 0) {
      return leftPart === void 0 ? -1 : 1;
    }
    if (leftPart.numeric !== rightPart.numeric) return leftPart.numeric ? -1 : 1;
    const partComparison = leftPart.numeric ? compareNumericIdentifiers(leftPart.value, rightPart.value) : leftPart.value === rightPart.value ? 0 : leftPart.value < rightPart.value ? -1 : 1;
    if (partComparison !== 0) return partComparison;
  }
  return 0;
}
function supportsCindyVersion(currentVersion, minCindyVersion) {
  if (minCindyVersion === void 0) return true;
  if (!isValidCindyVersion(currentVersion) || !isValidCindyVersion(minCindyVersion)) return false;
  if (isVersionlessCindyVersion(currentVersion)) return true;
  const comparison = compareCindyVersions(currentVersion, minCindyVersion);
  return comparison !== null && comparison >= 0;
}
function unknownDeclarationFields(raw, known) {
  return Object.fromEntries(Object.entries(raw).filter(([key]) => !known.includes(key)));
}
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
var GHOST_MANIFEST_RESERVED_RECORD_KEYS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
function isGhostManifestReservedRecordKey(value) {
  return GHOST_MANIFEST_RESERVED_RECORD_KEYS.has(value);
}
var GHOST_MANIFEST_KNOWN_TOP_LEVEL_FIELDS = /* @__PURE__ */ new Set([
  "routineEvents",
  "schemaVersion",
  "id",
  "name",
  "version",
  "minCindyVersion",
  "author",
  "locales",
  "description",
  "whenToUse",
  "icon",
  "kind",
  "entry",
  "launch",
  "agent",
  "node",
  "settingsHtml",
  "settingsHeight",
  "slots",
  "card",
  "tools",
  "cindy",
  "model",
  "subscribe",
  "network",
  "command",
  "keywords",
  "panel",
  "mainView",
  "preview",
  "skill",
  "manual",
  "setup",
  "notify",
  "badge",
  "confirm",
  "fs",
  "library",
  "sessionContext",
  "pick",
  "workspace",
  "iosSimulator"
]);
var V3_BOOLEAN_CAPABILITY_FIELDS = [
  "notify",
  "badge",
  "confirm",
  "fs",
  "library",
  "sessionContext",
  "pick",
  "workspace",
  "iosSimulator"
];
var V3_DECLARATION_TO_LEGACY_SLOT = [
  ["tools", "tool"],
  ["card", "card"],
  ["panel", "panel"],
  ["mainView", "main-view"],
  ["subscribe", "subscribe"],
  ["skill", "skill"],
  ["cindy", "cindy"],
  ["agent", "agent"],
  ["node", "node"],
  ["network", "network"],
  ["preview", "preview"]
];
var V3_BOOLEAN_TO_LEGACY_SLOT = {
  notify: "notify",
  badge: "badge",
  confirm: "confirm",
  fs: "fs",
  library: "library",
  sessionContext: "session-context",
  pick: "pick",
  workspace: "workspace",
  iosSimulator: "ios-simulator"
};
function prepareGhostManifestForValidation(value) {
  if (!isPlainObject(value)) return { ok: false, reason: "\u6E05\u5355\u4E0D\u662F\u5BF9\u8C61" };
  if (value.schemaVersion !== 2 && value.schemaVersion !== 3) {
    return {
      ok: false,
      reason: `schemaVersion \u5FC5\u987B\u662F 2 \u6216 3,\u5F97\u5230 ${JSON.stringify(value.schemaVersion)}(v1 \u58F0\u660E\u578B\u5DF2\u4E8E 2026-07-12 \u79FB\u9664)`
    };
  }
  if (value.schemaVersion === 2) {
    return {
      ok: true,
      prepared: {
        raw: Array.isArray(value.slots) ? { ...value, slots: dropEmptyLegacyCapabilitySlots(value, value.slots) } : value,
        schemaVersion: 2,
        v3BaseCard: false,
        v3BaseAgent: false,
        unknownV3Fields: {}
      }
    };
  }
  if (value.slots !== void 0) {
    return { ok: false, reason: "schemaVersion 3 \u4E0D\u518D\u652F\u6301 slots\uFF1B\u8BF7\u76F4\u63A5\u58F0\u660E\u5BF9\u5E94\u80FD\u529B\u5B57\u6BB5" };
  }
  if (value.minCindyVersion === void 0) {
    return { ok: false, reason: "schemaVersion 3 \u5FC5\u987B\u58F0\u660E minCindyVersion" };
  }
  for (const field of V3_BOOLEAN_CAPABILITY_FIELDS) {
    if (value[field] !== void 0 && value[field] !== true) {
      return { ok: false, reason: `${field} \u51FA\u73B0\u65F6\u5FC5\u987B\u662F true\uFF1B\u4E0D\u9700\u8981\u65F6\u8BF7\u7701\u7565` };
    }
  }
  const syntheticSlots = [];
  for (const [field, slot] of V3_DECLARATION_TO_LEGACY_SLOT) {
    if (value[field] !== void 0) syntheticSlots.push(slot);
  }
  for (const field of V3_BOOLEAN_CAPABILITY_FIELDS) {
    if (value[field] === true) syntheticSlots.push(V3_BOOLEAN_TO_LEGACY_SLOT[field]);
  }
  const v3BaseCard = isPlainObject(value.card) && Object.keys(value.card).length === 0;
  const v3BaseAgent = isPlainObject(value.agent) && Object.keys(value.agent).length === 0;
  return {
    ok: true,
    prepared: {
      raw: {
        ...value,
        slots: syntheticSlots,
        ...v3BaseCard ? { card: void 0 } : {},
        ...v3BaseAgent ? { agent: void 0 } : {}
      },
      schemaVersion: 3,
      v3BaseCard,
      v3BaseAgent,
      unknownV3Fields: Object.fromEntries(
        Object.entries(value).filter(
          ([key]) => key === "model" || !GHOST_MANIFEST_KNOWN_TOP_LEVEL_FIELDS.has(key)
        )
      )
    }
  };
}
function dropEmptyLegacyCapabilitySlots(value, slots) {
  return slots.filter((slot) => {
    const normalized = slot === "model" ? "cindy" : slot;
    if (normalized === "tool") return value.tools !== void 0;
    if (normalized === "panel") return value.panel !== void 0;
    if (normalized === "cindy") return value.cindy !== void 0 || value.model !== void 0;
    if (normalized === "subscribe") return value.subscribe !== void 0;
    if (normalized === "node") return value.node !== void 0;
    if (normalized === "network") return value.network !== void 0;
    if (normalized === "preview") return value.preview !== void 0;
    if (normalized === "skill") return value.skill !== void 0;
    return true;
  });
}
function validateGhostManifest(value) {
  const preparation = prepareGhostManifestForValidation(value);
  if (!preparation.ok) return preparation;
  const prepared = preparation.prepared;
  const raw = prepared.raw;
  if (!isValidGhostId(raw.id)) {
    return {
      ok: false,
      reason: "id \u5FC5\u987B\u662F 1\u201332 \u4F4D\u5C0F\u5199\u5B57\u6BCD/\u6570\u5B57/\u8FDE\u5B57\u7B26(\u4E0D\u80FD\u4EE5\u8FDE\u5B57\u7B26\u5F00\u5934\u6216\u4F7F\u7528 Windows \u8BBE\u5907\u4FDD\u7559\u540D)"
    };
  }
  if (typeof raw.name !== "string" || raw.name.trim().length === 0 || raw.name.length > 64) {
    return { ok: false, reason: "name \u5FC5\u987B\u662F 1\u201364 \u5B57\u7B26\u7684\u975E\u7A7A\u5B57\u7B26\u4E32" };
  }
  if (typeof raw.version !== "string" || raw.version.trim().length === 0 || raw.version.length > 32) {
    return { ok: false, reason: "version \u5FC5\u987B\u662F 1\u201332 \u5B57\u7B26\u7684\u975E\u7A7A\u5B57\u7B26\u4E32" };
  }
  if (raw.minCindyVersion !== void 0 && (typeof raw.minCindyVersion !== "string" || !isValidCindyVersion(raw.minCindyVersion))) {
    return { ok: false, reason: "minCindyVersion \u5FC5\u987B\u662F\u5408\u6CD5\u7684 SemVer \u5B57\u7B26\u4E32" };
  }
  if (raw.kind !== void 0 && raw.kind !== "chip") {
    return {
      ok: false,
      reason: `kind \u5FC5\u987B\u662F "chip" \u6216\u7701\u7565(\u7F3A\u7701\u5373 chip),\u5F97\u5230 ${JSON.stringify(raw.kind)}(\u610F\u8BC6\u53EA\u6709\u82AF\u7247\u4E00\u79CD\u5F62\u6001,declaration \u5DF2\u79FB\u9664)`
    };
  }
  if (raw.author !== void 0 && (typeof raw.author !== "string" || raw.author.trim().length === 0 || raw.author.length > 64)) {
    return { ok: false, reason: "author \u5FC5\u987B\u662F 1\u201364 \u5B57\u7B26\u7684\u975E\u7A7A\u5B57\u7B26\u4E32" };
  }
  const declaredFilePathFolds = [
    GHOST_MANIFEST_FILE,
    raw.entry,
    raw.icon,
    raw.settingsHtml,
    isPlainObject(raw.panel) ? raw.panel.html : void 0,
    isPlainObject(raw.mainView) ? raw.mainView.html : void 0,
    isPlainObject(raw.node) ? raw.node.entry : void 0,
    ...isPlainObject(raw.node) && Array.isArray(raw.node.entries) ? raw.node.entries : []
  ].filter((value2) => typeof value2 === "string").map((value2) => value2.toLowerCase());
  const isSameOrDescendant = (path, ancestor) => path === ancestor || path.startsWith(`${ancestor}/`);
  const pathsConflict = (left, right) => isSameOrDescendant(left, right) || isSameOrDescendant(right, left);
  let locales;
  if (raw.locales !== void 0) {
    if (!isPlainObject(raw.locales)) {
      return {
        ok: false,
        reason: "locales \u5FC5\u987B\u662F\u8BED\u8A00\u5230 locale JSON \u8DEF\u5F84\u7684\u5BF9\u8C61"
      };
    }
    const unknownLocale = Object.keys(raw.locales).find(
      (locale) => !GHOST_LOCALES.includes(locale)
    );
    if (unknownLocale) {
      return {
        ok: false,
        reason: `locales \u542B\u5BBF\u4E3B\u4E0D\u652F\u6301\u7684\u8BED\u8A00 ${JSON.stringify(unknownLocale)}(\u53EF\u7528:${GHOST_LOCALES.join(" / ")})`
      };
    }
    if (raw.locales.en === void 0) {
      return {
        ok: false,
        reason: "locales \u5FC5\u987B\u63D0\u4F9B en\uFF0C\u4F5C\u4E3A\u6240\u6709\u4E0D\u652F\u6301\u8BED\u8A00\u7684\u56FA\u5B9A\u56DE\u9000"
      };
    }
    const normalized = {};
    const seenPaths = [];
    const skillDirFolds = (isPlainObject(raw.skill) && Array.isArray(raw.skill.items) ? raw.skill.items : []).map((item) => isPlainObject(item) ? item.dir : void 0).filter((value2) => typeof value2 === "string").map((value2) => value2.toLowerCase());
    const manualDirFolds = (isPlainObject(raw.manual) && Array.isArray(raw.manual.items) ? raw.manual.items : []).map((item) => isPlainObject(item) ? item.dir : void 0).filter((value2) => typeof value2 === "string").map((value2) => value2.toLowerCase());
    for (const locale of GHOST_LOCALES) {
      const localePath = raw.locales[locale];
      if (localePath === void 0) continue;
      if (typeof localePath !== "string" || !isSafeGhostRelativePath(localePath) || !localePath.toLowerCase().endsWith(".json")) {
        return {
          ok: false,
          reason: `locales.${locale} \u5FC5\u987B\u662F\u5B89\u88C5\u76EE\u5F55\u5185\u4EE5 .json \u7ED3\u5C3E\u7684\u5B89\u5168\u76F8\u5BF9\u8DEF\u5F84`
        };
      }
      const normalizedLocalePath = localePath.toLowerCase();
      const conflictsWithFile = declaredFilePathFolds.some(
        (path) => pathsConflict(path, normalizedLocalePath)
      );
      const conflictsWithSkillDir = skillDirFolds.some(
        (dir) => isSameOrDescendant(dir, normalizedLocalePath)
      );
      const conflictsWithManualDir = manualDirFolds.some(
        (dir) => pathsConflict(dir, normalizedLocalePath)
      );
      if (conflictsWithFile || conflictsWithSkillDir || conflictsWithManualDir) {
        return {
          ok: false,
          reason: `locales.${locale} \u8DEF\u5F84 ${JSON.stringify(localePath)} \u4E0E\u63D2\u4EF6\u5176\u4ED6\u58F0\u660E\u6587\u4EF6\u5927\u5C0F\u5199\u6298\u53E0\u540E\u51B2\u7A81`
        };
      }
      if (seenPaths.includes(normalizedLocalePath)) {
        return {
          ok: false,
          reason: `locales \u542B\u91CD\u590D\u8DEF\u5F84 ${JSON.stringify(localePath)}`
        };
      }
      if (seenPaths.some(
        (path) => isSameOrDescendant(path, normalizedLocalePath) || isSameOrDescendant(normalizedLocalePath, path)
      )) {
        return {
          ok: false,
          reason: `locales.${locale} \u8DEF\u5F84 ${JSON.stringify(localePath)} \u4E0E\u5176\u4ED6 locale \u6587\u4EF6\u5B58\u5728\u7956\u5148\u8DEF\u5F84\u51B2\u7A81`
        };
      }
      seenPaths.push(normalizedLocalePath);
      normalized[locale] = localePath;
    }
    locales = {
      ...normalized,
      en: normalized.en
    };
  }
  if (raw.description !== void 0 && (typeof raw.description !== "string" || raw.description.trim().length === 0 || raw.description.length > GHOST_MANIFEST_SUMMARY_MAX_CHARS)) {
    return {
      ok: false,
      reason: `description \u5FC5\u987B\u662F 1\u2013${GHOST_MANIFEST_SUMMARY_MAX_CHARS} \u5B57\u7B26\u7684\u975E\u7A7A\u5B57\u7B26\u4E32`
    };
  }
  if (raw.whenToUse !== void 0 && (typeof raw.whenToUse !== "string" || raw.whenToUse.trim().length === 0 || raw.whenToUse.length > GHOST_MANIFEST_SUMMARY_MAX_CHARS)) {
    return {
      ok: false,
      reason: `whenToUse \u5FC5\u987B\u662F 1\u2013${GHOST_MANIFEST_SUMMARY_MAX_CHARS} \u5B57\u7B26\u7684\u975E\u7A7A\u5B57\u7B26\u4E32`
    };
  }
  if (raw.icon !== void 0) {
    if (!isSafeGhostRelativePath(raw.icon)) {
      return { ok: false, reason: "icon \u5FC5\u987B\u662F\u5B89\u88C5\u76EE\u5F55\u5185\u7684\u5B89\u5168\u76F8\u5BF9\u8DEF\u5F84" };
    }
    if (ghostIconMimeType(raw.icon) === null) {
      return {
        ok: false,
        reason: `icon \u6269\u5C55\u540D\u4E0D\u53D7\u652F\u6301(\u53EF\u7528:${Object.keys(GHOST_ICON_MIME_BY_EXT).join(" / ")})`
      };
    }
  }
  let panel;
  if (raw.panel !== void 0) {
    const p = raw.panel;
    if (!isPlainObject(p)) return { ok: false, reason: "panel \u5FC5\u987B\u662F\u5BF9\u8C61" };
    if (p.title !== void 0 && (typeof p.title !== "string" || p.title.length === 0 || p.title.length > 64)) {
      return { ok: false, reason: "panel.title \u5FC5\u987B\u662F 1\u201364 \u5B57\u7B26\u7684\u5B57\u7B26\u4E32" };
    }
    if (!isSafeGhostRelativePath(p.html)) {
      return {
        ok: false,
        reason: "panel.html \u5FC5\u586B,\u4E14\u5FC5\u987B\u662F\u5B89\u88C5\u76EE\u5F55\u5185\u7684\u5B89\u5168\u76F8\u5BF9\u8DEF\u5F84"
      };
    }
    if (p.minWidth !== void 0 && (typeof p.minWidth !== "number" || !Number.isFinite(p.minWidth) || p.minWidth < 120 || p.minWidth > 1200)) {
      return { ok: false, reason: "panel.minWidth \u5FC5\u987B\u662F 120\u20131200 \u4E4B\u95F4\u7684\u6570\u5B57" };
    }
    if (p.defaultFraction !== void 0 && (typeof p.defaultFraction !== "number" || !Number.isFinite(p.defaultFraction) || p.defaultFraction < 0.05 || p.defaultFraction > 0.8)) {
      return {
        ok: false,
        reason: "panel.defaultFraction \u5FC5\u987B\u662F 0.05\u20130.8 \u4E4B\u95F4\u7684\u6570\u5B57"
      };
    }
    if (p.position !== void 0) {
      if (p.position === "top" || p.position === "bottom") {
        return {
          ok: false,
          reason: "panel.position \u7684 top / bottom \u6682\u672A\u652F\u6301(\u6392\u671F\u4E2D),\u5F53\u524D\u53EF\u7528:left / right / tab"
        };
      }
      if (!GHOST_PANEL_POSITIONS.includes(p.position)) {
        return {
          ok: false,
          reason: `panel.position \u5FC5\u987B\u662F ${GHOST_PANEL_POSITIONS.join(" / ")}`
        };
      }
      if (p.position === "tab" && (p.minWidth !== void 0 || p.defaultFraction !== void 0)) {
        return {
          ok: false,
          reason: "panel.minWidth / panel.defaultFraction \u4EC5\u505C\u9760\u5F62\u6001(left / right)\u6709\u6548,position:'tab' \u65F6\u8BF7\u79FB\u9664"
        };
      }
    }
    panel = {
      ...unknownDeclarationFields(p, ["title", "position", "html", "minWidth", "defaultFraction"]),
      ...p.title !== void 0 ? { title: p.title } : {},
      ...p.position !== void 0 ? { position: p.position } : {},
      html: p.html,
      ...p.minWidth !== void 0 ? { minWidth: p.minWidth } : {},
      ...p.defaultFraction !== void 0 ? { defaultFraction: p.defaultFraction } : {}
    };
  }
  let mainView;
  if (raw.mainView !== void 0) {
    if (!isPlainObject(raw.mainView)) {
      return { ok: false, reason: "mainView \u5FC5\u987B\u662F\u5BF9\u8C61" };
    }
    if (raw.mainView.title !== void 0 && (typeof raw.mainView.title !== "string" || raw.mainView.title.trim().length === 0 || raw.mainView.title.length > 64)) {
      return {
        ok: false,
        reason: "mainView.title \u5FC5\u987B\u662F 1\u201364 \u5B57\u7B26\u7684\u975E\u7A7A\u5B57\u7B26\u4E32"
      };
    }
    if (raw.mainView.icon !== void 0 && !GHOST_MAIN_VIEW_ICONS.includes(raw.mainView.icon)) {
      return {
        ok: false,
        reason: `mainView.icon \u5FC5\u987B\u662F\u4EE5\u4E0B\u7CFB\u7EDF\u56FE\u6807\u4E4B\u4E00:${GHOST_MAIN_VIEW_ICONS.join(" / ")}`
      };
    }
    if (!isSafeGhostRelativePath(raw.mainView.html)) {
      return {
        ok: false,
        reason: "mainView.html \u5FC5\u586B\uFF0C\u4E14\u5FC5\u987B\u662F\u5B89\u88C5\u76EE\u5F55\u5185\u7684\u5B89\u5168\u76F8\u5BF9\u8DEF\u5F84"
      };
    }
    mainView = {
      ...unknownDeclarationFields(raw.mainView, ["html", "title", "icon"]),
      ...raw.mainView.title !== void 0 ? { title: raw.mainView.title } : {},
      ...raw.mainView.icon !== void 0 ? { icon: raw.mainView.icon } : {},
      html: raw.mainView.html
    };
  }
  if (!isSafeGhostRelativePath(raw.entry)) {
    return {
      ok: false,
      reason: "\u5FC5\u987B\u63D0\u4F9B entry(\u5B89\u88C5\u76EE\u5F55\u5185\u7684\u5B89\u5168\u76F8\u5BF9\u8DEF\u5F84,\u7535\u5B50\u8111\u903B\u8F91\u5165\u53E3)"
    };
  }
  if (raw.launch !== void 0 && !GHOST_LAUNCH_MODES.includes(raw.launch)) {
    return {
      ok: false,
      reason: `launch \u5FC5\u987B\u662F ${GHOST_LAUNCH_MODES.join(" / ")}`
    };
  }
  if (raw.settingsHtml !== void 0 && !isSafeGhostRelativePath(raw.settingsHtml)) {
    return { ok: false, reason: "settingsHtml \u5FC5\u987B\u662F\u5B89\u88C5\u76EE\u5F55\u5185\u7684\u5B89\u5168\u76F8\u5BF9\u8DEF\u5F84" };
  }
  if (raw.settingsHeight !== void 0) {
    if (raw.settingsHtml === void 0) {
      return {
        ok: false,
        reason: "\u58F0\u660E\u4E86 settingsHeight \u4F46\u6CA1\u6709 settingsHtml\u2014\u2014\u6CA1\u6709\u754C\u9762\u5C31\u6CA1\u6709\u9AD8\u5EA6\u53EF\u8A00"
      };
    }
    if (typeof raw.settingsHeight !== "number" || !Number.isFinite(raw.settingsHeight) || raw.settingsHeight < 160 || raw.settingsHeight > 800) {
      return { ok: false, reason: "settingsHeight \u5FC5\u987B\u662F 160\u2013800 \u4E4B\u95F4\u7684\u6570\u5B57" };
    }
  }
  if (!Array.isArray(raw.slots)) {
    return { ok: false, reason: "schemaVersion 2 \u7684 slots \u5FC5\u987B\u662F\u6570\u7EC4" };
  }
  const slots = [];
  for (const s of raw.slots) {
    const name = s === "model" ? "cindy" : s;
    if (typeof name !== "string" || !GHOST_SLOT_NAME_RE.test(name)) {
      return {
        ok: false,
        reason: `slots \u542B\u683C\u5F0F\u975E\u6CD5\u7684\u5361\u69FD\u540D\u79F0 ${JSON.stringify(s)}`
      };
    }
    if (slots.includes(name)) {
      return { ok: false, reason: `slots \u542B\u91CD\u590D\u5361\u69FD ${JSON.stringify(s)}` };
    }
    slots.push(name);
  }
  if (panel !== void 0 && !slots.includes("panel")) {
    return { ok: false, reason: '\u58F0\u660E\u4E86 panel \u4F46 slots \u672A\u5305\u542B "panel"' };
  }
  if (slots.includes("panel") && panel === void 0) {
    return {
      ok: false,
      reason: 'slots \u58F0\u660E\u4E86 "panel" \u4F46\u7F3A\u5C11 panel(\u9762\u677F\u7531\u610F\u8BC6\u81EA\u7ED8,html \u5FC5\u586B)'
    };
  }
  if (mainView !== void 0 && !slots.includes("main-view")) {
    return { ok: false, reason: '\u58F0\u660E\u4E86 mainView \u4F46 slots \u672A\u5305\u542B "main-view"' };
  }
  if (slots.includes("main-view") && mainView === void 0) {
    return {
      ok: false,
      reason: 'slots \u58F0\u660E\u4E86 "main-view" \u4F46\u7F3A\u5C11 mainView(html \u5FC5\u586B)'
    };
  }
  if (slots.includes("badge") && panel === void 0) {
    return {
      ok: false,
      reason: 'slots \u58F0\u660E\u4E86 "badge" \u4F46\u7F3A\u5C11 panel\u2014\u2014\u672A\u8BFB\u70B9\u5FC5\u987B\u6709\u53EF\u6253\u5F00\u7684\u9762\u677F\u5185\u5BB9'
    };
  }
  let card;
  if (raw.card !== void 0) {
    if (!isPlainObject(raw.card)) {
      return {
        ok: false,
        reason: 'card \u80FD\u529B\u8BE6\u5355\u5FC5\u987B\u662F\u5BF9\u8C61(\u5982 { "externalLinks": true })'
      };
    }
    if (!slots.includes("card")) {
      return {
        ok: false,
        reason: '\u58F0\u660E\u4E86 card \u80FD\u529B\u8BE6\u5355\u4F46 slots \u672A\u5305\u542B "card"'
      };
    }
    const cardRaw = raw.card;
    if (cardRaw.externalLinks !== void 0 && typeof cardRaw.externalLinks !== "boolean") {
      return { ok: false, reason: "card.externalLinks \u5FC5\u987B\u662F\u5E03\u5C14\u503C" };
    }
    const cardExtensions = unknownDeclarationFields(cardRaw, ["externalLinks"]);
    if (cardRaw.externalLinks === true || Object.keys(cardExtensions).length > 0) {
      card = { ...cardExtensions, ...cardRaw.externalLinks === true ? { externalLinks: true } : {} };
    }
  }
  let tools;
  if (raw.tools !== void 0) {
    if (!Array.isArray(raw.tools) || raw.tools.length === 0 || raw.tools.length > 16) {
      return { ok: false, reason: "tools \u5FC5\u987B\u662F 1\u201316 \u9879\u7684\u6570\u7EC4" };
    }
    tools = [];
    const seenNames = /* @__PURE__ */ new Set();
    for (const t of raw.tools) {
      if (!isPlainObject(t)) return { ok: false, reason: "tools \u6BCF\u9879\u5FC5\u987B\u662F\u5BF9\u8C61" };
      if (typeof t.name !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(t.name)) {
        return {
          ok: false,
          reason: "tools[].name \u5FC5\u987B\u662F\u5C0F\u5199\u5B57\u6BCD\u5F00\u5934\u7684 1\u201364 \u4F4D\u5C0F\u5199/\u6570\u5B57/\u4E0B\u5212\u7EBF/\u8FDE\u5B57\u7B26"
        };
      }
      if (seenNames.has(t.name))
        return {
          ok: false,
          reason: `tools \u542B\u91CD\u540D\u5DE5\u5177 ${JSON.stringify(t.name)}`
        };
      seenNames.add(t.name);
      if (typeof t.description !== "string" || t.description.trim().length === 0 || t.description.length > 1024) {
        return {
          ok: false,
          reason: "tools[].description \u5FC5\u987B\u662F 1\u20131024 \u5B57\u7B26\u7684\u975E\u7A7A\u5B57\u7B26\u4E32"
        };
      }
      if (t.parameters !== void 0) {
        if (!isPlainObject(t.parameters))
          return {
            ok: false,
            reason: "tools[].parameters \u5FC5\u987B\u662F\u5BF9\u8C61(JSON Schema)"
          };
        try {
          if (JSON.stringify(t.parameters).length > 16384) {
            return { ok: false, reason: "tools[].parameters \u8FC7\u5927(\u4E0A\u9650 16KB)" };
          }
        } catch {
          return { ok: false, reason: "tools[].parameters \u5FC5\u987B\u53EF\u5E8F\u5217\u5316" };
        }
      }
      tools.push({
        name: t.name,
        description: t.description,
        ...t.parameters !== void 0 ? { parameters: t.parameters } : {}
      });
    }
  }
  if (tools !== void 0 && !slots.includes("tool")) {
    return { ok: false, reason: '\u58F0\u660E\u4E86 tools \u4F46 slots \u672A\u5305\u542B "tool"' };
  }
  if (slots.includes("tool") && tools === void 0) {
    return {
      ok: false,
      reason: 'slots \u58F0\u660E\u4E86 "tool" \u4F46\u7F3A\u5C11 tools(\u6CE8\u518C\u4EC0\u4E48\u5DE5\u5177\u8981\u5199\u6E05\u695A)'
    };
  }
  const cindyRaw = raw.cindy !== void 0 ? raw.cindy : prepared.schemaVersion === 2 ? raw.model : void 0;
  let cindy;
  if (cindyRaw !== void 0) {
    if (!isPlainObject(cindyRaw)) {
      return {
        ok: false,
        reason: 'cindy \u80FD\u529B\u8BE6\u5355\u5FC5\u987B\u662F\u5BF9\u8C61(\u5982 { "image": ["generate"] })'
      };
    }
    if (!slots.includes("cindy")) {
      return {
        ok: false,
        reason: '\u58F0\u660E\u4E86 cindy \u80FD\u529B\u8BE6\u5355\u4F46 slots \u672A\u5305\u542B "cindy"'
      };
    }
    cindy = unknownDeclarationFields(cindyRaw, ["image", "video", "media", "text", "embed", "search", "oneshotModel"]);
    const actionTable = {
      image: GHOST_MODEL_IMAGE_ACTIONS,
      video: GHOST_MODEL_VIDEO_ACTIONS,
      media: GHOST_CINDY_MEDIA_ACTIONS,
      text: GHOST_CINDY_TEXT_ACTIONS,
      embed: GHOST_CINDY_EMBED_ACTIONS,
      search: GHOST_CINDY_SEARCH_ACTIONS
    };
    for (const [category, actionsRaw] of Object.entries(cindyRaw)) {
      if (category === "oneshotModel") continue;
      if (!Object.hasOwn(actionTable, category)) continue;
      if (!Array.isArray(actionsRaw) || actionsRaw.length === 0) {
        return { ok: false, reason: `cindy.${category} \u5FC5\u987B\u662F\u975E\u7A7A\u6570\u7EC4` };
      }
      const actions = [];
      for (const a of actionsRaw) {
        if (typeof a !== "string" || !GHOST_SLOT_NAME_RE.test(a)) {
          return {
            ok: false,
            reason: `cindy.${category} \u52A8\u4F5C\u5FC5\u987B\u662F\u5408\u6CD5\u7684\u80FD\u529B\u6807\u8BC6: ${JSON.stringify(a)}`
          };
        }
        if (actions.includes(a)) {
          return {
            ok: false,
            reason: `cindy.${category} \u542B\u91CD\u590D\u52A8\u4F5C ${JSON.stringify(a)}`
          };
        }
        actions.push(a);
      }
      if (category === "image") cindy.image = actions;
      else if (category === "video") cindy.video = actions;
      else if (category === "media") cindy.media = actions;
      else if (category === "text") cindy.text = actions;
      else if (category === "embed") cindy.embed = actions;
      else if (category === "search") cindy.search = actions;
      else
        return {
          ok: false,
          reason: `cindy \u80FD\u529B\u7C7B\u76EE ${JSON.stringify(category)} \u5C1A\u672A\u63A5\u7EBF(\u534F\u8BAE\u7F3A\u9677)`
        };
    }
    if (Object.keys(cindy).filter((key) => key !== "oneshotModel").length === 0) {
      return { ok: false, reason: "cindy \u80FD\u529B\u8BE6\u5355\u4E0D\u80FD\u662F\u7A7A\u5BF9\u8C61" };
    }
    const oneshotModelRaw = cindyRaw.oneshotModel;
    if (oneshotModelRaw !== void 0) {
      if (typeof oneshotModelRaw !== "string" || oneshotModelRaw.trim().length === 0 || oneshotModelRaw.length > 128) {
        return {
          ok: false,
          reason: 'cindy.oneshotModel \u5FC5\u987B\u662F 1\u2013128 \u5B57\u7B26\u7684\u76EE\u5F55\u6A21\u578B id(\u5982 "codex/gpt-5.5")'
        };
      }
      if (!cindy.text?.includes("oneshot")) {
        return {
          ok: false,
          reason: 'cindy.oneshotModel \u5FC5\u987B\u4E0E text \u542B "oneshot" \u6210\u5BF9\u58F0\u660E(\u5B83\u662F\u5FEB\u95EE\u5FEB\u7B54\u7684\u504F\u597D\u6A21\u578B)'
        };
      }
      cindy.oneshotModel = oneshotModelRaw.trim();
    }
    if (cindy.search?.includes("web") && (!slots.includes("tool") || tools === void 0)) {
      return {
        ok: false,
        reason: 'cindy.search.web \u53EA\u5141\u8BB8\u7531\u771F\u5B9E tool-call \u89E6\u53D1\uFF0C\u5FC5\u987B\u540C\u65F6\u58F0\u660E "tool" \u69FD\u548C tools'
      };
    }
  }
  if (raw.routineEvents !== void 0 && prepared.schemaVersion !== 3) {
    return { ok: false, reason: "routineEvents requires schemaVersion 3" };
  }
  const routineEvents = raw.routineEvents === void 0 ? void 0 : parseGhostRoutineEvents(raw.routineEvents);
  if (routineEvents === null) return { ok: false, reason: "Invalid routineEvents declaration" };
  let subscribe;
  if (raw.subscribe !== void 0) {
    if (!isPlainObject(raw.subscribe)) {
      return {
        ok: false,
        reason: 'subscribe \u8BA2\u9605\u8BE6\u5355\u5FC5\u987B\u662F\u5BF9\u8C61(\u5982 { "topics": ["turn"] })'
      };
    }
    if (!slots.includes("subscribe")) {
      return {
        ok: false,
        reason: '\u58F0\u660E\u4E86 subscribe \u8BA2\u9605\u8BE6\u5355\u4F46 slots \u672A\u5305\u542B "subscribe"'
      };
    }
    const subRaw = raw.subscribe;
    subscribe = unknownDeclarationFields(subRaw, ["topics", "hooks"]);
    for (const field of ["topics", "hooks"]) {
      const listRaw = subRaw[field];
      if (listRaw === void 0) continue;
      if (!Array.isArray(listRaw) || listRaw.length === 0) {
        return { ok: false, reason: `subscribe.${field} \u5FC5\u987B\u662F\u975E\u7A7A\u6570\u7EC4` };
      }
      const list = [];
      for (const item of listRaw) {
        if (typeof item !== "string" || !GHOST_SLOT_NAME_RE.test(item)) {
          return {
            ok: false,
            reason: `subscribe.${field} \u5FC5\u987B\u5305\u542B\u5408\u6CD5\u7684\u4E8B\u4EF6\u6807\u8BC6: ${JSON.stringify(item)}`
          };
        }
        if (list.includes(item)) {
          return {
            ok: false,
            reason: `subscribe.${field} \u542B\u91CD\u590D\u9879 ${JSON.stringify(item)}`
          };
        }
        list.push(item);
      }
      if (field === "topics") subscribe.topics = list;
      else subscribe.hooks = list;
    }
    if (Object.keys(subscribe).length === 0) {
      return { ok: false, reason: "subscribe \u8BA2\u9605\u8BE6\u5355\u4E0D\u80FD\u662F\u7A7A\u5BF9\u8C61" };
    }
    if (subscribe.hooks?.some((hook) => GHOST_SUBSCRIBE_HOOKS.includes(hook)) && raw.launch !== "resident") {
      return {
        ok: false,
        reason: '\u58F0\u660E\u4E86 subscribe.hooks(\u62E6\u622A\u94A9\u5B50)\u5FC5\u987B\u540C\u65F6\u58F0\u660E launch: "resident"\u2014\u2014\u62E6\u622A\u8981\u6C42\u5E38\u9A7B\u5728\u573A,\u5426\u5219\u6BCF\u6761\u6D88\u606F\u90FD\u8981\u7B49\u51B7\u542F\u52A8'
      };
    }
  }
  let network;
  if (raw.network !== void 0) {
    if (!isPlainObject(raw.network)) {
      return {
        ok: false,
        reason: 'network \u8BE6\u5355\u5FC5\u987B\u662F\u5BF9\u8C61(\u5982 { "hosts": ["api.example.com"] })'
      };
    }
    if (!slots.includes("network")) {
      return {
        ok: false,
        reason: '\u58F0\u660E\u4E86 network \u8BE6\u5355\u4F46 slots \u672A\u5305\u542B "network"'
      };
    }
    const n = raw.network;
    const hasConnectionDecls = Array.isArray(n.connections) && n.connections.length > 0;
    if (n.hosts === void 0 && !hasConnectionDecls) {
      return {
        ok: false,
        reason: `network.hosts \u5FC5\u987B\u662F 1\u2013${GHOST_NETWORK_MAX_HOSTS} \u6761\u7684\u6570\u7EC4(\u4EC5\u58F0\u660E\u4E86 network.connections \u65F6\u624D\u53EF\u7F3A\u7701)`
      };
    }
    if (n.hosts !== void 0 && (!Array.isArray(n.hosts) || n.hosts.length > GHOST_NETWORK_MAX_HOSTS)) {
      return {
        ok: false,
        reason: `network.hosts \u5FC5\u987B\u662F 1\u2013${GHOST_NETWORK_MAX_HOSTS} \u6761\u7684\u6570\u7EC4`
      };
    }
    if (Array.isArray(n.hosts) && n.hosts.length === 0 && !hasConnectionDecls) {
      return {
        ok: false,
        reason: `network.hosts \u5FC5\u987B\u662F 1\u2013${GHOST_NETWORK_MAX_HOSTS} \u6761\u7684\u6570\u7EC4(\u4EC5\u58F0\u660E\u4E86 network.connections \u65F6\u624D\u5141\u8BB8\u4E3A\u7A7A)`
      };
    }
    const hosts = [];
    for (const h of Array.isArray(n.hosts) ? n.hosts : []) {
      if (typeof h !== "string" || !isValidGhostNetworkHostPattern(h.trim().toLowerCase())) {
        return {
          ok: false,
          reason: `network.hosts \u542B\u975E\u6CD5\u6761\u76EE ${JSON.stringify(h)}(\u5C0F\u5199\u57DF\u540D\u3001\u81F3\u5C11\u4E24\u6BB5\u3001\u901A\u914D\u53EA\u5141\u8BB8\u6700\u5DE6 "*.";\u4E0D\u6536 IP / \u7AEF\u53E3 / \u8DEF\u5F84 / \u534F\u8BAE)`
        };
      }
      const host = h.trim().toLowerCase();
      if (hosts.includes(host)) {
        return {
          ok: false,
          reason: `network.hosts \u542B\u91CD\u590D\u6761\u76EE ${JSON.stringify(h)}`
        };
      }
      hosts.push(host);
    }
    let secrets;
    if (n.secrets !== void 0) {
      if (!Array.isArray(n.secrets) || n.secrets.length === 0 || n.secrets.length > GHOST_NETWORK_MAX_SECRETS) {
        return {
          ok: false,
          reason: `network.secrets \u5FC5\u987B\u662F 1\u2013${GHOST_NETWORK_MAX_SECRETS} \u6761\u7684\u6570\u7EC4`
        };
      }
      secrets = [];
      const seenKeys = /* @__PURE__ */ new Set();
      for (const s of n.secrets) {
        if (!isPlainObject(s)) return { ok: false, reason: "network.secrets \u6BCF\u9879\u5FC5\u987B\u662F\u5BF9\u8C61" };
        if (typeof s.key !== "string" || !/^[a-z][a-z0-9_]{0,31}$/.test(s.key)) {
          return {
            ok: false,
            reason: "network.secrets[].key \u5FC5\u987B\u662F\u5C0F\u5199\u5B57\u6BCD\u5F00\u5934\u7684 1\u201332 \u4F4D\u5C0F\u5199/\u6570\u5B57/\u4E0B\u5212\u7EBF"
          };
        }
        if (seenKeys.has(s.key)) {
          return {
            ok: false,
            reason: `network.secrets \u542B\u91CD\u590D key ${JSON.stringify(s.key)}`
          };
        }
        seenKeys.add(s.key);
        if (typeof s.label !== "string" || s.label.trim().length === 0 || s.label.length > 64) {
          return {
            ok: false,
            reason: "network.secrets[].label \u5FC5\u987B\u662F 1\u201364 \u5B57\u7B26\u7684\u975E\u7A7A\u5B57\u7B26\u4E32"
          };
        }
        let source;
        if (s.source !== void 0) {
          if (typeof s.source !== "string" || !GHOST_SECRET_SOURCES.includes(s.source)) {
            return {
              ok: false,
              reason: `network.secrets[].source \u4EC5\u652F\u6301 ${GHOST_SECRET_SOURCES.join(" / ")}(\u7F3A\u7701 user)`
            };
          }
          if (s.source === "login-email") source = "login-email";
          if (s.source === "oauth") source = "oauth";
          if (s.source === "login-feishu-token") source = "login-feishu-token";
          if (s.source === "oidc-token") source = "oidc-token";
          if (s.source === "gh-cli") source = "gh-cli";
        }
        if (s.input !== void 0 && s.input !== "ghost") {
          return {
            ok: false,
            reason: 'network.secrets[].input \u5DF2\u9000\u5F79:\u5BBF\u4E3B\u6536\u5355\u4E0D\u5B58\u5728,\u7528\u6237\u586B\u5199\u7684\u51ED\u8BC1\u4E00\u5F8B\u7531\u610F\u8BC6 settingsHtml \u6536\u5355(\u5220\u6389 input \u5B57\u6BB5\u5373\u53EF;\u552F\u4E00\u53EF\u63A5\u53D7\u7684\u9057\u7559\u503C\u662F "ghost")'
          };
        }
        const loginDerived = source === "login-email" || source === "login-feishu-token";
        const oidcManaged = source === "oidc-token";
        const ghCliManaged = source === "gh-cli";
        if (s.input === "ghost" && (loginDerived || oidcManaged || ghCliManaged)) {
          return {
            ok: false,
            reason: `source: ${source} \u7684\u51ED\u8BC1\u4E0D\u5141\u8BB8\u6807\u6CE8 input: ghost(Host \u6258\u7BA1\u51ED\u8BC1\u6CA1\u6709\u8F93\u5165,\u8C08\u4E0D\u4E0A\u8C01\u6536\u5355)`
          };
        }
        if (!loginDerived && !oidcManaged && raw.settingsHtml === void 0) {
          return {
            ok: false,
            reason: "network.secrets \u58F0\u660E\u4E86\u7528\u6237\u586B\u5199\u7684\u51ED\u8BC1\u65F6\u5FC5\u987B\u540C\u65F6\u58F0\u660E settingsHtml(\u51ED\u8BC1\u7531\u610F\u8BC6\u8BBE\u7F6E\u754C\u9762\u6536\u5355,\u6CA1\u6709\u754C\u9762\u5C31\u6CA1\u4EBA\u6536\u5355;\u5BBF\u4E3B\u6E32\u67D3\u8F93\u5165\u884C\u5DF2\u9000\u5F79)"
          };
        }
        if (loginDerived && s.url !== void 0) {
          return {
            ok: false,
            reason: `network.secrets[].source \u4E3A ${source} \u65F6\u4E0D\u5141\u8BB8\u58F0\u660E url(\u503C\u53D6\u81EA\u4E3B\u673A\u767B\u5F55\u6001,\u6CA1\u6709"\u524D\u5F80\u63A7\u5236\u53F0"\u53EF\u53BB)`
          };
        }
        if (loginDerived && s.exchange !== void 0) {
          return {
            ok: false,
            reason: `network.secrets[].source \u4E3A ${source} \u65F6\u4E0D\u5141\u8BB8\u58F0\u660E exchange(\u767B\u5F55\u6001\u51ED\u8BC1\u4E0D\u5916\u9001\u4EA4\u6362\u7AEF\u70B9)`
          };
        }
        if (oidcManaged && s.url !== void 0) {
          return {
            ok: false,
            reason: "network.secrets[].source \u4E3A oidc-token \u65F6\u4E0D\u5141\u8BB8\u58F0\u660E url(\u4EE4\u724C\u7531 Host \u6309\u9700\u7B7E\u53D1)"
          };
        }
        if (oidcManaged && s.exchange !== void 0) {
          return {
            ok: false,
            reason: "network.secrets[].source \u4E3A oidc-token \u65F6\u4E0D\u5141\u8BB8\u58F0\u660E exchange(\u4E0D\u5141\u8BB8\u628A Connection JWT \u8F6C\u4EA4\u7ED9\u7B2C\u4E09\u65B9\u7AEF\u70B9)"
          };
        }
        if (ghCliManaged && s.exchange !== void 0) {
          return {
            ok: false,
            reason: "network.secrets[].source \u4E3A gh-cli \u65F6\u4E0D\u5141\u8BB8\u58F0\u660E exchange(\u4E0D\u5141\u8BB8\u628A GitHub \u767B\u5F55\u4EE4\u724C\u8F6C\u4EA4\u7ED9\u7B2C\u4E09\u65B9\u7AEF\u70B9)"
          };
        }
        if (s.hint !== void 0 && (typeof s.hint !== "string" || s.hint.trim().length === 0 || s.hint.length > 200)) {
          return {
            ok: false,
            reason: "network.secrets[].hint \u5FC5\u987B\u662F 1\u2013200 \u5B57\u7B26\u7684\u975E\u7A7A\u5B57\u7B26\u4E32"
          };
        }
        if (s.url !== void 0) {
          if (typeof s.url !== "string" || s.url.length === 0 || s.url.length > 200) {
            return {
              ok: false,
              reason: "network.secrets[].url \u5FC5\u987B\u662F 1\u2013200 \u5B57\u7B26\u7684\u5B57\u7B26\u4E32"
            };
          }
          let parsed;
          try {
            parsed = new URL(s.url);
          } catch {
            return {
              ok: false,
              reason: "network.secrets[].url \u4E0D\u662F\u5408\u6CD5\u7684\u7EDD\u5BF9\u5730\u5740"
            };
          }
          if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
            return {
              ok: false,
              reason: "network.secrets[].url \u4EC5\u652F\u6301 https \u4E14\u4E0D\u5141\u8BB8\u5185\u5D4C\u7528\u6237\u540D/\u5BC6\u7801"
            };
          }
        }
        if (!isPlainObject(s.inject)) {
          return {
            ok: false,
            reason: `network.secrets[${JSON.stringify(s.key)}].inject \u5FC5\u586B(\u51ED\u8BC1\u8981\u58F0\u660E\u6CE8\u5165\u5230\u54EA\u4E2A\u8BF7\u6C42\u5934)`
          };
        }
        const inj = s.inject;
        if (typeof inj.header !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(inj.header)) {
          return {
            ok: false,
            reason: "network.secrets[].inject.header \u5FC5\u987B\u662F 1\u201364 \u4F4D\u5B57\u6BCD/\u6570\u5B57/\u8FDE\u5B57\u7B26\u7684\u5934\u540D"
          };
        }
        if (GHOST_NETWORK_FORBIDDEN_INJECT_HEADERS.includes(inj.header.toLowerCase())) {
          return {
            ok: false,
            reason: `network.secrets[].inject.header \u4E0D\u5141\u8BB8\u4F7F\u7528\u534F\u8BAE\u5173\u952E\u5934 ${JSON.stringify(inj.header)}`
          };
        }
        if (typeof inj.format !== "string" || inj.format.length === 0 || inj.format.length > 200 || inj.format.split("{value}").length !== 2) {
          return {
            ok: false,
            reason: 'network.secrets[].inject.format \u5FC5\u987B\u662F \u2264200 \u5B57\u7B26\u4E14\u6070\u542B\u4E00\u4E2A {value} \u5360\u4F4D\u7684\u5B57\u7B26\u4E32(\u5982 "Bearer {value}")'
          };
        }
        let injectHosts;
        if (inj.hosts !== void 0) {
          if (!Array.isArray(inj.hosts) || inj.hosts.length === 0) {
            return {
              ok: false,
              reason: "network.secrets[].inject.hosts \u5FC5\u987B\u662F\u975E\u7A7A\u6570\u7EC4(\u6216\u7701\u7565 = \u5168\u90E8\u767D\u540D\u5355\u57DF\u540D)"
            };
          }
          injectHosts = [];
          for (const ih of inj.hosts) {
            if (typeof ih !== "string" || !hosts.includes(ih.trim().toLowerCase())) {
              return {
                ok: false,
                reason: `network.secrets[].inject.hosts \u542B ${JSON.stringify(ih)}\u2014\u2014\u5FC5\u987B\u9010\u5B57\u53D6\u81EA network.hosts \u58F0\u660E\u6761\u76EE`
              };
            }
            const ihNorm = ih.trim().toLowerCase();
            if (injectHosts.includes(ihNorm)) {
              return {
                ok: false,
                reason: `network.secrets[].inject.hosts \u542B\u91CD\u590D\u6761\u76EE ${JSON.stringify(ih)}`
              };
            }
            injectHosts.push(ihNorm);
          }
        }
        if (oidcManaged) {
          if (inj.header !== "Authorization" || inj.format !== "Bearer {value}") {
            return {
              ok: false,
              reason: "network.secrets[].source \u4E3A oidc-token \u65F6 inject \u5FC5\u987B\u662F Authorization: Bearer {value}"
            };
          }
          if (injectHosts === void 0 || injectHosts.length === 0) {
            return {
              ok: false,
              reason: "network.secrets[].source \u4E3A oidc-token \u65F6\u5FC5\u987B\u663E\u5F0F\u58F0\u660E\u975E\u7A7A inject.hosts"
            };
          }
          if (injectHosts.some((host) => host.startsWith("*."))) {
            return {
              ok: false,
              reason: "network.secrets[].source \u4E3A oidc-token \u65F6 inject.hosts \u53EA\u5141\u8BB8\u7CBE\u786E\u57DF\u540D,\u4E0D\u5141\u8BB8\u901A\u914D"
            };
          }
        }
        if (ghCliManaged) {
          if (inj.header !== "Authorization" || inj.format !== "Bearer {value}") {
            return {
              ok: false,
              reason: "network.secrets[].source \u4E3A gh-cli \u65F6 inject \u5FC5\u987B\u662F Authorization: Bearer {value}"
            };
          }
          if (injectHosts === void 0 || injectHosts.length !== 1 || injectHosts[0] !== "api.github.com") {
            return {
              ok: false,
              reason: "network.secrets[].source \u4E3A gh-cli \u65F6 inject.hosts \u5FC5\u987B\u4E14\u53EA\u80FD\u662F api.github.com"
            };
          }
        }
        let oauth;
        if (source === "oauth" && s.oauth === void 0) {
          return {
            ok: false,
            reason: `network.secrets[${JSON.stringify(s.key)}].oauth \u5FC5\u586B(source: oauth \u7684\u51ED\u8BC1\u8981\u58F0\u660E\u53BB\u54EA\u6388\u6743)`
          };
        }
        if (source !== "oauth" && s.oauth !== void 0) {
          return {
            ok: false,
            reason: "network.secrets[].oauth \u4EC5\u5141\u8BB8\u5728 source: oauth \u7684\u51ED\u8BC1\u4E0A\u58F0\u660E"
          };
        }
        if (source === "oauth" && s.exchange !== void 0) {
          return {
            ok: false,
            reason: "network.secrets[].source \u4E3A oauth \u65F6\u4E0D\u5141\u8BB8\u58F0\u660E exchange(access token \u76F4\u63A5\u6CE8\u5165,\u65E0\u4E8C\u6BB5\u4EA4\u6362)"
          };
        }
        if (s.oauth !== void 0) {
          if (!isPlainObject(s.oauth)) {
            return {
              ok: false,
              reason: `network.secrets[${JSON.stringify(s.key)}].oauth \u5FC5\u987B\u662F\u5BF9\u8C61`
            };
          }
          const oa = s.oauth;
          const parseHostBoundUrl = (raw2, field) => {
            if (typeof raw2 !== "string" || raw2.length === 0 || raw2.length > 2048) {
              return {
                ok: false,
                reason: `network.secrets[].oauth.${field} \u5FC5\u987B\u662F 1\u20132048 \u5B57\u7B26\u7684\u5B57\u7B26\u4E32`
              };
            }
            let parsed2;
            try {
              parsed2 = new URL(raw2);
            } catch {
              return {
                ok: false,
                reason: `network.secrets[].oauth.${field} \u4E0D\u662F\u5408\u6CD5\u7684\u7EDD\u5BF9\u5730\u5740`
              };
            }
            if (parsed2.protocol !== "https:" || parsed2.port !== "" || parsed2.username || parsed2.password) {
              return {
                ok: false,
                reason: `network.secrets[].oauth.${field} \u4EC5\u652F\u6301 https \u9ED8\u8BA4\u7AEF\u53E3\u4E14\u4E0D\u5141\u8BB8\u5185\u5D4C\u7528\u6237\u540D/\u5BC6\u7801`
              };
            }
            if (!hosts.some((pattern) => ghostNetworkHostMatches(pattern, parsed2.hostname))) {
              return {
                ok: false,
                reason: `network.secrets[].oauth.${field} \u7684\u57DF\u540D ${JSON.stringify(parsed2.hostname)} \u5FC5\u987B\u547D\u4E2D network.hosts \u767D\u540D\u5355`
              };
            }
            return { ok: true, url: raw2 };
          };
          const authorizeParsed = parseHostBoundUrl(oa.authorizeUrl, "authorizeUrl");
          if (!authorizeParsed.ok) return authorizeParsed;
          const tokenParsed = parseHostBoundUrl(oa.tokenUrl, "tokenUrl");
          if (!tokenParsed.ok) return tokenParsed;
          if (oa.clientId !== void 0) {
            if (typeof oa.clientId !== "string" || oa.clientId.trim().length === 0 || oa.clientId.length > 200 || /\s/.test(oa.clientId)) {
              return {
                ok: false,
                reason: "network.secrets[].oauth.clientId \u5FC5\u987B\u662F 1\u2013200 \u5B57\u7B26\u3001\u4E0D\u542B\u7A7A\u767D\u7684\u5B57\u7B26\u4E32"
              };
            }
          }
          let oaClientIdAlternatives;
          if (oa.clientIdAlternatives !== void 0) {
            if (oa.clientId === void 0) {
              return {
                ok: false,
                reason: "network.secrets[].oauth.clientIdAlternatives \u5FC5\u987B\u4E0E\u9ED8\u8BA4 clientId \u4E00\u8D77\u58F0\u660E"
              };
            }
            if (!Array.isArray(oa.clientIdAlternatives) || oa.clientIdAlternatives.length === 0 || oa.clientIdAlternatives.length > GHOST_OAUTH_CLIENT_ID_ALTERNATIVES_MAX) {
              return {
                ok: false,
                reason: `network.secrets[].oauth.clientIdAlternatives \u5FC5\u987B\u662F 1\u2013${GHOST_OAUTH_CLIENT_ID_ALTERNATIVES_MAX} \u6761\u7684\u6570\u7EC4`
              };
            }
            oaClientIdAlternatives = [];
            for (const clientId of oa.clientIdAlternatives) {
              if (typeof clientId !== "string" || clientId.trim().length === 0 || clientId.length > 200 || /\s/.test(clientId)) {
                return {
                  ok: false,
                  reason: "network.secrets[].oauth.clientIdAlternatives \u542B\u975E\u6CD5\u6761\u76EE(\u987B\u4E3A 1\u2013200 \u5B57\u7B26\u3001\u4E0D\u542B\u7A7A\u767D\u7684\u5B57\u7B26\u4E32)"
                };
              }
              if (clientId === oa.clientId || oaClientIdAlternatives.includes(clientId)) {
                return {
                  ok: false,
                  reason: `network.secrets[].oauth.clientIdAlternatives \u542B\u91CD\u590D\u6761\u76EE ${JSON.stringify(clientId)}`
                };
              }
              oaClientIdAlternatives.push(clientId);
            }
          }
          if (oa.clientSecret !== void 0) {
            if (oa.clientId === void 0) {
              return {
                ok: false,
                reason: "network.secrets[].oauth.clientSecret \u5FC5\u987B\u4E0E clientId \u6210\u5BF9\u58F0\u660E"
              };
            }
            if (typeof oa.clientSecret !== "string" || oa.clientSecret.trim().length === 0 || oa.clientSecret.length > 200 || /\s/.test(oa.clientSecret)) {
              return {
                ok: false,
                reason: "network.secrets[].oauth.clientSecret \u5FC5\u987B\u662F 1\u2013200 \u5B57\u7B26\u3001\u4E0D\u542B\u7A7A\u767D\u7684\u5B57\u7B26\u4E32"
              };
            }
          }
          let oaScopes;
          if (oa.scopes !== void 0) {
            if (!Array.isArray(oa.scopes) || oa.scopes.length > GHOST_OAUTH_SCOPES_MAX) {
              return {
                ok: false,
                reason: `network.secrets[].oauth.scopes \u5FC5\u987B\u662F \u2264${GHOST_OAUTH_SCOPES_MAX} \u6761\u7684\u6570\u7EC4`
              };
            }
            oaScopes = [];
            for (const sc of oa.scopes) {
              if (typeof sc !== "string" || sc.trim().length === 0 || sc.length > 200 || /\s/.test(sc)) {
                return {
                  ok: false,
                  reason: `network.secrets[].oauth.scopes \u542B\u975E\u6CD5\u6761\u76EE ${JSON.stringify(sc)}(1\u2013200 \u5B57\u7B26\u3001\u4E0D\u542B\u7A7A\u767D)`
                };
              }
              if (oaScopes.includes(sc)) {
                return {
                  ok: false,
                  reason: `network.secrets[].oauth.scopes \u542B\u91CD\u590D\u6761\u76EE ${JSON.stringify(sc)}`
                };
              }
              oaScopes.push(sc);
            }
          }
          if (oa.pkce !== void 0 && typeof oa.pkce !== "boolean") {
            return {
              ok: false,
              reason: "network.secrets[].oauth.pkce \u5FC5\u987B\u662F\u5E03\u5C14\u503C(\u7F3A\u7701 true)"
            };
          }
          if (oa.scopeDelimiter !== void 0 && oa.scopeDelimiter !== ",") {
            return {
              ok: false,
              reason: 'network.secrets[].oauth.scopeDelimiter \u76EE\u524D\u53EA\u652F\u6301 ","(\u7F3A\u7701 = \u7A7A\u683C\u62FC\u63A5)'
            };
          }
          let oaExtra;
          if (oa.extraAuthorizeParams !== void 0) {
            if (!isPlainObject(oa.extraAuthorizeParams)) {
              return {
                ok: false,
                reason: "network.secrets[].oauth.extraAuthorizeParams \u5FC5\u987B\u662F\u5BF9\u8C61"
              };
            }
            const entries = Object.entries(oa.extraAuthorizeParams);
            if (entries.length === 0 || entries.length > GHOST_OAUTH_EXTRA_PARAMS_MAX) {
              return {
                ok: false,
                reason: `network.secrets[].oauth.extraAuthorizeParams \u5FC5\u987B\u662F 1\u2013${GHOST_OAUTH_EXTRA_PARAMS_MAX} \u6761(\u6216\u7701\u7565)`
              };
            }
            oaExtra = {};
            for (const [pk, pv] of entries) {
              if (!/^[a-z][a-z0-9_]{0,31}$/.test(pk)) {
                return {
                  ok: false,
                  reason: `network.secrets[].oauth.extraAuthorizeParams \u952E ${JSON.stringify(pk)} \u5FC5\u987B\u662F\u5C0F\u5199\u5B57\u6BCD\u5F00\u5934\u7684 1\u201332 \u4F4D\u5C0F\u5199/\u6570\u5B57/\u4E0B\u5212\u7EBF`
                };
              }
              if (GHOST_OAUTH_RESERVED_AUTHORIZE_PARAMS.includes(pk)) {
                return {
                  ok: false,
                  reason: `network.secrets[].oauth.extraAuthorizeParams \u4E0D\u5141\u8BB8\u58F0\u660E\u534F\u8BAE\u4FDD\u7559\u53C2\u6570 ${JSON.stringify(pk)}`
                };
              }
              if (typeof pv !== "string" || pv.length === 0 || pv.length > 200) {
                return {
                  ok: false,
                  reason: `network.secrets[].oauth.extraAuthorizeParams[${JSON.stringify(pk)}] \u5FC5\u987B\u662F 1\u2013200 \u5B57\u7B26\u7684\u5B57\u7B26\u4E32`
                };
              }
              oaExtra[pk] = pv;
            }
          }
          if (oa.redirectPort !== void 0) {
            if (typeof oa.redirectPort !== "number" || !Number.isInteger(oa.redirectPort) || oa.redirectPort < 1024 || oa.redirectPort > 65535) {
              return {
                ok: false,
                reason: "network.secrets[].oauth.redirectPort \u5FC5\u987B\u662F 1024\u201365535 \u7684\u6574\u6570"
              };
            }
          }
          if (oa.tokenBroker !== void 0) {
            if (typeof oa.tokenBroker !== "string" || !GHOST_OAUTH_TOKEN_BROKER_RE.test(oa.tokenBroker)) {
              return {
                ok: false,
                reason: "network.secrets[].oauth.tokenBroker \u5FC5\u987B\u662F\u5C0F\u5199\u5B57\u6BCD\u5F00\u5934\u7684 1\u201332 \u4F4D\u5C0F\u5199/\u6570\u5B57/\u4E0B\u5212\u7EBF/\u8FDE\u5B57\u7B26"
              };
            }
            if (oa.clientSecret !== void 0) {
              return {
                ok: false,
                reason: "network.secrets[].oauth.tokenBroker \u4E0E clientSecret \u4E92\u65A5(broker \u6A21\u5F0F\u4E0B secret \u7531\u670D\u52A1\u7AEF\u6301\u6709,\u4E0D\u968F\u5305\u5206\u53D1)"
              };
            }
          }
          if (oaClientIdAlternatives !== void 0 && oa.tokenBroker === void 0) {
            return {
              ok: false,
              reason: "network.secrets[].oauth.clientIdAlternatives \u4EC5\u5141\u8BB8\u4E0E tokenBroker \u4E00\u8D77\u58F0\u660E"
            };
          }
          let oaBounce;
          if (oa.brokerBounce !== void 0) {
            if (oa.tokenBroker === void 0 || oa.redirectPort === void 0) {
              return {
                ok: false,
                reason: "network.secrets[].oauth.brokerBounce \u5FC5\u987B\u4E0E tokenBroker\u3001redirectPort \u540C\u65F6\u58F0\u660E"
              };
            }
            if (!isPlainObject(oa.brokerBounce)) {
              return {
                ok: false,
                reason: "network.secrets[].oauth.brokerBounce \u5FC5\u987B\u662F\u5BF9\u8C61"
              };
            }
            const bb = oa.brokerBounce;
            for (const field of ["path", "callbackPath"]) {
              const v = bb[field];
              if (typeof v !== "string" || v.length > 128 || !GHOST_OAUTH_BOUNCE_PATH_RE.test(v)) {
                return {
                  ok: false,
                  reason: `network.secrets[].oauth.brokerBounce.${field} \u5FC5\u987B\u662F / \u5F00\u5934\u7684\u7AD9\u5185\u7EDD\u5BF9\u8DEF\u5F84(\u6BB5\u5B57\u7B26\u9650\u5B57\u6BCD/\u6570\u5B57/_/-,\u2264128 \u5B57\u7B26)`
                };
              }
            }
            oaBounce = {
              path: bb.path,
              callbackPath: bb.callbackPath
            };
          }
          let oaIdentity;
          if (oa.identity !== void 0) {
            if (!isPlainObject(oa.identity)) {
              return {
                ok: false,
                reason: "network.secrets[].oauth.identity \u5FC5\u987B\u662F\u5BF9\u8C61"
              };
            }
            const idn = oa.identity;
            const idnUrl = parseHostBoundUrl(idn.url, "identity.url");
            if (!idnUrl.ok) return idnUrl;
            if (typeof idn.labelPath !== "string" || idn.labelPath.length > 128 || !GHOST_SECRET_EXCHANGE_TOKEN_PATH_RE.test(idn.labelPath)) {
              return {
                ok: false,
                reason: 'network.secrets[].oauth.identity.labelPath \u5FC5\u987B\u662F \u2264128 \u5B57\u7B26\u7684\u70B9\u5206\u8DEF\u5F84(\u6BB5\u540D\u9650\u5B57\u6BCD/\u6570\u5B57/_/-,\u5982 "email" / "user.name")'
              };
            }
            let idnTemplate;
            if (idn.displayTemplate !== void 0) {
              if (typeof idn.displayTemplate !== "string" || idn.displayTemplate.length === 0 || idn.displayTemplate.length > GHOST_OAUTH_IDENTITY_TEMPLATE_MAX_CHARS) {
                return {
                  ok: false,
                  reason: `network.secrets[].oauth.identity.displayTemplate \u5FC5\u987B\u662F 1\u2013${GHOST_OAUTH_IDENTITY_TEMPLATE_MAX_CHARS} \u5B57\u7B26\u7684\u5B57\u7B26\u4E32`
                };
              }
              const placeholders = [
                ...idn.displayTemplate.matchAll(GHOST_OAUTH_IDENTITY_TEMPLATE_PLACEHOLDER_RE)
              ];
              if (placeholders.length === 0) {
                return {
                  ok: false,
                  reason: 'network.secrets[].oauth.identity.displayTemplate \u5FC5\u987B\u542B\u81F3\u5C11\u4E00\u4E2A {\u70B9\u5206\u8DEF\u5F84} \u5360\u4F4D\u7B26(\u5982 "{team} \xB7 {user}")'
                };
              }
              for (const m of placeholders) {
                const p = m[1] ?? "";
                if (p.length > 128 || !GHOST_SECRET_EXCHANGE_TOKEN_PATH_RE.test(p)) {
                  return {
                    ok: false,
                    reason: `network.secrets[].oauth.identity.displayTemplate \u5360\u4F4D\u7B26 {${p}} \u4E0D\u662F\u5408\u6CD5\u70B9\u5206\u8DEF\u5F84(\u6BB5\u540D\u9650\u5B57\u6BCD/\u6570\u5B57/_/-)`
                  };
                }
              }
              idnTemplate = idn.displayTemplate;
            }
            let idnAvatarPath;
            if (idn.avatarPath !== void 0) {
              if (typeof idn.avatarPath !== "string" || idn.avatarPath.length > 128 || !GHOST_SECRET_EXCHANGE_TOKEN_PATH_RE.test(idn.avatarPath)) {
                return {
                  ok: false,
                  reason: 'network.secrets[].oauth.identity.avatarPath \u5FC5\u987B\u662F \u2264128 \u5B57\u7B26\u7684\u70B9\u5206\u8DEF\u5F84(\u6BB5\u540D\u9650\u5B57\u6BCD/\u6570\u5B57/_/-,\u5982 "data.avatar_thumb")'
                };
              }
              idnAvatarPath = idn.avatarPath;
            }
            oaIdentity = {
              url: idnUrl.url,
              labelPath: idn.labelPath,
              ...idnTemplate !== void 0 ? { displayTemplate: idnTemplate } : {},
              ...idnAvatarPath !== void 0 ? { avatarPath: idnAvatarPath } : {}
            };
          }
          oauth = {
            authorizeUrl: authorizeParsed.url,
            tokenUrl: tokenParsed.url,
            ...oa.clientId !== void 0 ? { clientId: oa.clientId } : {},
            ...oaClientIdAlternatives !== void 0 ? { clientIdAlternatives: oaClientIdAlternatives } : {},
            ...oa.clientSecret !== void 0 ? { clientSecret: oa.clientSecret } : {},
            ...oaScopes !== void 0 ? { scopes: oaScopes } : {},
            ...oa.scopeDelimiter !== void 0 ? { scopeDelimiter: oa.scopeDelimiter } : {},
            ...oa.pkce !== void 0 ? { pkce: oa.pkce } : {},
            ...oaExtra !== void 0 ? { extraAuthorizeParams: oaExtra } : {},
            ...oaIdentity !== void 0 ? { identity: oaIdentity } : {},
            ...oa.redirectPort !== void 0 ? { redirectPort: oa.redirectPort } : {},
            ...oa.tokenBroker !== void 0 ? { tokenBroker: oa.tokenBroker } : {},
            ...oaBounce !== void 0 ? { brokerBounce: oaBounce } : {}
          };
        }
        let exchange;
        if (s.exchange !== void 0) {
          if (!isPlainObject(s.exchange)) {
            return {
              ok: false,
              reason: `network.secrets[${JSON.stringify(s.key)}].exchange \u5FC5\u987B\u662F\u5BF9\u8C61`
            };
          }
          const ex = s.exchange;
          if (typeof ex.url !== "string" || ex.url.length === 0 || ex.url.length > 2048) {
            return {
              ok: false,
              reason: "network.secrets[].exchange.url \u5FC5\u987B\u662F 1\u20132048 \u5B57\u7B26\u7684\u5B57\u7B26\u4E32"
            };
          }
          let exUrl;
          try {
            exUrl = new URL(ex.url);
          } catch {
            return {
              ok: false,
              reason: "network.secrets[].exchange.url \u4E0D\u662F\u5408\u6CD5\u7684\u7EDD\u5BF9\u5730\u5740"
            };
          }
          if (exUrl.protocol !== "https:" || exUrl.port !== "" || exUrl.username || exUrl.password) {
            return {
              ok: false,
              reason: "network.secrets[].exchange.url \u4EC5\u652F\u6301 https \u9ED8\u8BA4\u7AEF\u53E3\u4E14\u4E0D\u5141\u8BB8\u5185\u5D4C\u7528\u6237\u540D/\u5BC6\u7801"
            };
          }
          if (!hosts.some((pattern) => ghostNetworkHostMatches(pattern, exUrl.hostname))) {
            return {
              ok: false,
              reason: `network.secrets[].exchange.url \u7684\u57DF\u540D ${JSON.stringify(exUrl.hostname)} \u5FC5\u987B\u547D\u4E2D network.hosts \u767D\u540D\u5355`
            };
          }
          if (typeof ex.bodyFormat !== "string" || ex.bodyFormat.length === 0 || ex.bodyFormat.length > GHOST_SECRET_EXCHANGE_BODY_MAX_CHARS || ex.bodyFormat.split("{value}").length !== 2) {
            return {
              ok: false,
              reason: `network.secrets[].exchange.bodyFormat \u5FC5\u987B\u662F \u2264${GHOST_SECRET_EXCHANGE_BODY_MAX_CHARS} \u5B57\u7B26\u4E14\u6070\u542B\u4E00\u4E2A {value} \u5360\u4F4D\u7684\u5B57\u7B26\u4E32`
            };
          }
          let exContentType;
          if (ex.contentType !== void 0) {
            if (typeof ex.contentType !== "string" || !GHOST_SECRET_EXCHANGE_CONTENT_TYPES.includes(ex.contentType)) {
              return {
                ok: false,
                reason: `network.secrets[].exchange.contentType \u4EC5\u652F\u6301 ${GHOST_SECRET_EXCHANGE_CONTENT_TYPES.join(" / ")}`
              };
            }
            exContentType = ex.contentType;
          }
          if (typeof ex.tokenPath !== "string" || ex.tokenPath.length > 128 || !GHOST_SECRET_EXCHANGE_TOKEN_PATH_RE.test(ex.tokenPath)) {
            return {
              ok: false,
              reason: 'network.secrets[].exchange.tokenPath \u5FC5\u987B\u662F \u2264128 \u5B57\u7B26\u7684\u70B9\u5206\u8DEF\u5F84(\u6BB5\u540D\u9650\u5B57\u6BCD/\u6570\u5B57/_/-,\u5982 "session" / "data.token")'
            };
          }
          let exTtl;
          if (ex.ttlSeconds !== void 0) {
            if (typeof ex.ttlSeconds !== "number" || !Number.isInteger(ex.ttlSeconds) || ex.ttlSeconds < GHOST_SECRET_EXCHANGE_TTL_MIN_S || ex.ttlSeconds > GHOST_SECRET_EXCHANGE_TTL_MAX_S) {
              return {
                ok: false,
                reason: `network.secrets[].exchange.ttlSeconds \u5FC5\u987B\u662F ${GHOST_SECRET_EXCHANGE_TTL_MIN_S}\u2013${GHOST_SECRET_EXCHANGE_TTL_MAX_S} \u7684\u6574\u6570(\u79D2)`
              };
            }
            exTtl = ex.ttlSeconds;
          }
          exchange = {
            url: ex.url,
            bodyFormat: ex.bodyFormat,
            ...exContentType !== void 0 ? { contentType: exContentType } : {},
            tokenPath: ex.tokenPath,
            ...exTtl !== void 0 ? { ttlSeconds: exTtl } : {}
          };
        }
        secrets.push({
          key: s.key,
          label: s.label,
          ...source !== void 0 ? { source } : {},
          ...s.hint !== void 0 ? { hint: s.hint } : {},
          ...s.url !== void 0 ? { url: s.url } : {},
          inject: {
            header: inj.header,
            format: inj.format,
            ...injectHosts !== void 0 ? { hosts: injectHosts } : {}
          },
          ...exchange !== void 0 ? { exchange } : {},
          ...oauth !== void 0 ? { oauth } : {}
        });
      }
    }
    let connections;
    if (n.connections !== void 0) {
      if (!Array.isArray(n.connections) || n.connections.length === 0 || n.connections.length > GHOST_NETWORK_MAX_CONNECTION_DECLS) {
        return {
          ok: false,
          reason: `network.connections \u5FC5\u987B\u662F 1\u2013${GHOST_NETWORK_MAX_CONNECTION_DECLS} \u6761\u7684\u6570\u7EC4`
        };
      }
      if (raw.settingsHtml === void 0) {
        return {
          ok: false,
          reason: "\u58F0\u660E\u4E86 network.connections \u5FC5\u987B\u540C\u65F6\u58F0\u660E settingsHtml(\u8FDE\u63A5\u5730\u5740\u4E0E\u51ED\u8BC1\u7531\u610F\u8BC6\u8BBE\u7F6E\u754C\u9762\u6536\u5355,\u6CA1\u6709\u754C\u9762\u5C31\u6CA1\u4EBA\u6536\u5355)"
        };
      }
      connections = [];
      const seenConnKeys = /* @__PURE__ */ new Set();
      const secretKeySet = new Set((secrets ?? []).map((s) => s.key));
      for (const c of n.connections) {
        if (!isPlainObject(c)) return { ok: false, reason: "network.connections \u6BCF\u9879\u5FC5\u987B\u662F\u5BF9\u8C61" };
        if (typeof c.key !== "string" || !/^[a-z][a-z0-9_]{0,31}$/.test(c.key)) {
          return {
            ok: false,
            reason: "network.connections[].key \u5FC5\u987B\u662F\u5C0F\u5199\u5B57\u6BCD\u5F00\u5934\u7684 1\u201332 \u4F4D\u5C0F\u5199/\u6570\u5B57/\u4E0B\u5212\u7EBF"
          };
        }
        if (seenConnKeys.has(c.key)) {
          return {
            ok: false,
            reason: `network.connections \u542B\u91CD\u590D key ${JSON.stringify(c.key)}`
          };
        }
        if (secretKeySet.has(c.key)) {
          return {
            ok: false,
            reason: `network.connections[].key ${JSON.stringify(c.key)} \u4E0E network.secrets \u7684 key \u649E\u540D(\u4E24\u8005\u5171\u7528\u547D\u540D\u7A7A\u95F4)`
          };
        }
        seenConnKeys.add(c.key);
        if (typeof c.label !== "string" || c.label.trim().length === 0 || c.label.length > 64) {
          return {
            ok: false,
            reason: "network.connections[].label \u5FC5\u987B\u662F 1\u201364 \u5B57\u7B26\u7684\u975E\u7A7A\u5B57\u7B26\u4E32"
          };
        }
        if (c.hint !== void 0 && (typeof c.hint !== "string" || c.hint.trim().length === 0 || c.hint.length > 200)) {
          return {
            ok: false,
            reason: "network.connections[].hint \u5FC5\u987B\u662F 1\u2013200 \u5B57\u7B26\u7684\u975E\u7A7A\u5B57\u7B26\u4E32"
          };
        }
        if (!isPlainObject(c.inject)) {
          return {
            ok: false,
            reason: `network.connections[${JSON.stringify(c.key)}].inject \u5FC5\u586B(\u8FDE\u63A5\u51ED\u8BC1\u8981\u58F0\u660E\u6CE8\u5165\u5230\u54EA\u4E2A\u8BF7\u6C42\u5934)`
          };
        }
        const cinj = c.inject;
        if (typeof cinj.header !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(cinj.header)) {
          return {
            ok: false,
            reason: "network.connections[].inject.header \u5FC5\u987B\u662F 1\u201364 \u4F4D\u5B57\u6BCD/\u6570\u5B57/\u8FDE\u5B57\u7B26\u7684\u5934\u540D"
          };
        }
        if (GHOST_NETWORK_FORBIDDEN_INJECT_HEADERS.includes(cinj.header.toLowerCase())) {
          return {
            ok: false,
            reason: `network.connections[].inject.header \u4E0D\u5141\u8BB8\u4F7F\u7528\u534F\u8BAE\u5173\u952E\u5934 ${JSON.stringify(cinj.header)}`
          };
        }
        if (typeof cinj.format !== "string" || cinj.format.length === 0 || cinj.format.length > 200 || cinj.format.split("{value}").length !== 2) {
          return {
            ok: false,
            reason: 'network.connections[].inject.format \u5FC5\u987B\u662F \u2264200 \u5B57\u7B26\u4E14\u6070\u542B\u4E00\u4E2A {value} \u5360\u4F4D\u7684\u5B57\u7B26\u4E32(\u5982 "Bearer {value}")'
          };
        }
        if (cinj.hosts !== void 0) {
          return {
            ok: false,
            reason: "network.connections[].inject.hosts \u4E0D\u5141\u8BB8\u58F0\u660E(\u8FDE\u63A5\u51ED\u8BC1\u53EA\u6CE8\u5165\u5BF9\u5E94\u8FDE\u63A5\u81EA\u8EAB\u7684\u5730\u5740)"
          };
        }
        if (c.maxConnections !== void 0) {
          if (typeof c.maxConnections !== "number" || !Number.isInteger(c.maxConnections) || c.maxConnections < 1 || c.maxConnections > GHOST_NETWORK_MAX_CONNECTIONS_PER_DECL) {
            return {
              ok: false,
              reason: `network.connections[].maxConnections \u5FC5\u987B\u662F 1\u2013${GHOST_NETWORK_MAX_CONNECTIONS_PER_DECL} \u7684\u6574\u6570(\u7F3A\u7701 ${GHOST_NETWORK_MAX_CONNECTIONS_PER_DECL})`
            };
          }
        }
        connections.push({
          key: c.key,
          label: c.label,
          ...c.hint !== void 0 ? { hint: c.hint } : {},
          inject: { header: cinj.header, format: cinj.format },
          ...c.maxConnections !== void 0 ? { maxConnections: c.maxConnections } : {}
        });
      }
    }
    network = {
      hosts,
      ...secrets !== void 0 ? { secrets } : {},
      ...connections !== void 0 ? { connections } : {}
    };
  }
  let agent;
  if (raw.agent !== void 0) {
    if (!isPlainObject(raw.agent)) {
      return {
        ok: false,
        reason: 'agent \u80FD\u529B\u8BE6\u5355\u5FC5\u987B\u662F\u5BF9\u8C61(\u5982 { "background": true })'
      };
    }
    if (!slots.includes("agent")) {
      return {
        ok: false,
        reason: '\u58F0\u660E\u4E86 agent \u80FD\u529B\u8BE6\u5355\u4F46 slots \u672A\u5305\u542B "agent"'
      };
    }
    const agentRaw = raw.agent;
    if (agentRaw.background !== void 0 && typeof agentRaw.background !== "boolean") {
      return { ok: false, reason: "agent.background \u5FC5\u987B\u662F\u5E03\u5C14\u503C" };
    }
    if (agentRaw.errand !== void 0 && typeof agentRaw.errand !== "boolean") {
      return { ok: false, reason: "agent.errand \u5FC5\u987B\u662F\u5E03\u5C14\u503C" };
    }
    if (agentRaw.schedule !== void 0 && typeof agentRaw.schedule !== "boolean") {
      return { ok: false, reason: "agent.schedule \u5FC5\u987B\u662F\u5E03\u5C14\u503C" };
    }
    if (agentRaw.background !== true && agentRaw.errand !== true && agentRaw.schedule !== true && Object.keys(unknownDeclarationFields(agentRaw, ["background", "errand", "schedule"])).length === 0) {
      return {
        ok: false,
        reason: "agent \u80FD\u529B\u8BE6\u5355\u53EA\u6709 background: true / errand: true / schedule: true \u4E09\u9879\u52A0\u6863;\u4EC5\u9700\u7528\u6237\u70B9\u51FB\u89E6\u53D1\u65F6\u8BF7\u7701\u7565 agent \u5B57\u6BB5"
      };
    }
    agent = {
      ...unknownDeclarationFields(agentRaw, ["background", "errand", "schedule"]),
      ...agentRaw.background === true ? { background: true } : {},
      ...agentRaw.errand === true ? { errand: true } : {},
      ...agentRaw.schedule === true ? { schedule: true } : {}
    };
  }
  let node;
  if (raw.node !== void 0) {
    if (!isPlainObject(raw.node)) {
      return { ok: false, reason: "node \u80FD\u529B\u8BE6\u5355\u5FC5\u987B\u662F\u5BF9\u8C61" };
    }
    if (!slots.includes("node")) {
      return {
        ok: false,
        reason: '\u58F0\u660E\u4E86 node \u80FD\u529B\u8BE6\u5355\u4F46 slots \u672A\u5305\u542B "node"'
      };
    }
    const nodeRaw = raw.node;
    if (!isSafeGhostRelativePath(nodeRaw.entry)) {
      return { ok: false, reason: "node.entry \u5FC5\u987B\u662F\u5B89\u88C5\u76EE\u5F55\u5185\u7684\u5B89\u5168\u76F8\u5BF9\u8DEF\u5F84" };
    }
    if (!/\.(?:c?js)$/.test(nodeRaw.entry)) {
      return {
        ok: false,
        reason: "node.entry \u5FC5\u987B\u662F CommonJS .js / .cjs \u6587\u4EF6"
      };
    }
    if (nodeRaw.entry.toLowerCase() === raw.entry.toLowerCase()) {
      return {
        ok: false,
        reason: "node.entry \u4E0D\u80FD\u4E0E\u6D4F\u89C8\u5668\u6C99\u7BB1 entry \u4F7F\u7528\u540C\u4E00\u4E2A\u6587\u4EF6"
      };
    }
    if (typeof nodeRaw.protocol !== "string" || !GHOST_NODE_PROTOCOLS.includes(nodeRaw.protocol)) {
      return {
        ok: false,
        reason: `node.protocol \u5FC5\u987B\u662F ${GHOST_NODE_PROTOCOLS.join(" / ")}`
      };
    }
    if (nodeRaw.lifecycle !== void 0 && (typeof nodeRaw.lifecycle !== "string" || !GHOST_NODE_LIFECYCLES.includes(nodeRaw.lifecycle))) {
      return {
        ok: false,
        reason: `node.lifecycle \u5FC5\u987B\u662F ${GHOST_NODE_LIFECYCLES.join(" / ")}`
      };
    }
    if (nodeRaw.idleTimeoutSeconds !== void 0 && (typeof nodeRaw.idleTimeoutSeconds !== "number" || !Number.isInteger(nodeRaw.idleTimeoutSeconds) || nodeRaw.idleTimeoutSeconds < 30 || nodeRaw.idleTimeoutSeconds > 3600)) {
      return {
        ok: false,
        reason: "node.idleTimeoutSeconds \u5FC5\u987B\u662F 30\u20133600 \u7684\u6574\u6570"
      };
    }
    if (nodeRaw.lifecycle === "resident" && nodeRaw.idleTimeoutSeconds !== void 0) {
      return {
        ok: false,
        reason: "node.lifecycle \u4E3A resident \u65F6\u4E0D\u80FD\u518D\u58F0\u660E idleTimeoutSeconds"
      };
    }
    let nodeEntries;
    if (nodeRaw.entries !== void 0) {
      if (!Array.isArray(nodeRaw.entries) || nodeRaw.entries.length === 0) {
        return {
          ok: false,
          reason: "node.entries \u5FC5\u987B\u662F\u975E\u7A7A\u6570\u7EC4(\u989D\u5916\u5DE5\u4F5C\u8FDB\u7A0B\u5165\u53E3\u6E05\u5355)"
        };
      }
      if (nodeRaw.entries.length > GHOST_NODE_MAX_EXTRA_ENTRIES) {
        return {
          ok: false,
          reason: `node.entries \u6700\u591A ${GHOST_NODE_MAX_EXTRA_ENTRIES} \u6761`
        };
      }
      const seen = /* @__PURE__ */ new Set();
      for (const extra of nodeRaw.entries) {
        if (!isSafeGhostRelativePath(extra)) {
          return {
            ok: false,
            reason: "node.entries \u6BCF\u9879\u5FC5\u987B\u662F\u5B89\u88C5\u76EE\u5F55\u5185\u7684\u5B89\u5168\u76F8\u5BF9\u8DEF\u5F84"
          };
        }
        if (!/\.(?:c?js)$/.test(extra)) {
          return {
            ok: false,
            reason: "node.entries \u6BCF\u9879\u5FC5\u987B\u662F CommonJS .js / .cjs \u6587\u4EF6"
          };
        }
        const extraFold = extra.toLowerCase();
        if (extraFold === raw.entry.toLowerCase()) {
          return { ok: false, reason: "node.entries \u4E0D\u80FD\u5305\u542B\u6D4F\u89C8\u5668\u6C99\u7BB1 entry" };
        }
        if (extraFold === nodeRaw.entry.toLowerCase()) {
          return {
            ok: false,
            reason: "node.entries \u4E0D\u80FD\u91CD\u590D\u4E3B\u5165\u53E3 node.entry"
          };
        }
        if (seen.has(extraFold)) {
          return {
            ok: false,
            reason: `node.entries \u542B\u91CD\u590D\u5165\u53E3 ${JSON.stringify(extra)}`
          };
        }
        seen.add(extraFold);
      }
      nodeEntries = nodeRaw.entries;
    }
    if (nodeRaw.childSpawn !== void 0 && typeof nodeRaw.childSpawn !== "boolean") {
      return { ok: false, reason: "node.childSpawn \u5FC5\u987B\u662F\u5E03\u5C14\u503C" };
    }
    let nodeSecretBindings;
    if (nodeRaw.secretBindings !== void 0) {
      if (!Array.isArray(nodeRaw.secretBindings) || nodeRaw.secretBindings.length === 0 || nodeRaw.secretBindings.length > GHOST_NODE_MAX_SECRET_BINDINGS) {
        return {
          ok: false,
          reason: `node.secretBindings \u5FC5\u987B\u662F 1\u2013${GHOST_NODE_MAX_SECRET_BINDINGS} \u6761\u7684\u6570\u7EC4`
        };
      }
      if (raw.settingsHtml === void 0) {
        return {
          ok: false,
          reason: "node.secretBindings \u9700\u8981 settingsHtml \u6536\u96C6\u51ED\u8BC1"
        };
      }
      nodeSecretBindings = [];
      const seenSecretKeys = /* @__PURE__ */ new Set();
      for (const bindingRaw of nodeRaw.secretBindings) {
        if (!isPlainObject(bindingRaw)) {
          return { ok: false, reason: "node.secretBindings \u6BCF\u9879\u5FC5\u987B\u662F\u5BF9\u8C61" };
        }
        const binding = bindingRaw;
        if (typeof binding.key !== "string" || !/^[a-z][a-z0-9_]{0,31}$/.test(binding.key)) {
          return {
            ok: false,
            reason: "node.secretBindings[].key \u5FC5\u987B\u662F\u5C0F\u5199\u5B57\u6BCD\u5F00\u5934\u7684 1\u201332 \u4F4D\u5C0F\u5199/\u6570\u5B57/\u4E0B\u5212\u7EBF"
          };
        }
        if (seenSecretKeys.has(binding.key)) {
          return {
            ok: false,
            reason: `node.secretBindings \u542B\u91CD\u590D key ${JSON.stringify(binding.key)}`
          };
        }
        seenSecretKeys.add(binding.key);
        if (typeof binding.label !== "string" || binding.label.trim().length === 0 || binding.label.length > 64) {
          return {
            ok: false,
            reason: "node.secretBindings[].label \u5FC5\u987B\u662F 1\u201364 \u5B57\u7B26\u7684\u975E\u7A7A\u5B57\u7B26\u4E32"
          };
        }
        if (!Array.isArray(binding.methods) || binding.methods.length === 0 || binding.methods.length > GHOST_NODE_MAX_SECRET_METHODS) {
          return {
            ok: false,
            reason: `node.secretBindings[].methods \u5FC5\u987B\u662F 1\u2013${GHOST_NODE_MAX_SECRET_METHODS} \u6761\u7684\u6570\u7EC4`
          };
        }
        const methods = [];
        for (const method of binding.methods) {
          if (typeof method !== "string" || !/^[A-Za-z0-9_./:-]{1,128}$/.test(method)) {
            return {
              ok: false,
              reason: "node.secretBindings[].methods \u6BCF\u9879\u5FC5\u987B\u662F 1\u2013128 \u4F4D\u5B89\u5168\u65B9\u6CD5\u540D"
            };
          }
          if (nodeRaw.protocol === "mcp-stdio" && isGhostNodeMcpReservedMethod(method)) {
            return {
              ok: false,
              reason: `node.secretBindings[].methods \u4E0D\u80FD\u7ED1\u5B9A\u5BBF\u4E3B\u4FDD\u7559\u7684 MCP \u65B9\u6CD5 ${JSON.stringify(method)}`
            };
          }
          if (methods.includes(method)) {
            return {
              ok: false,
              reason: `node.secretBindings[].methods \u542B\u91CD\u590D\u65B9\u6CD5 ${JSON.stringify(method)}`
            };
          }
          methods.push(method);
        }
        let bindingEntry;
        if (binding.entry !== void 0) {
          if (typeof binding.entry !== "string" || binding.entry !== nodeRaw.entry && !(nodeEntries ?? []).includes(binding.entry)) {
            return {
              ok: false,
              reason: "node.secretBindings[].entry \u5FC5\u987B\u9010\u5B57\u547D\u4E2D node.entry \u6216 node.entries"
            };
          }
          bindingEntry = binding.entry;
        }
        if (binding.hint !== void 0 && (typeof binding.hint !== "string" || binding.hint.trim().length === 0 || binding.hint.length > 200)) {
          return {
            ok: false,
            reason: "node.secretBindings[].hint \u5FC5\u987B\u662F 1\u2013200 \u5B57\u7B26\u7684\u975E\u7A7A\u5B57\u7B26\u4E32"
          };
        }
        if (binding.url !== void 0) {
          if (typeof binding.url !== "string" || binding.url.length === 0 || binding.url.length > 200) {
            return {
              ok: false,
              reason: "node.secretBindings[].url \u5FC5\u987B\u662F 1\u2013200 \u5B57\u7B26\u7684\u5B57\u7B26\u4E32"
            };
          }
          let parsed;
          try {
            parsed = new URL(binding.url);
          } catch {
            return {
              ok: false,
              reason: "node.secretBindings[].url \u4E0D\u662F\u5408\u6CD5\u7684\u7EDD\u5BF9\u5730\u5740"
            };
          }
          if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
            return {
              ok: false,
              reason: "node.secretBindings[].url \u4EC5\u652F\u6301 https \u4E14\u4E0D\u5141\u8BB8\u5185\u5D4C\u7528\u6237\u540D/\u5BC6\u7801"
            };
          }
        }
        if (binding.oauthSecret !== void 0 && (typeof binding.oauthSecret !== "string" || !/^[a-z][a-z0-9_]{0,31}$/.test(binding.oauthSecret))) {
          return { ok: false, reason: "node.secretBindings[].oauthSecret \u5FC5\u987B\u662F\u672C\u63D2\u4EF6 OAuth \u51ED\u8BC1\u952E" };
        }
        nodeSecretBindings.push({
          ...unknownDeclarationFields(binding, ["key", "label", "methods", "entry", "hint", "url", "oauthSecret"]),
          ...binding.oauthSecret !== void 0 ? { oauthSecret: binding.oauthSecret } : {},
          key: binding.key,
          label: binding.label,
          methods,
          ...bindingEntry !== void 0 ? { entry: bindingEntry } : {},
          ...binding.hint !== void 0 ? { hint: binding.hint } : {},
          ...binding.url !== void 0 ? { url: binding.url } : {}
        });
      }
    }
    node = {
      ...unknownDeclarationFields(nodeRaw, ["entry", "protocol", "lifecycle", "idleTimeoutSeconds", "entries", "childSpawn", "secretBindings"]),
      entry: nodeRaw.entry,
      protocol: nodeRaw.protocol,
      ...nodeRaw.lifecycle !== void 0 ? { lifecycle: nodeRaw.lifecycle } : {},
      ...nodeRaw.idleTimeoutSeconds !== void 0 ? { idleTimeoutSeconds: nodeRaw.idleTimeoutSeconds } : {},
      ...nodeEntries !== void 0 ? { entries: nodeEntries } : {},
      ...nodeRaw.childSpawn !== void 0 ? { childSpawn: nodeRaw.childSpawn } : {},
      ...nodeSecretBindings !== void 0 ? { secretBindings: nodeSecretBindings } : {}
    };
  }
  if (slots.includes("node") && node === void 0) {
    return {
      ok: false,
      reason: 'slots \u58F0\u660E\u4E86 "node" \u4F46\u7F3A\u5C11 node \u5DE5\u4F5C\u8FDB\u7A0B\u8BE6\u5355'
    };
  }
  if (node?.secretBindings) {
    for (const binding of node.secretBindings) {
      if (network?.secrets?.some((secret) => secret.key === binding.key)) {
        return {
          ok: false,
          reason: `network.secrets \u7684 key ${JSON.stringify(binding.key)} \u4E0E node.secretBindings \u649E\u540D`
        };
      }
      if (network?.connections?.some((connection) => connection.key === binding.key)) {
        return {
          ok: false,
          reason: `network.connections[].key ${JSON.stringify(binding.key)} \u4E0E node.secretBindings \u7684 key \u649E\u540D(\u4E24\u8005\u5171\u7528\u547D\u540D\u7A7A\u95F4)`
        };
      }
    }
  }
  let preview;
  if (raw.preview !== void 0) {
    if (!isPlainObject(raw.preview)) {
      return {
        ok: false,
        reason: 'preview \u8BE6\u5355\u5FC5\u987B\u662F\u5BF9\u8C61(\u5982 { "hosts": ["*.example.com"] })'
      };
    }
    if (!slots.includes("preview")) {
      return {
        ok: false,
        reason: '\u58F0\u660E\u4E86 preview \u8BE6\u5355\u4F46 slots \u672A\u5305\u542B "preview"'
      };
    }
    const previewRaw = raw.preview;
    if (!Array.isArray(previewRaw.hosts) || previewRaw.hosts.length === 0) {
      return {
        ok: false,
        reason: "preview.hosts \u5FC5\u987B\u662F\u975E\u7A7A\u6570\u7EC4(\u53EF\u6253\u5F00\u9884\u89C8\u7684\u57DF\u540D\u767D\u540D\u5355)"
      };
    }
    if (previewRaw.hosts.length > GHOST_PREVIEW_MAX_HOSTS) {
      return {
        ok: false,
        reason: `preview.hosts \u6700\u591A ${GHOST_PREVIEW_MAX_HOSTS} \u6761`
      };
    }
    const seenPreviewHosts = /* @__PURE__ */ new Set();
    for (const host of previewRaw.hosts) {
      if (!isValidGhostNetworkHostPattern(host) && !(typeof host === "string" && GHOST_PREVIEW_LOOPBACK_HOSTS.has(host))) {
        return {
          ok: false,
          reason: `preview.hosts \u542B\u4E0D\u5408\u6CD5\u57DF\u540D\u6A21\u5F0F ${JSON.stringify(host)}`
        };
      }
      if (seenPreviewHosts.has(host)) {
        return {
          ok: false,
          reason: `preview.hosts \u542B\u91CD\u590D\u57DF\u540D ${JSON.stringify(host)}`
        };
      }
      seenPreviewHosts.add(host);
    }
    preview = { ...unknownDeclarationFields(previewRaw, ["hosts"]), hosts: previewRaw.hosts };
  }
  if (slots.includes("preview") && preview === void 0) {
    return {
      ok: false,
      reason: 'slots \u58F0\u660E\u4E86 "preview" \u4F46\u7F3A\u5C11 preview \u8BE6\u5355(hosts \u57DF\u540D\u767D\u540D\u5355\u5FC5\u586B)'
    };
  }
  let skill;
  if (raw.skill !== void 0) {
    if (!isPlainObject(raw.skill)) {
      return {
        ok: false,
        reason: 'skill \u8BE6\u5355\u5FC5\u987B\u662F\u5BF9\u8C61(\u5982 { "items": [{ "dir": "skills/foo", "name": "foo", "description": "..." }] })'
      };
    }
    if (!slots.includes("skill")) {
      return { ok: false, reason: '\u58F0\u660E\u4E86 skill \u8BE6\u5355\u4F46 slots \u672A\u5305\u542B "skill"' };
    }
    const skillRaw = raw.skill;
    if (!Array.isArray(skillRaw.items) || skillRaw.items.length === 0) {
      return {
        ok: false,
        reason: "skill.items \u5FC5\u987B\u662F\u975E\u7A7A\u6570\u7EC4(\u968F\u5305\u6346\u7ED1\u7684\u6280\u80FD\u6E05\u5355)"
      };
    }
    if (skillRaw.items.length > GHOST_SKILL_MAX_ITEMS) {
      return {
        ok: false,
        reason: `skill.items \u6700\u591A ${GHOST_SKILL_MAX_ITEMS} \u6761`
      };
    }
    const skillItems = [];
    const seenSkillNames = /* @__PURE__ */ new Set();
    const seenSkillDirs = /* @__PURE__ */ new Set();
    for (const item of skillRaw.items) {
      if (!isPlainObject(item)) {
        return {
          ok: false,
          reason: "skill.items \u6BCF\u9879\u5FC5\u987B\u662F\u5BF9\u8C61({ dir, name, description })"
        };
      }
      const itemRaw = item;
      if (!isSafeGhostRelativePath(itemRaw.dir)) {
        return {
          ok: false,
          reason: `skill.items[].dir \u5FC5\u987B\u662F\u5305\u5185\u5B89\u5168\u76F8\u5BF9\u8DEF\u5F84(\u5982 "skills/foo"),\u5F97\u5230 ${JSON.stringify(itemRaw.dir)}`
        };
      }
      if (typeof itemRaw.name !== "string" || itemRaw.name.length > GHOST_SKILL_NAME_MAX_CHARS || !GHOST_SKILL_NAME_RE.test(itemRaw.name)) {
        return {
          ok: false,
          reason: `skill.items[].name \u5FC5\u987B\u662F\u5C0F\u5199\u5B57\u6BCD/\u6570\u5B57\u52A0\u5355\u8FDE\u5B57\u7B26\u5206\u6BB5(\u7981\u9996\u5C3E/\u8FDE\u7EED\u8FDE\u5B57\u7B26)\u3001\u957F\u5EA6 1\u2013${GHOST_SKILL_NAME_MAX_CHARS},\u5F97\u5230 ${JSON.stringify(itemRaw.name)}`
        };
      }
      if (typeof itemRaw.description !== "string" || itemRaw.description.trim().length === 0 || itemRaw.description.length > 1024) {
        return {
          ok: false,
          reason: "skill.items[].description \u5FC5\u987B\u662F 1\u20131024 \u5B57\u7B26\u7684\u975E\u7A7A\u5B57\u7B26\u4E32"
        };
      }
      const nameFold = itemRaw.name.toLowerCase();
      if (seenSkillNames.has(nameFold)) {
        return {
          ok: false,
          reason: `skill.items \u542B\u91CD\u590D name ${JSON.stringify(itemRaw.name)}`
        };
      }
      seenSkillNames.add(nameFold);
      const dirFold = itemRaw.dir.toLowerCase();
      if (seenSkillDirs.has(dirFold)) {
        return {
          ok: false,
          reason: `skill.items \u542B\u91CD\u590D dir ${JSON.stringify(itemRaw.dir)}`
        };
      }
      seenSkillDirs.add(dirFold);
      skillItems.push({
        ...unknownDeclarationFields(itemRaw, ["dir", "name", "description"]),
        dir: itemRaw.dir,
        name: itemRaw.name,
        description: itemRaw.description
      });
    }
    skill = { ...unknownDeclarationFields(skillRaw, ["items"]), items: skillItems };
  }
  if (slots.includes("skill") && skill === void 0) {
    return {
      ok: false,
      reason: 'slots \u58F0\u660E\u4E86 "skill" \u4F46\u7F3A\u5C11 skill \u8BE6\u5355(items \u6280\u80FD\u6E05\u5355\u5FC5\u586B)'
    };
  }
  let manual;
  if (raw.manual !== void 0) {
    if (!isPlainObject(raw.manual)) {
      return {
        ok: false,
        reason: 'manual \u5FC5\u987B\u662F\u5BF9\u8C61(\u5982 { "items": [{ "dir": "manual/getting-started", "name": "getting-started", "description": "..." }] })'
      };
    }
    const manualRaw = raw.manual;
    if (!Array.isArray(manualRaw.items) || manualRaw.items.length === 0) {
      return { ok: false, reason: "manual.items \u5FC5\u987B\u662F\u975E\u7A7A\u6570\u7EC4(\u968F\u5305\u624B\u518C\u7D22\u5F15)" };
    }
    if (manualRaw.items.length > GHOST_MANUAL_MAX_ITEMS) {
      return {
        ok: false,
        reason: `manual.items \u6700\u591A ${GHOST_MANUAL_MAX_ITEMS} \u6761`
      };
    }
    const manualItems = [];
    const seenManualNames = /* @__PURE__ */ new Set();
    const seenManualDirs = /* @__PURE__ */ new Set();
    for (const item of manualRaw.items) {
      if (!isPlainObject(item)) {
        return {
          ok: false,
          reason: "manual.items \u6BCF\u9879\u5FC5\u987B\u662F\u5BF9\u8C61({ dir, name, description })"
        };
      }
      const itemRaw = item;
      if (!isSafeGhostRelativePath(itemRaw.dir)) {
        return {
          ok: false,
          reason: `manual.items[].dir \u5FC5\u987B\u662F\u5305\u5185\u5B89\u5168\u76F8\u5BF9\u8DEF\u5F84(\u5982 "manual/getting-started"),\u5F97\u5230 ${JSON.stringify(itemRaw.dir)}`
        };
      }
      const dirFold = itemRaw.dir.toLowerCase();
      if (declaredFilePathFolds.some((path) => pathsConflict(dirFold, path))) {
        return {
          ok: false,
          reason: `manual.items[].dir ${JSON.stringify(itemRaw.dir)} \u4E0E\u63D2\u4EF6\u58F0\u660E\u6587\u4EF6\u8DEF\u5F84\u5927\u5C0F\u5199\u6298\u53E0\u540E\u51B2\u7A81`
        };
      }
      if (typeof itemRaw.name !== "string" || itemRaw.name.length > GHOST_SKILL_NAME_MAX_CHARS || !GHOST_SKILL_NAME_RE.test(itemRaw.name)) {
        return {
          ok: false,
          reason: `manual.items[].name \u5FC5\u987B\u662F\u5C0F\u5199\u5B57\u6BCD/\u6570\u5B57\u52A0\u5355\u8FDE\u5B57\u7B26\u5206\u6BB5(\u7981\u9996\u5C3E/\u8FDE\u7EED\u8FDE\u5B57\u7B26)\u3001\u957F\u5EA6 1\u2013${GHOST_SKILL_NAME_MAX_CHARS},\u5F97\u5230 ${JSON.stringify(itemRaw.name)}`
        };
      }
      if (typeof itemRaw.description !== "string" || itemRaw.description.trim().length === 0 || itemRaw.description.length > GHOST_MANUAL_DESCRIPTION_MAX_CHARS) {
        return {
          ok: false,
          reason: `manual.items[].description \u5FC5\u987B\u662F 1\u2013${GHOST_MANUAL_DESCRIPTION_MAX_CHARS} \u5B57\u7B26\u7684\u975E\u7A7A\u5B57\u7B26\u4E32`
        };
      }
      const nameFold = itemRaw.name.toLowerCase();
      if (seenManualNames.has(nameFold)) {
        return {
          ok: false,
          reason: `manual.items \u542B\u91CD\u590D name ${JSON.stringify(itemRaw.name)}`
        };
      }
      seenManualNames.add(nameFold);
      if (seenManualDirs.has(dirFold)) {
        return {
          ok: false,
          reason: `manual.items \u542B\u91CD\u590D dir ${JSON.stringify(itemRaw.dir)}`
        };
      }
      seenManualDirs.add(dirFold);
      manualItems.push({
        ...unknownDeclarationFields(itemRaw, ["dir", "name", "description"]),
        dir: itemRaw.dir,
        name: itemRaw.name,
        description: itemRaw.description
      });
    }
    manual = { ...unknownDeclarationFields(manualRaw, ["items"]), items: manualItems };
  }
  let setup;
  if (raw.setup !== void 0) {
    if (!isPlainObject(raw.setup)) {
      return {
        ok: false,
        reason: 'setup \u5FC5\u987B\u662F\u5BF9\u8C61(\u5982 { "requires": [{ "anyOf": ["secret:api_key"] }] })'
      };
    }
    const setupRaw = raw.setup;
    if (!Array.isArray(setupRaw.requires) || setupRaw.requires.length > GHOST_SETUP_MAX_GROUPS) {
      return {
        ok: false,
        reason: `setup.requires \u5FC5\u987B\u662F 0\u2013${GHOST_SETUP_MAX_GROUPS} \u7EC4\u7684\u6570\u7EC4(\u7A7A\u6570\u7EC4 = \u663E\u5F0F\u58F0\u660E\u65E0\u4F7F\u7528\u524D\u7F6E\u9700\u6C42)`
      };
    }
    const secretByKey = new Map([
      ...(network?.secrets ?? []).map(
        (secret) => [
          secret.key,
          {
            hostDerivedSource: secret.source === "login-email" || secret.source === "gh-cli" || secret.source === "oidc-token" ? secret.source : null
          }
        ]
      ),
      ...(node?.secretBindings ?? []).filter((secret) => !secret.oauthSecret).map(
        (secret) => [secret.key, { hostDerivedSource: null }]
      )
    ]);
    const connectionKeys = new Set((network?.connections ?? []).map((connection) => connection.key));
    const groups = [];
    for (const group of setupRaw.requires) {
      if (!isPlainObject(group) || !Array.isArray(group.anyOf) || group.anyOf.length === 0 || group.anyOf.length > GHOST_SETUP_MAX_ITEMS_PER_GROUP) {
        return {
          ok: false,
          reason: `setup.requires \u6BCF\u7EC4\u5FC5\u987B\u662F { "anyOf": [...] } \u4E14\u7EC4\u5185 1\u2013${GHOST_SETUP_MAX_ITEMS_PER_GROUP} \u6761`
        };
      }
      const items = [];
      const seenRefs = /* @__PURE__ */ new Set();
      for (const requirement of group.anyOf) {
        let item;
        if (typeof requirement === "string") {
          const match = /^(secret|connection):(.+)$/.exec(requirement);
          if (!match) {
            return {
              ok: false,
              reason: `setup \u6761\u76EE ${JSON.stringify(requirement)} \u5F62\u6001\u4E0D\u5BF9(\u5B57\u7B26\u4E32\u6761\u76EE\u987B\u4E3A "secret:<key>" \u6216 "connection:<key>";kv \u7528\u5BF9\u8C61 { "kv": "<key>", "label": "..." })`
            };
          }
          const [, kind, key] = match;
          if (kind === "secret") {
            const declaration = secretByKey.get(key);
            if (!declaration) {
              return {
                ok: false,
                reason: `setup \u5F15\u7528\u4E86\u672A\u58F0\u660E\u7684\u51ED\u8BC1 ${JSON.stringify(key)}(\u5FC5\u987B\u9010\u5B57\u53D6\u81EA network.secrets[].key \u6216 node.secretBindings[].key)`
              };
            }
            if (declaration.hostDerivedSource) {
              return {
                ok: false,
                reason: `setup \u4E0D\u5141\u8BB8\u5F15\u7528 ${declaration.hostDerivedSource} \u6E90\u51ED\u8BC1 ${JSON.stringify(key)}(Host \u6D3E\u751F\u8EAB\u4EFD\u6CA1\u6709\u7528\u6237\u914D\u7F6E\u52A8\u4F5C\u53EF\u5F15\u5BFC)`
              };
            }
            item = { kind: "secret", key };
          } else {
            if (!connectionKeys.has(key)) {
              return {
                ok: false,
                reason: `setup \u5F15\u7528\u4E86\u672A\u58F0\u660E\u7684\u8FDE\u63A5 ${JSON.stringify(key)}(\u5FC5\u987B\u9010\u5B57\u53D6\u81EA network.connections[].key)`
              };
            }
            item = { kind: "connection", key };
          }
        } else if (isPlainObject(requirement)) {
          if (typeof requirement.kv === "string" && isGhostManifestReservedRecordKey(requirement.kv)) {
            return {
              ok: false,
              reason: `setup kv \u6761\u76EE\u7684 kv \u4E0D\u5141\u8BB8\u4F7F\u7528\u5BF9\u8C61\u4FDD\u7559\u952E\u540D ${JSON.stringify(requirement.kv)}`
            };
          }
          if (typeof requirement.kv !== "string" || !GHOST_SETUP_KV_KEY_RE.test(requirement.kv)) {
            return {
              ok: false,
              reason: "setup kv \u6761\u76EE\u7684 kv \u5FC5\u987B\u662F 1\u201364 \u4F4D\u5B57\u6BCD/\u6570\u5B57/\u4E0B\u5212\u7EBF/\u70B9/\u8FDE\u5B57\u7B26\u7684\u952E\u540D"
            };
          }
          if (typeof requirement.label !== "string" || requirement.label.trim().length === 0 || requirement.label.length > 64) {
            return {
              ok: false,
              reason: "setup kv \u6761\u76EE\u5FC5\u987B\u5E26 1\u201364 \u5B57\u7B26\u7684 label(kv \u952E\u540D\u5BBF\u4E3B\u65E0\u5148\u9A8C,\u5F39\u7A97\u8981\u6709\u540D\u5B57\u53EF\u5C55\u793A)"
            };
          }
          if (raw.settingsHtml === void 0) {
            return {
              ok: false,
              reason: "setup \u5F15\u7528\u4E86 kv \u53C2\u6570\u4F46\u6CA1\u6709 settingsHtml\u2014\u2014\u53C2\u6570\u7531\u610F\u8BC6\u8BBE\u7F6E\u754C\u9762\u6536\u5355,\u6CA1\u6709\u754C\u9762\u5C31\u6CA1\u4EBA\u586B"
            };
          }
          item = { kind: "kv", key: requirement.kv, label: requirement.label };
        } else {
          return {
            ok: false,
            reason: 'setup.requires[].anyOf \u6BCF\u6761\u5FC5\u987B\u662F\u5B57\u7B26\u4E32\u5F15\u7528\u6216 { "kv", "label" } \u5BF9\u8C61'
          };
        }
        const ref = `${item.kind}:${item.key}`;
        if (seenRefs.has(ref)) {
          return { ok: false, reason: `setup \u540C\u7EC4\u5185\u542B\u91CD\u590D\u6761\u76EE ${JSON.stringify(ref)}` };
        }
        seenRefs.add(ref);
        items.push(item);
      }
      groups.push({ anyOf: items });
    }
    setup = { requires: groups };
  }
  if (raw.command !== void 0) {
    if (typeof raw.command !== "string" || raw.command.length === 0 || raw.command.length > 32 || /[\s/]/.test(raw.command)) {
      return {
        ok: false,
        reason: 'command \u5FC5\u987B\u662F 1\u201332 \u5B57\u7B26\u3001\u4E0D\u542B\u7A7A\u767D\u4E0E "/" \u7684\u5B57\u7B26\u4E32'
      };
    }
    if (tools === void 0) {
      return {
        ok: false,
        reason: "\u58F0\u660E\u4E86 command \u4F46\u6CA1\u6709 tools\u2014\u2014\u6CA1\u6709\u5DE5\u5177\u7684\u6307\u4EE4\u65E0\u4E8B\u53EF\u505A"
      };
    }
  }
  let keywords;
  if (raw.keywords !== void 0) {
    if (!Array.isArray(raw.keywords) || raw.keywords.length === 0 || raw.keywords.length > 8) {
      return { ok: false, reason: "keywords \u5FC5\u987B\u662F 1\u20138 \u9879\u7684\u6570\u7EC4" };
    }
    if (tools === void 0) {
      return {
        ok: false,
        reason: "\u58F0\u660E\u4E86 keywords \u4F46\u6CA1\u6709 tools\u2014\u2014\u6CA1\u6709\u5DE5\u5177\u7684\u89E6\u53D1\u8BCD\u65E0\u4E8B\u53EF\u505A"
      };
    }
    const seen = /* @__PURE__ */ new Set();
    keywords = [];
    for (const k of raw.keywords) {
      if (typeof k !== "string") return { ok: false, reason: "keywords \u6BCF\u9879\u5FC5\u987B\u662F\u5B57\u7B26\u4E32" };
      const word = k.trim();
      if (word.length < 2 || word.length > 24) {
        return {
          ok: false,
          reason: `keywords \u6BCF\u9879\u987B\u4E3A 2\u201324 \u5B57\u7B26(\u5355\u5B57\u8BCD\u547D\u4E2D\u9762\u5931\u63A7):${JSON.stringify(k)}`
        };
      }
      const fold = word.toLowerCase();
      if (seen.has(fold)) continue;
      seen.add(fold);
      keywords.push(word);
    }
  }
  return {
    ok: true,
    manifest: {
      ...prepared.unknownV3Fields,
      schemaVersion: prepared.schemaVersion,
      id: raw.id,
      name: raw.name,
      version: raw.version,
      ...raw.minCindyVersion !== void 0 ? { minCindyVersion: raw.minCindyVersion } : {},
      kind: "chip",
      ...raw.author !== void 0 ? { author: raw.author } : {},
      ...locales !== void 0 ? { locales } : {},
      ...raw.description !== void 0 ? { description: raw.description } : {},
      ...raw.whenToUse !== void 0 ? { whenToUse: raw.whenToUse } : {},
      ...raw.icon !== void 0 ? { icon: raw.icon } : {},
      entry: raw.entry,
      ...raw.launch !== void 0 ? { launch: raw.launch } : {},
      ...agent !== void 0 || prepared.v3BaseAgent ? { agent: agent ?? {} } : {},
      ...node !== void 0 ? { node } : {},
      ...raw.settingsHtml !== void 0 ? { settingsHtml: raw.settingsHtml } : {},
      ...raw.settingsHeight !== void 0 ? { settingsHeight: raw.settingsHeight } : {},
      ...prepared.schemaVersion === 2 ? { slots } : {},
      ...card !== void 0 || prepared.v3BaseCard || prepared.schemaVersion === 3 && slots.includes("card") ? { card: card ?? {} } : {},
      ...tools !== void 0 ? { tools } : {},
      ...cindy !== void 0 ? { cindy } : {},
      ...subscribe !== void 0 ? { subscribe } : {},
      ...routineEvents !== void 0 ? { routineEvents } : {},
      ...network !== void 0 ? { network } : {},
      ...raw.command !== void 0 ? { command: raw.command } : {},
      ...keywords !== void 0 ? { keywords } : {},
      ...panel !== void 0 ? { panel } : {},
      ...mainView !== void 0 ? { mainView } : {},
      ...preview !== void 0 ? { preview } : {},
      ...skill !== void 0 ? { skill } : {},
      ...prepared.schemaVersion === 3 && slots.includes("notify") ? { notify: true } : {},
      ...prepared.schemaVersion === 3 && slots.includes("badge") ? { badge: true } : {},
      ...prepared.schemaVersion === 3 && slots.includes("confirm") ? { confirm: true } : {},
      ...prepared.schemaVersion === 3 && slots.includes("fs") ? { fs: true } : {},
      ...prepared.schemaVersion === 3 && slots.includes("library") ? { library: true } : {},
      ...prepared.schemaVersion === 3 && slots.includes("session-context") ? { sessionContext: true } : {},
      ...prepared.schemaVersion === 3 && slots.includes("pick") ? { pick: true } : {},
      ...prepared.schemaVersion === 3 && slots.includes("workspace") ? { workspace: true } : {},
      ...prepared.schemaVersion === 3 && slots.includes("ios-simulator") ? { iosSimulator: true } : {},
      ...manual !== void 0 ? { manual } : {},
      ...setup !== void 0 ? { setup } : {}
    }
  };
}
export {
  CINDY_FILE_EXT,
  GHOST_CINDY_EMBED_ACTIONS,
  GHOST_CINDY_MEDIA_ACTIONS,
  GHOST_CINDY_SEARCH_ACTIONS,
  GHOST_CINDY_TEXT_ACTIONS,
  GHOST_LAUNCH_MODES,
  GHOST_LOCALES,
  GHOST_LOCALE_MAX_BYTES,
  GHOST_MAIN_VIEW_ICONS,
  GHOST_MANIFEST_FILE,
  GHOST_MANIFEST_SCHEMA_VERSION,
  GHOST_MANIFEST_SUMMARY_MAX_CHARS,
  GHOST_MANUAL_DESCRIPTION_MAX_CHARS,
  GHOST_MANUAL_ENTRY_FILE,
  GHOST_MANUAL_MAX_ITEMS,
  GHOST_MANUAL_MD_MAX_BYTES,
  GHOST_MODEL_IMAGE_ACTIONS,
  GHOST_MODEL_VIDEO_ACTIONS,
  GHOST_NETWORK_FORBIDDEN_INJECT_HEADERS,
  GHOST_NETWORK_MAX_CONNECTIONS_PER_DECL,
  GHOST_NETWORK_MAX_CONNECTION_DECLS,
  GHOST_NETWORK_MAX_HOSTS,
  GHOST_NETWORK_MAX_SECRETS,
  GHOST_NODE_LIFECYCLES,
  GHOST_NODE_MAX_EXTRA_ENTRIES,
  GHOST_NODE_MAX_SECRET_BINDINGS,
  GHOST_NODE_MAX_SECRET_METHODS,
  GHOST_NODE_PROTOCOLS,
  GHOST_OAUTH_BOUNCE_PATH_RE,
  GHOST_OAUTH_CLIENT_ID_ALTERNATIVES_MAX,
  GHOST_OAUTH_EXTRA_PARAMS_MAX,
  GHOST_OAUTH_IDENTITY_TEMPLATE_MAX_CHARS,
  GHOST_OAUTH_IDENTITY_TEMPLATE_PLACEHOLDER_RE,
  GHOST_OAUTH_RESERVED_AUTHORIZE_PARAMS,
  GHOST_OAUTH_SCOPES_MAX,
  GHOST_OAUTH_TOKEN_BROKER_RE,
  GHOST_PANEL_POSITIONS,
  GHOST_PREVIEW_LOOPBACK_HOSTS,
  GHOST_PREVIEW_MAX_HOSTS,
  GHOST_SECRET_EXCHANGE_BODY_MAX_CHARS,
  GHOST_SECRET_EXCHANGE_CONTENT_TYPES,
  GHOST_SECRET_EXCHANGE_TOKEN_PATH_RE,
  GHOST_SECRET_EXCHANGE_TTL_DEFAULT_S,
  GHOST_SECRET_EXCHANGE_TTL_MAX_S,
  GHOST_SECRET_EXCHANGE_TTL_MIN_S,
  GHOST_SECRET_SOURCES,
  GHOST_SETUP_KV_KEY_RE,
  GHOST_SETUP_MAX_GROUPS,
  GHOST_SETUP_MAX_ITEMS_PER_GROUP,
  GHOST_SKILL_MAX_ITEMS,
  GHOST_SKILL_MD_MAX_BYTES,
  GHOST_SKILL_NAME_MAX_CHARS,
  GHOST_SKILL_NAME_RE,
  GHOST_SUBSCRIBE_HOOKS,
  GHOST_SUBSCRIBE_TOPICS,
  LEGACY_GHOST_SLOTS,
  compareCindyVersions,
  ghostIconMimeType,
  ghostManifestUsesOidcToken,
  isGhostNodeMcpReservedMethod,
  isSafeGhostRelativePath,
  isValidCindyVersion,
  isValidGhostId,
  isValidGhostNetworkHostPattern,
  isVersionlessCindyVersion,
  supportsCindyVersion,
  validateGhostManifest
};
