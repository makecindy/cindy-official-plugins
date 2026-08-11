// Generated from makecindy/cindy-protocol@dbbf1697037c6025541ab4bae38f906982628423
// packages/plugin-protocol/src/manifest.ts. Do not edit this snapshot by hand.
// Licensed under Apache-2.0; see .tests/contracts/NOTICE.
export const GHOST_MANIFEST_FILE = 'ghost.json';
export const CINDY_FILE_EXT = '.cindy';
export const GHOST_MANIFEST_SCHEMA_VERSION = 2;
export const GHOST_MANIFEST_SUMMARY_MAX_CHARS = 300;
export const GHOST_LOCALES = ['zh-CN', 'en', 'ja', 'ko'];
export const GHOST_LOCALE_MAX_BYTES = 64 * 1024;
const GHOST_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const WINDOWS_RESERVED_NAME_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
function isWindowsReservedName(name) {
    return WINDOWS_RESERVED_NAME_RE.test(name);
}
export const GHOST_SLOTS = [
    'subscribe',
    'tool',
    'card',
    'panel',
    'cindy',
    'agent',
    'node',
    'network',
    'notify',
    'fs',
    'session-context',
    'pick',
    'preview',
    'skill',
    'workspace',
    'ios-simulator',
];
export const GHOST_LAUNCH_MODES = ['on-demand', 'resident'];
export const GHOST_PANEL_POSITIONS = ['left', 'right', 'tab'];
export const GHOST_NODE_PROTOCOLS = ['json-rpc-stdio', 'mcp-stdio'];
export const GHOST_NODE_LIFECYCLES = ['on-demand', 'resident'];
export const GHOST_NODE_MAX_SECRET_BINDINGS = 4;
export const GHOST_NODE_MAX_SECRET_METHODS = 16;
const GHOST_NODE_MCP_RESERVED_METHODS = new Set(['initialize', 'notifications/initialized']);
export function isGhostNodeMcpReservedMethod(method) {
    return GHOST_NODE_MCP_RESERVED_METHODS.has(method);
}
export const GHOST_NODE_MAX_EXTRA_ENTRIES = 4;
export const GHOST_MODEL_IMAGE_ACTIONS = ['generate', 'edit'];
export const GHOST_MODEL_VIDEO_ACTIONS = ['generate', 'edit'];
export const GHOST_CINDY_MEDIA_ACTIONS = ['deposit'];
export const GHOST_CINDY_TEXT_ACTIONS = ['oneshot'];
export const GHOST_CINDY_EMBED_ACTIONS = ['text'];
export const GHOST_CINDY_SEARCH_ACTIONS = ['web'];
export const GHOST_SUBSCRIBE_TOPICS = ['turn', 'session'];
export const GHOST_SUBSCRIBE_HOOKS = ['will-user-message', 'will-assistant-message'];
export const GHOST_NETWORK_MAX_HOSTS = 8;
export const GHOST_NETWORK_MAX_SECRETS = 4;
export const GHOST_NETWORK_MAX_CONNECTION_DECLS = 2;
export const GHOST_NETWORK_MAX_CONNECTIONS_PER_DECL = 8;
const GHOST_NETWORK_LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
export function isValidGhostNetworkHostPattern(p) {
    if (typeof p !== 'string' || p.length === 0 || p.length > 253)
        return false;
    const bare = p.startsWith('*.') ? p.slice(2) : p;
    const labels = bare.split('.');
    if (labels.length < 2)
        return false;
    if (labels.every((l) => /^\d+$/.test(l)))
        return false;
    return labels.every((l) => GHOST_NETWORK_LABEL_RE.test(l));
}
function ghostNetworkHostMatches(pattern, hostname) {
    if (pattern.startsWith('*.'))
        return hostname.endsWith(pattern.slice(1)) && hostname.length > pattern.length - 1;
    return hostname === pattern;
}
export const GHOST_SECRET_EXCHANGE_CONTENT_TYPES = [
    'application/json',
    'application/x-www-form-urlencoded',
];
export const GHOST_SECRET_EXCHANGE_BODY_MAX_CHARS = 2048;
export const GHOST_SECRET_EXCHANGE_TTL_DEFAULT_S = 3600;
export const GHOST_SECRET_EXCHANGE_TTL_MIN_S = 60;
export const GHOST_SECRET_EXCHANGE_TTL_MAX_S = 30 * 24 * 3600;
export const GHOST_SECRET_EXCHANGE_TOKEN_PATH_RE = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;
export const GHOST_OAUTH_IDENTITY_TEMPLATE_PLACEHOLDER_RE = /\{([^{}]*)\}/g;
export const GHOST_OAUTH_IDENTITY_TEMPLATE_MAX_CHARS = 200;
export const GHOST_OAUTH_SCOPES_MAX = 256;
export const GHOST_OAUTH_EXTRA_PARAMS_MAX = 8;
export const GHOST_OAUTH_RESERVED_AUTHORIZE_PARAMS = [
    'response_type',
    'client_id',
    'redirect_uri',
    'state',
    'scope',
    'code_challenge',
    'code_challenge_method',
];
export const GHOST_OAUTH_TOKEN_BROKER_RE = /^[a-z][a-z0-9_-]{0,31}$/;
export const GHOST_OAUTH_BOUNCE_PATH_RE = /^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;
export const GHOST_SECRET_SOURCES = [
    'user',
    'login-email',
    'oauth',
    'login-feishu-token',
    'oidc-token',
    'gh-cli',
];
export const GHOST_NETWORK_FORBIDDEN_INJECT_HEADERS = [
    'host',
    'content-length',
    'transfer-encoding',
    'connection',
    'cookie',
    'origin',
    'referer',
    'content-type',
];
export const GHOST_PREVIEW_MAX_HOSTS = 4;
export const GHOST_PREVIEW_LOOPBACK_HOSTS = new Set([
    'localhost',
    '127.0.0.1',
    '[::1]',
]);
export const GHOST_SKILL_MAX_ITEMS = 4;
export const GHOST_SKILL_MD_MAX_BYTES = 64 * 1024;
export const GHOST_SKILL_NAME_MAX_CHARS = 64;
export const GHOST_SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const GHOST_MANUAL_MAX_ITEMS = 8;
export const GHOST_MANUAL_ENTRY_FILE = 'MANUAL.md';
export const GHOST_MANUAL_MD_MAX_BYTES = 64 * 1024;
export const GHOST_MANUAL_DESCRIPTION_MAX_CHARS = GHOST_MANIFEST_SUMMARY_MAX_CHARS;
export function ghostManifestUsesOidcToken(manifest) {
    return manifest.network?.secrets?.some((secret) => secret.source === 'oidc-token') ?? false;
}
export function isValidGhostId(id) {
    return typeof id === 'string' && GHOST_ID_RE.test(id) && !isWindowsReservedName(id);
}
const GHOST_ICON_MIME_BY_EXT = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
};
export function ghostIconMimeType(p) {
    const dot = p.lastIndexOf('.');
    if (dot < 0)
        return null;
    return GHOST_ICON_MIME_BY_EXT[p.slice(dot).toLowerCase()] ?? null;
}
const GHOST_PATH_SEGMENT_RE = /^[a-zA-Z0-9_][a-zA-Z0-9._-]{0,63}$/;
export function isSafeGhostRelativePath(p) {
    if (typeof p !== 'string' || p.length === 0 || p.length > 256)
        return false;
    if (p.includes('\\'))
        return false;
    const segments = p.split('/');
    return segments.every((seg) => GHOST_PATH_SEGMENT_RE.test(seg) && seg !== '.' && seg !== '..' && !isWindowsReservedName(seg));
}
function compareNumericIdentifiers(left, right) {
    if (left.length !== right.length)
        return left.length < right.length ? -1 : 1;
    if (left === right)
        return 0;
    return left < right ? -1 : 1;
}
function parseCindyVersion(value) {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value);
    if (!match)
        return null;
    const core = [match[1], match[2], match[3]];
    const prerelease = [];
    for (const part of match[4]?.split('.') ?? []) {
        const numeric = /^\d+$/.test(part);
        if (numeric && !/^(0|[1-9]\d*)$/.test(part))
            return null;
        prerelease.push({ numeric, value: part });
    }
    return { core, prerelease };
}
export function isValidCindyVersion(value) {
    return typeof value === 'string' && value.length <= 32 && parseCindyVersion(value) !== null;
}
export function isVersionlessCindyVersion(value) {
    return value === '0.0.0' || value.startsWith('0.0.0-');
}
export function compareCindyVersions(leftValue, rightValue) {
    const left = parseCindyVersion(leftValue);
    const right = parseCindyVersion(rightValue);
    if (!left || !right)
        return null;
    for (let index = 0; index < 3; index += 1) {
        const coreComparison = compareNumericIdentifiers(left.core[index], right.core[index]);
        if (coreComparison !== 0)
            return coreComparison;
    }
    if (left.prerelease.length === 0 || right.prerelease.length === 0) {
        if (left.prerelease.length === right.prerelease.length)
            return 0;
        return left.prerelease.length === 0 ? 1 : -1;
    }
    const length = Math.max(left.prerelease.length, right.prerelease.length);
    for (let index = 0; index < length; index += 1) {
        const leftPart = left.prerelease[index];
        const rightPart = right.prerelease[index];
        if (leftPart === undefined || rightPart === undefined) {
            return leftPart === undefined ? -1 : 1;
        }
        if (leftPart.numeric !== rightPart.numeric)
            return leftPart.numeric ? -1 : 1;
        const partComparison = leftPart.numeric
            ? compareNumericIdentifiers(leftPart.value, rightPart.value)
            : leftPart.value === rightPart.value
                ? 0
                : leftPart.value < rightPart.value
                    ? -1
                    : 1;
        if (partComparison !== 0)
            return partComparison;
    }
    return 0;
}
export function supportsCindyVersion(currentVersion, minCindyVersion) {
    if (minCindyVersion === undefined)
        return true;
    if (!isValidCindyVersion(currentVersion) || !isValidCindyVersion(minCindyVersion))
        return false;
    if (isVersionlessCindyVersion(currentVersion))
        return true;
    const comparison = compareCindyVersions(currentVersion, minCindyVersion);
    return comparison !== null && comparison >= 0;
}
function isPlainObject(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export function validateGhostManifest(raw) {
    if (!isPlainObject(raw))
        return { ok: false, reason: '清单不是对象' };
    if (raw.schemaVersion !== GHOST_MANIFEST_SCHEMA_VERSION) {
        return {
            ok: false,
            reason: `schemaVersion 必须是 ${GHOST_MANIFEST_SCHEMA_VERSION},得到 ${JSON.stringify(raw.schemaVersion)}(v1 声明型已于 2026-07-12 移除)`,
        };
    }
    if (!isValidGhostId(raw.id)) {
        return {
            ok: false,
            reason: 'id 必须是 1–32 位小写字母/数字/连字符(不能以连字符开头或使用 Windows 设备保留名)',
        };
    }
    if (typeof raw.name !== 'string' || raw.name.trim().length === 0 || raw.name.length > 64) {
        return { ok: false, reason: 'name 必须是 1–64 字符的非空字符串' };
    }
    if (typeof raw.version !== 'string' ||
        raw.version.trim().length === 0 ||
        raw.version.length > 32) {
        return { ok: false, reason: 'version 必须是 1–32 字符的非空字符串' };
    }
    if (raw.minCindyVersion !== undefined &&
        (typeof raw.minCindyVersion !== 'string' || !isValidCindyVersion(raw.minCindyVersion))) {
        return { ok: false, reason: 'minCindyVersion 必须是合法的 SemVer 字符串' };
    }
    if (raw.kind !== undefined && raw.kind !== 'chip') {
        return {
            ok: false,
            reason: `kind 必须是 "chip" 或省略(缺省即 chip),得到 ${JSON.stringify(raw.kind)}(意识只有芯片一种形态,declaration 已移除)`,
        };
    }
    if (raw.author !== undefined &&
        (typeof raw.author !== 'string' || raw.author.trim().length === 0 || raw.author.length > 64)) {
        return { ok: false, reason: 'author 必须是 1–64 字符的非空字符串' };
    }
    const declaredFilePathFolds = [
        GHOST_MANIFEST_FILE,
        raw.entry,
        raw.icon,
        raw.settingsHtml,
        isPlainObject(raw.panel) ? raw.panel.html : undefined,
        isPlainObject(raw.node) ? raw.node.entry : undefined,
        ...(isPlainObject(raw.node) && Array.isArray(raw.node.entries) ? raw.node.entries : []),
    ]
        .filter((value) => typeof value === 'string')
        .map((value) => value.toLowerCase());
    const isSameOrDescendant = (path, ancestor) => path === ancestor || path.startsWith(`${ancestor}/`);
    const pathsConflict = (left, right) => isSameOrDescendant(left, right) || isSameOrDescendant(right, left);
    let locales;
    if (raw.locales !== undefined) {
        if (!isPlainObject(raw.locales)) {
            return { ok: false, reason: 'locales 必须是语言到 locale JSON 路径的对象' };
        }
        const unknownLocale = Object.keys(raw.locales).find((locale) => !GHOST_LOCALES.includes(locale));
        if (unknownLocale) {
            return {
                ok: false,
                reason: `locales 含宿主不支持的语言 ${JSON.stringify(unknownLocale)}(可用:${GHOST_LOCALES.join(' / ')})`,
            };
        }
        if (raw.locales.en === undefined) {
            return { ok: false, reason: 'locales 必须提供 en，作为所有不支持语言的固定回退' };
        }
        const normalized = {};
        const seenPaths = [];
        const skillDirFolds = (isPlainObject(raw.skill) && Array.isArray(raw.skill.items) ? raw.skill.items : [])
            .map((item) => (isPlainObject(item) ? item.dir : undefined))
            .filter((value) => typeof value === 'string')
            .map((value) => value.toLowerCase());
        const manualDirFolds = (isPlainObject(raw.manual) && Array.isArray(raw.manual.items) ? raw.manual.items : [])
            .map((item) => (isPlainObject(item) ? item.dir : undefined))
            .filter((value) => typeof value === 'string')
            .map((value) => value.toLowerCase());
        for (const locale of GHOST_LOCALES) {
            const localePath = raw.locales[locale];
            if (localePath === undefined)
                continue;
            if (typeof localePath !== 'string' ||
                !isSafeGhostRelativePath(localePath) ||
                !localePath.toLowerCase().endsWith('.json')) {
                return {
                    ok: false,
                    reason: `locales.${locale} 必须是安装目录内以 .json 结尾的安全相对路径`,
                };
            }
            const normalizedLocalePath = localePath.toLowerCase();
            const conflictsWithFile = declaredFilePathFolds.some((path) => pathsConflict(path, normalizedLocalePath));
            const conflictsWithSkillDir = skillDirFolds.some((dir) => isSameOrDescendant(dir, normalizedLocalePath));
            const conflictsWithManualDir = manualDirFolds.some((dir) => pathsConflict(dir, normalizedLocalePath));
            if (conflictsWithFile || conflictsWithSkillDir || conflictsWithManualDir) {
                return {
                    ok: false,
                    reason: `locales.${locale} 路径 ${JSON.stringify(localePath)} 与插件其他声明文件大小写折叠后冲突`,
                };
            }
            if (seenPaths.includes(normalizedLocalePath)) {
                return { ok: false, reason: `locales 含重复路径 ${JSON.stringify(localePath)}` };
            }
            if (seenPaths.some((path) => isSameOrDescendant(path, normalizedLocalePath) ||
                isSameOrDescendant(normalizedLocalePath, path))) {
                return {
                    ok: false,
                    reason: `locales.${locale} 路径 ${JSON.stringify(localePath)} 与其他 locale 文件存在祖先路径冲突`,
                };
            }
            seenPaths.push(normalizedLocalePath);
            normalized[locale] = localePath;
        }
        locales = {
            ...normalized,
            en: normalized.en,
        };
    }
    if (raw.description !== undefined &&
        (typeof raw.description !== 'string' ||
            raw.description.trim().length === 0 ||
            raw.description.length > GHOST_MANIFEST_SUMMARY_MAX_CHARS)) {
        return {
            ok: false,
            reason: `description 必须是 1–${GHOST_MANIFEST_SUMMARY_MAX_CHARS} 字符的非空字符串`,
        };
    }
    if (raw.whenToUse !== undefined &&
        (typeof raw.whenToUse !== 'string' ||
            raw.whenToUse.trim().length === 0 ||
            raw.whenToUse.length > GHOST_MANIFEST_SUMMARY_MAX_CHARS)) {
        return {
            ok: false,
            reason: `whenToUse 必须是 1–${GHOST_MANIFEST_SUMMARY_MAX_CHARS} 字符的非空字符串`,
        };
    }
    if (raw.icon !== undefined) {
        if (!isSafeGhostRelativePath(raw.icon)) {
            return { ok: false, reason: 'icon 必须是安装目录内的安全相对路径' };
        }
        if (ghostIconMimeType(raw.icon) === null) {
            return {
                ok: false,
                reason: `icon 扩展名不受支持(可用:${Object.keys(GHOST_ICON_MIME_BY_EXT).join(' / ')})`,
            };
        }
    }
    let panel;
    if (raw.panel !== undefined) {
        const p = raw.panel;
        if (!isPlainObject(p))
            return { ok: false, reason: 'panel 必须是对象' };
        if (p.title !== undefined &&
            (typeof p.title !== 'string' || p.title.length === 0 || p.title.length > 64)) {
            return { ok: false, reason: 'panel.title 必须是 1–64 字符的字符串' };
        }
        if (!isSafeGhostRelativePath(p.html)) {
            return { ok: false, reason: 'panel.html 必填,且必须是安装目录内的安全相对路径' };
        }
        if (p.minWidth !== undefined &&
            (typeof p.minWidth !== 'number' ||
                !Number.isFinite(p.minWidth) ||
                p.minWidth < 120 ||
                p.minWidth > 1200)) {
            return { ok: false, reason: 'panel.minWidth 必须是 120–1200 之间的数字' };
        }
        if (p.defaultFraction !== undefined &&
            (typeof p.defaultFraction !== 'number' ||
                !Number.isFinite(p.defaultFraction) ||
                p.defaultFraction < 0.05 ||
                p.defaultFraction > 0.8)) {
            return { ok: false, reason: 'panel.defaultFraction 必须是 0.05–0.8 之间的数字' };
        }
        if (p.position !== undefined) {
            if (p.position === 'top' || p.position === 'bottom') {
                return {
                    ok: false,
                    reason: 'panel.position 的 top / bottom 暂未支持(排期中),当前可用:left / right / tab',
                };
            }
            if (!GHOST_PANEL_POSITIONS.includes(p.position)) {
                return { ok: false, reason: `panel.position 必须是 ${GHOST_PANEL_POSITIONS.join(' / ')}` };
            }
            if (p.position === 'tab' && (p.minWidth !== undefined || p.defaultFraction !== undefined)) {
                return {
                    ok: false,
                    reason: "panel.minWidth / panel.defaultFraction 仅停靠形态(left / right)有效,position:'tab' 时请移除",
                };
            }
        }
        panel = {
            ...(p.title !== undefined ? { title: p.title } : {}),
            ...(p.position !== undefined ? { position: p.position } : {}),
            html: p.html,
            ...(p.minWidth !== undefined ? { minWidth: p.minWidth } : {}),
            ...(p.defaultFraction !== undefined ? { defaultFraction: p.defaultFraction } : {}),
        };
    }
    if (!isSafeGhostRelativePath(raw.entry)) {
        return { ok: false, reason: '必须提供 entry(安装目录内的安全相对路径,电子脑逻辑入口)' };
    }
    if (raw.launch !== undefined &&
        !GHOST_LAUNCH_MODES.includes(raw.launch)) {
        return { ok: false, reason: `launch 必须是 ${GHOST_LAUNCH_MODES.join(' / ')}` };
    }
    if (raw.settingsHtml !== undefined && !isSafeGhostRelativePath(raw.settingsHtml)) {
        return { ok: false, reason: 'settingsHtml 必须是安装目录内的安全相对路径' };
    }
    if (raw.settingsHeight !== undefined) {
        if (raw.settingsHtml === undefined) {
            return {
                ok: false,
                reason: '声明了 settingsHeight 但没有 settingsHtml——没有界面就没有高度可言',
            };
        }
        if (typeof raw.settingsHeight !== 'number' ||
            !Number.isFinite(raw.settingsHeight) ||
            raw.settingsHeight < 160 ||
            raw.settingsHeight > 800) {
            return { ok: false, reason: 'settingsHeight 必须是 160–800 之间的数字' };
        }
    }
    if (!Array.isArray(raw.slots) || raw.slots.length === 0) {
        return { ok: false, reason: '必须声明 slots(非空数组,能力白名单)' };
    }
    const slots = [];
    for (const s of raw.slots) {
        const name = s === 'model' ? 'cindy' : s;
        if (typeof name !== 'string' || !GHOST_SLOTS.includes(name)) {
            return {
                ok: false,
                reason: `slots 含未知卡槽 ${JSON.stringify(s)}(可用:${GHOST_SLOTS.join(' / ')})`,
            };
        }
        if (slots.includes(name)) {
            return { ok: false, reason: `slots 含重复卡槽 ${JSON.stringify(s)}` };
        }
        slots.push(name);
    }
    if (slots.includes('ios-simulator') && raw.minCindyVersion === undefined) {
        return {
            ok: false,
            reason: 'slots 声明了 "ios-simulator" 时必须同时声明 minCindyVersion',
        };
    }
    if (panel !== undefined && !slots.includes('panel')) {
        return { ok: false, reason: '声明了 panel 但 slots 未包含 "panel"' };
    }
    if (slots.includes('panel') && panel === undefined) {
        return { ok: false, reason: 'slots 声明了 "panel" 但缺少 panel(面板由意识自绘,html 必填)' };
    }
    let card;
    if (raw.card !== undefined) {
        if (!isPlainObject(raw.card)) {
            return { ok: false, reason: 'card 能力详单必须是对象(如 { "externalLinks": true })' };
        }
        if (!slots.includes('card')) {
            return { ok: false, reason: '声明了 card 能力详单但 slots 未包含 "card"' };
        }
        const cardRaw = raw.card;
        const unknownCardField = Object.keys(cardRaw).find((key) => key !== 'externalLinks');
        if (unknownCardField) {
            return { ok: false, reason: `card 含不允许的字段 ${JSON.stringify(unknownCardField)}` };
        }
        if (cardRaw.externalLinks !== undefined && typeof cardRaw.externalLinks !== 'boolean') {
            return { ok: false, reason: 'card.externalLinks 必须是布尔值' };
        }
        if (cardRaw.externalLinks === true) {
            card = { externalLinks: true };
        }
    }
    let tools;
    if (raw.tools !== undefined) {
        if (!Array.isArray(raw.tools) || raw.tools.length === 0 || raw.tools.length > 16) {
            return { ok: false, reason: 'tools 必须是 1–16 项的数组' };
        }
        tools = [];
        const seenNames = new Set();
        for (const t of raw.tools) {
            if (!isPlainObject(t))
                return { ok: false, reason: 'tools 每项必须是对象' };
            if (typeof t.name !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(t.name)) {
                return {
                    ok: false,
                    reason: 'tools[].name 必须是小写字母开头的 1–64 位小写/数字/下划线/连字符',
                };
            }
            if (seenNames.has(t.name))
                return { ok: false, reason: `tools 含重名工具 ${JSON.stringify(t.name)}` };
            seenNames.add(t.name);
            if (typeof t.description !== 'string' ||
                t.description.trim().length === 0 ||
                t.description.length > 1024) {
                return { ok: false, reason: 'tools[].description 必须是 1–1024 字符的非空字符串' };
            }
            if (t.parameters !== undefined) {
                if (!isPlainObject(t.parameters))
                    return { ok: false, reason: 'tools[].parameters 必须是对象(JSON Schema)' };
                try {
                    if (JSON.stringify(t.parameters).length > 16_384) {
                        return { ok: false, reason: 'tools[].parameters 过大(上限 16KB)' };
                    }
                }
                catch {
                    return { ok: false, reason: 'tools[].parameters 必须可序列化' };
                }
            }
            tools.push({
                name: t.name,
                description: t.description,
                ...(t.parameters !== undefined
                    ? { parameters: t.parameters }
                    : {}),
            });
        }
    }
    if (tools !== undefined && !slots.includes('tool')) {
        return { ok: false, reason: '声明了 tools 但 slots 未包含 "tool"' };
    }
    if (slots.includes('tool') && tools === undefined) {
        return { ok: false, reason: 'slots 声明了 "tool" 但缺少 tools(注册什么工具要写清楚)' };
    }
    const cindyRaw = raw.cindy !== undefined ? raw.cindy : raw.model;
    let cindy;
    if (cindyRaw !== undefined) {
        if (!isPlainObject(cindyRaw)) {
            return { ok: false, reason: 'cindy 能力详单必须是对象(如 { "image": ["generate"] })' };
        }
        if (!slots.includes('cindy')) {
            return { ok: false, reason: '声明了 cindy 能力详单但 slots 未包含 "cindy"' };
        }
        cindy = {};
        const actionTable = {
            image: GHOST_MODEL_IMAGE_ACTIONS,
            video: GHOST_MODEL_VIDEO_ACTIONS,
            media: GHOST_CINDY_MEDIA_ACTIONS,
            text: GHOST_CINDY_TEXT_ACTIONS,
            embed: GHOST_CINDY_EMBED_ACTIONS,
            search: GHOST_CINDY_SEARCH_ACTIONS,
        };
        for (const [category, actionsRaw] of Object.entries(cindyRaw)) {
            if (category === 'oneshotModel')
                continue;
            const allowed = actionTable[category];
            if (!allowed) {
                return {
                    ok: false,
                    reason: `cindy 含未知能力类目 ${JSON.stringify(category)}(当前支持:${Object.keys(actionTable).join(' / ')})`,
                };
            }
            if (!Array.isArray(actionsRaw) || actionsRaw.length === 0) {
                return { ok: false, reason: `cindy.${category} 必须是非空数组` };
            }
            const actions = [];
            for (const a of actionsRaw) {
                if (typeof a !== 'string' || !allowed.includes(a)) {
                    return {
                        ok: false,
                        reason: `cindy.${category} 含未知动作 ${JSON.stringify(a)}(可用:${allowed.join(' / ')})`,
                    };
                }
                if (actions.includes(a)) {
                    return { ok: false, reason: `cindy.${category} 含重复动作 ${JSON.stringify(a)}` };
                }
                actions.push(a);
            }
            if (category === 'image')
                cindy.image = actions;
            else if (category === 'video')
                cindy.video = actions;
            else if (category === 'media')
                cindy.media = actions;
            else if (category === 'text')
                cindy.text = actions;
            else if (category === 'embed')
                cindy.embed = actions;
            else if (category === 'search')
                cindy.search = actions;
            else
                return {
                    ok: false,
                    reason: `cindy 能力类目 ${JSON.stringify(category)} 尚未接线(协议缺陷)`,
                };
        }
        if (cindy.image === undefined &&
            cindy.video === undefined &&
            cindy.media === undefined &&
            cindy.text === undefined &&
            cindy.embed === undefined &&
            cindy.search === undefined) {
            return { ok: false, reason: 'cindy 能力详单不能是空对象' };
        }
        const oneshotModelRaw = cindyRaw.oneshotModel;
        if (oneshotModelRaw !== undefined) {
            if (typeof oneshotModelRaw !== 'string' ||
                oneshotModelRaw.trim().length === 0 ||
                oneshotModelRaw.length > 128) {
                return {
                    ok: false,
                    reason: 'cindy.oneshotModel 必须是 1–128 字符的目录模型 id(如 "codex/gpt-5.5")',
                };
            }
            if (!cindy.text?.includes('oneshot')) {
                return {
                    ok: false,
                    reason: 'cindy.oneshotModel 必须与 text 含 "oneshot" 成对声明(它是快问快答的偏好模型)',
                };
            }
            cindy.oneshotModel = oneshotModelRaw.trim();
        }
        if (cindy.search?.includes('web') && (!slots.includes('tool') || tools === undefined)) {
            return {
                ok: false,
                reason: 'cindy.search.web 只允许由真实 tool-call 触发，必须同时声明 "tool" 槽和 tools',
            };
        }
    }
    let subscribe;
    if (raw.subscribe !== undefined) {
        if (!isPlainObject(raw.subscribe)) {
            return { ok: false, reason: 'subscribe 订阅详单必须是对象(如 { "topics": ["turn"] })' };
        }
        if (!slots.includes('subscribe')) {
            return { ok: false, reason: '声明了 subscribe 订阅详单但 slots 未包含 "subscribe"' };
        }
        subscribe = {};
        const subRaw = raw.subscribe;
        for (const [field, allowed] of [
            ['topics', GHOST_SUBSCRIBE_TOPICS],
            ['hooks', GHOST_SUBSCRIBE_HOOKS],
        ]) {
            const listRaw = subRaw[field];
            if (listRaw === undefined)
                continue;
            if (!Array.isArray(listRaw) || listRaw.length === 0) {
                return { ok: false, reason: `subscribe.${field} 必须是非空数组` };
            }
            const list = [];
            for (const item of listRaw) {
                if (typeof item !== 'string' || !allowed.includes(item)) {
                    return {
                        ok: false,
                        reason: `subscribe.${field} 含未知项 ${JSON.stringify(item)}(可用:${allowed.join(' / ')})`,
                    };
                }
                if (list.includes(item)) {
                    return { ok: false, reason: `subscribe.${field} 含重复项 ${JSON.stringify(item)}` };
                }
                list.push(item);
            }
            if (field === 'topics')
                subscribe.topics = list;
            else
                subscribe.hooks = list;
        }
        if (subscribe.topics === undefined && subscribe.hooks === undefined) {
            return { ok: false, reason: 'subscribe 订阅详单不能是空对象' };
        }
        if (subscribe.hooks !== undefined && raw.launch !== 'resident') {
            return {
                ok: false,
                reason: '声明了 subscribe.hooks(拦截钩子)必须同时声明 launch: "resident"——拦截要求常驻在场,否则每条消息都要等冷启动',
            };
        }
    }
    let network;
    if (raw.network !== undefined) {
        if (!isPlainObject(raw.network)) {
            return { ok: false, reason: 'network 详单必须是对象(如 { "hosts": ["api.example.com"] })' };
        }
        if (!slots.includes('network')) {
            return { ok: false, reason: '声明了 network 详单但 slots 未包含 "network"' };
        }
        const n = raw.network;
        const hasConnectionDecls = Array.isArray(n.connections) && n.connections.length > 0;
        if (n.hosts === undefined && !hasConnectionDecls) {
            return {
                ok: false,
                reason: `network.hosts 必须是 1–${GHOST_NETWORK_MAX_HOSTS} 条的数组(仅声明了 network.connections 时才可缺省)`,
            };
        }
        if (n.hosts !== undefined &&
            (!Array.isArray(n.hosts) || n.hosts.length > GHOST_NETWORK_MAX_HOSTS)) {
            return { ok: false, reason: `network.hosts 必须是 1–${GHOST_NETWORK_MAX_HOSTS} 条的数组` };
        }
        if (Array.isArray(n.hosts) && n.hosts.length === 0 && !hasConnectionDecls) {
            return {
                ok: false,
                reason: `network.hosts 必须是 1–${GHOST_NETWORK_MAX_HOSTS} 条的数组(仅声明了 network.connections 时才允许为空)`,
            };
        }
        const hosts = [];
        for (const h of Array.isArray(n.hosts) ? n.hosts : []) {
            if (typeof h !== 'string' || !isValidGhostNetworkHostPattern(h.trim().toLowerCase())) {
                return {
                    ok: false,
                    reason: `network.hosts 含非法条目 ${JSON.stringify(h)}(小写域名、至少两段、通配只允许最左 "*.";不收 IP / 端口 / 路径 / 协议)`,
                };
            }
            const host = h.trim().toLowerCase();
            if (hosts.includes(host)) {
                return { ok: false, reason: `network.hosts 含重复条目 ${JSON.stringify(h)}` };
            }
            hosts.push(host);
        }
        let secrets;
        if (n.secrets !== undefined) {
            if (!Array.isArray(n.secrets) ||
                n.secrets.length === 0 ||
                n.secrets.length > GHOST_NETWORK_MAX_SECRETS) {
                return {
                    ok: false,
                    reason: `network.secrets 必须是 1–${GHOST_NETWORK_MAX_SECRETS} 条的数组`,
                };
            }
            secrets = [];
            const seenKeys = new Set();
            for (const s of n.secrets) {
                if (!isPlainObject(s))
                    return { ok: false, reason: 'network.secrets 每项必须是对象' };
                if (typeof s.key !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/.test(s.key)) {
                    return {
                        ok: false,
                        reason: 'network.secrets[].key 必须是小写字母开头的 1–32 位小写/数字/下划线',
                    };
                }
                if (seenKeys.has(s.key)) {
                    return { ok: false, reason: `network.secrets 含重复 key ${JSON.stringify(s.key)}` };
                }
                seenKeys.add(s.key);
                if (typeof s.label !== 'string' || s.label.trim().length === 0 || s.label.length > 64) {
                    return { ok: false, reason: 'network.secrets[].label 必须是 1–64 字符的非空字符串' };
                }
                let source;
                if (s.source !== undefined) {
                    if (typeof s.source !== 'string' ||
                        !GHOST_SECRET_SOURCES.includes(s.source)) {
                        return {
                            ok: false,
                            reason: `network.secrets[].source 仅支持 ${GHOST_SECRET_SOURCES.join(' / ')}(缺省 user)`,
                        };
                    }
                    if (s.source === 'login-email')
                        source = 'login-email';
                    if (s.source === 'oauth')
                        source = 'oauth';
                    if (s.source === 'login-feishu-token')
                        source = 'login-feishu-token';
                    if (s.source === 'oidc-token')
                        source = 'oidc-token';
                    if (s.source === 'gh-cli')
                        source = 'gh-cli';
                }
                if (s.input !== undefined && s.input !== 'ghost') {
                    return {
                        ok: false,
                        reason: 'network.secrets[].input 已退役:宿主收单不存在,用户填写的凭证一律由意识 settingsHtml 收单(删掉 input 字段即可;唯一可接受的遗留值是 "ghost")',
                    };
                }
                const loginDerived = source === 'login-email' || source === 'login-feishu-token';
                const oidcManaged = source === 'oidc-token';
                const ghCliManaged = source === 'gh-cli';
                if (s.input === 'ghost' && (loginDerived || oidcManaged || ghCliManaged)) {
                    return {
                        ok: false,
                        reason: `source: ${source} 的凭证不允许标注 input: ghost(Host 托管凭证没有输入,谈不上谁收单)`,
                    };
                }
                if (!loginDerived && !oidcManaged && raw.settingsHtml === undefined) {
                    return {
                        ok: false,
                        reason: 'network.secrets 声明了用户填写的凭证时必须同时声明 settingsHtml(凭证由意识设置界面收单,没有界面就没人收单;宿主渲染输入行已退役)',
                    };
                }
                if (loginDerived && s.url !== undefined) {
                    return {
                        ok: false,
                        reason: `network.secrets[].source 为 ${source} 时不允许声明 url(值取自主机登录态,没有"前往控制台"可去)`,
                    };
                }
                if (loginDerived && s.exchange !== undefined) {
                    return {
                        ok: false,
                        reason: `network.secrets[].source 为 ${source} 时不允许声明 exchange(登录态凭证不外送交换端点)`,
                    };
                }
                if (oidcManaged && s.url !== undefined) {
                    return {
                        ok: false,
                        reason: 'network.secrets[].source 为 oidc-token 时不允许声明 url(令牌由 Host 按需签发)',
                    };
                }
                if (oidcManaged && s.exchange !== undefined) {
                    return {
                        ok: false,
                        reason: 'network.secrets[].source 为 oidc-token 时不允许声明 exchange(不允许把 Connection JWT 转交给第三方端点)',
                    };
                }
                if (ghCliManaged && s.exchange !== undefined) {
                    return {
                        ok: false,
                        reason: 'network.secrets[].source 为 gh-cli 时不允许声明 exchange(不允许把 GitHub 登录令牌转交给第三方端点)',
                    };
                }
                if (s.hint !== undefined &&
                    (typeof s.hint !== 'string' || s.hint.trim().length === 0 || s.hint.length > 200)) {
                    return { ok: false, reason: 'network.secrets[].hint 必须是 1–200 字符的非空字符串' };
                }
                if (s.url !== undefined) {
                    if (typeof s.url !== 'string' || s.url.length === 0 || s.url.length > 200) {
                        return { ok: false, reason: 'network.secrets[].url 必须是 1–200 字符的字符串' };
                    }
                    let parsed;
                    try {
                        parsed = new URL(s.url);
                    }
                    catch {
                        return { ok: false, reason: 'network.secrets[].url 不是合法的绝对地址' };
                    }
                    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
                        return {
                            ok: false,
                            reason: 'network.secrets[].url 仅支持 https 且不允许内嵌用户名/密码',
                        };
                    }
                }
                if (!isPlainObject(s.inject)) {
                    return {
                        ok: false,
                        reason: `network.secrets[${JSON.stringify(s.key)}].inject 必填(凭证要声明注入到哪个请求头)`,
                    };
                }
                const inj = s.inject;
                if (typeof inj.header !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(inj.header)) {
                    return {
                        ok: false,
                        reason: 'network.secrets[].inject.header 必须是 1–64 位字母/数字/连字符的头名',
                    };
                }
                if (GHOST_NETWORK_FORBIDDEN_INJECT_HEADERS.includes(inj.header.toLowerCase())) {
                    return {
                        ok: false,
                        reason: `network.secrets[].inject.header 不允许使用协议关键头 ${JSON.stringify(inj.header)}`,
                    };
                }
                if (typeof inj.format !== 'string' ||
                    inj.format.length === 0 ||
                    inj.format.length > 200 ||
                    inj.format.split('{value}').length !== 2) {
                    return {
                        ok: false,
                        reason: 'network.secrets[].inject.format 必须是 ≤200 字符且恰含一个 {value} 占位的字符串(如 "Bearer {value}")',
                    };
                }
                let injectHosts;
                if (inj.hosts !== undefined) {
                    if (!Array.isArray(inj.hosts) || inj.hosts.length === 0) {
                        return {
                            ok: false,
                            reason: 'network.secrets[].inject.hosts 必须是非空数组(或省略 = 全部白名单域名)',
                        };
                    }
                    injectHosts = [];
                    for (const ih of inj.hosts) {
                        if (typeof ih !== 'string' || !hosts.includes(ih.trim().toLowerCase())) {
                            return {
                                ok: false,
                                reason: `network.secrets[].inject.hosts 含 ${JSON.stringify(ih)}——必须逐字取自 network.hosts 声明条目`,
                            };
                        }
                        const ihNorm = ih.trim().toLowerCase();
                        if (injectHosts.includes(ihNorm)) {
                            return {
                                ok: false,
                                reason: `network.secrets[].inject.hosts 含重复条目 ${JSON.stringify(ih)}`,
                            };
                        }
                        injectHosts.push(ihNorm);
                    }
                }
                if (oidcManaged) {
                    if (inj.header !== 'Authorization' || inj.format !== 'Bearer {value}') {
                        return {
                            ok: false,
                            reason: 'network.secrets[].source 为 oidc-token 时 inject 必须是 Authorization: Bearer {value}',
                        };
                    }
                    if (injectHosts === undefined || injectHosts.length === 0) {
                        return {
                            ok: false,
                            reason: 'network.secrets[].source 为 oidc-token 时必须显式声明非空 inject.hosts',
                        };
                    }
                    if (injectHosts.some((host) => host.startsWith('*.'))) {
                        return {
                            ok: false,
                            reason: 'network.secrets[].source 为 oidc-token 时 inject.hosts 只允许精确域名,不允许通配',
                        };
                    }
                }
                if (ghCliManaged) {
                    if (inj.header !== 'Authorization' || inj.format !== 'Bearer {value}') {
                        return {
                            ok: false,
                            reason: 'network.secrets[].source 为 gh-cli 时 inject 必须是 Authorization: Bearer {value}',
                        };
                    }
                    if (injectHosts === undefined ||
                        injectHosts.length !== 1 ||
                        injectHosts[0] !== 'api.github.com') {
                        return {
                            ok: false,
                            reason: 'network.secrets[].source 为 gh-cli 时 inject.hosts 必须且只能是 api.github.com',
                        };
                    }
                }
                let oauth;
                if (source === 'oauth' && s.oauth === undefined) {
                    return {
                        ok: false,
                        reason: `network.secrets[${JSON.stringify(s.key)}].oauth 必填(source: oauth 的凭证要声明去哪授权)`,
                    };
                }
                if (source !== 'oauth' && s.oauth !== undefined) {
                    return {
                        ok: false,
                        reason: 'network.secrets[].oauth 仅允许在 source: oauth 的凭证上声明',
                    };
                }
                if (source === 'oauth' && s.exchange !== undefined) {
                    return {
                        ok: false,
                        reason: 'network.secrets[].source 为 oauth 时不允许声明 exchange(access token 直接注入,无二段交换)',
                    };
                }
                if (s.oauth !== undefined) {
                    if (!isPlainObject(s.oauth)) {
                        return {
                            ok: false,
                            reason: `network.secrets[${JSON.stringify(s.key)}].oauth 必须是对象`,
                        };
                    }
                    const oa = s.oauth;
                    const parseHostBoundUrl = (raw2, field) => {
                        if (typeof raw2 !== 'string' || raw2.length === 0 || raw2.length > 2048) {
                            return {
                                ok: false,
                                reason: `network.secrets[].oauth.${field} 必须是 1–2048 字符的字符串`,
                            };
                        }
                        let parsed2;
                        try {
                            parsed2 = new URL(raw2);
                        }
                        catch {
                            return { ok: false, reason: `network.secrets[].oauth.${field} 不是合法的绝对地址` };
                        }
                        if (parsed2.protocol !== 'https:' ||
                            parsed2.port !== '' ||
                            parsed2.username ||
                            parsed2.password) {
                            return {
                                ok: false,
                                reason: `network.secrets[].oauth.${field} 仅支持 https 默认端口且不允许内嵌用户名/密码`,
                            };
                        }
                        if (!hosts.some((pattern) => ghostNetworkHostMatches(pattern, parsed2.hostname))) {
                            return {
                                ok: false,
                                reason: `network.secrets[].oauth.${field} 的域名 ${JSON.stringify(parsed2.hostname)} 必须命中 network.hosts 白名单`,
                            };
                        }
                        return { ok: true, url: raw2 };
                    };
                    const authorizeParsed = parseHostBoundUrl(oa.authorizeUrl, 'authorizeUrl');
                    if (!authorizeParsed.ok)
                        return authorizeParsed;
                    const tokenParsed = parseHostBoundUrl(oa.tokenUrl, 'tokenUrl');
                    if (!tokenParsed.ok)
                        return tokenParsed;
                    if (oa.clientId !== undefined) {
                        if (typeof oa.clientId !== 'string' ||
                            oa.clientId.trim().length === 0 ||
                            oa.clientId.length > 200 ||
                            /\s/.test(oa.clientId)) {
                            return {
                                ok: false,
                                reason: 'network.secrets[].oauth.clientId 必须是 1–200 字符、不含空白的字符串',
                            };
                        }
                    }
                    if (oa.clientSecret !== undefined) {
                        if (oa.clientId === undefined) {
                            return {
                                ok: false,
                                reason: 'network.secrets[].oauth.clientSecret 必须与 clientId 成对声明',
                            };
                        }
                        if (typeof oa.clientSecret !== 'string' ||
                            oa.clientSecret.trim().length === 0 ||
                            oa.clientSecret.length > 200 ||
                            /\s/.test(oa.clientSecret)) {
                            return {
                                ok: false,
                                reason: 'network.secrets[].oauth.clientSecret 必须是 1–200 字符、不含空白的字符串',
                            };
                        }
                    }
                    let oaScopes;
                    if (oa.scopes !== undefined) {
                        if (!Array.isArray(oa.scopes) || oa.scopes.length > GHOST_OAUTH_SCOPES_MAX) {
                            return {
                                ok: false,
                                reason: `network.secrets[].oauth.scopes 必须是 ≤${GHOST_OAUTH_SCOPES_MAX} 条的数组`,
                            };
                        }
                        oaScopes = [];
                        for (const sc of oa.scopes) {
                            if (typeof sc !== 'string' ||
                                sc.trim().length === 0 ||
                                sc.length > 200 ||
                                /\s/.test(sc)) {
                                return {
                                    ok: false,
                                    reason: `network.secrets[].oauth.scopes 含非法条目 ${JSON.stringify(sc)}(1–200 字符、不含空白)`,
                                };
                            }
                            if (oaScopes.includes(sc)) {
                                return {
                                    ok: false,
                                    reason: `network.secrets[].oauth.scopes 含重复条目 ${JSON.stringify(sc)}`,
                                };
                            }
                            oaScopes.push(sc);
                        }
                    }
                    if (oa.pkce !== undefined && typeof oa.pkce !== 'boolean') {
                        return { ok: false, reason: 'network.secrets[].oauth.pkce 必须是布尔值(缺省 true)' };
                    }
                    if (oa.scopeDelimiter !== undefined && oa.scopeDelimiter !== ',') {
                        return {
                            ok: false,
                            reason: 'network.secrets[].oauth.scopeDelimiter 目前只支持 ","(缺省 = 空格拼接)',
                        };
                    }
                    let oaExtra;
                    if (oa.extraAuthorizeParams !== undefined) {
                        if (!isPlainObject(oa.extraAuthorizeParams)) {
                            return {
                                ok: false,
                                reason: 'network.secrets[].oauth.extraAuthorizeParams 必须是对象',
                            };
                        }
                        const entries = Object.entries(oa.extraAuthorizeParams);
                        if (entries.length === 0 || entries.length > GHOST_OAUTH_EXTRA_PARAMS_MAX) {
                            return {
                                ok: false,
                                reason: `network.secrets[].oauth.extraAuthorizeParams 必须是 1–${GHOST_OAUTH_EXTRA_PARAMS_MAX} 条(或省略)`,
                            };
                        }
                        oaExtra = {};
                        for (const [pk, pv] of entries) {
                            if (!/^[a-z][a-z0-9_]{0,31}$/.test(pk)) {
                                return {
                                    ok: false,
                                    reason: `network.secrets[].oauth.extraAuthorizeParams 键 ${JSON.stringify(pk)} 必须是小写字母开头的 1–32 位小写/数字/下划线`,
                                };
                            }
                            if (GHOST_OAUTH_RESERVED_AUTHORIZE_PARAMS.includes(pk)) {
                                return {
                                    ok: false,
                                    reason: `network.secrets[].oauth.extraAuthorizeParams 不允许声明协议保留参数 ${JSON.stringify(pk)}`,
                                };
                            }
                            if (typeof pv !== 'string' || pv.length === 0 || pv.length > 200) {
                                return {
                                    ok: false,
                                    reason: `network.secrets[].oauth.extraAuthorizeParams[${JSON.stringify(pk)}] 必须是 1–200 字符的字符串`,
                                };
                            }
                            oaExtra[pk] = pv;
                        }
                    }
                    if (oa.redirectPort !== undefined) {
                        if (typeof oa.redirectPort !== 'number' ||
                            !Number.isInteger(oa.redirectPort) ||
                            oa.redirectPort < 1024 ||
                            oa.redirectPort > 65535) {
                            return {
                                ok: false,
                                reason: 'network.secrets[].oauth.redirectPort 必须是 1024–65535 的整数',
                            };
                        }
                    }
                    if (oa.tokenBroker !== undefined) {
                        if (typeof oa.tokenBroker !== 'string' ||
                            !GHOST_OAUTH_TOKEN_BROKER_RE.test(oa.tokenBroker)) {
                            return {
                                ok: false,
                                reason: 'network.secrets[].oauth.tokenBroker 必须是小写字母开头的 1–32 位小写/数字/下划线/连字符',
                            };
                        }
                        if (oa.clientSecret !== undefined) {
                            return {
                                ok: false,
                                reason: 'network.secrets[].oauth.tokenBroker 与 clientSecret 互斥(broker 模式下 secret 由服务端持有,不随包分发)',
                            };
                        }
                    }
                    let oaBounce;
                    if (oa.brokerBounce !== undefined) {
                        if (oa.tokenBroker === undefined || oa.redirectPort === undefined) {
                            return {
                                ok: false,
                                reason: 'network.secrets[].oauth.brokerBounce 必须与 tokenBroker、redirectPort 同时声明',
                            };
                        }
                        if (!isPlainObject(oa.brokerBounce)) {
                            return { ok: false, reason: 'network.secrets[].oauth.brokerBounce 必须是对象' };
                        }
                        const bb = oa.brokerBounce;
                        for (const field of ['path', 'callbackPath']) {
                            const v = bb[field];
                            if (typeof v !== 'string' || v.length > 128 || !GHOST_OAUTH_BOUNCE_PATH_RE.test(v)) {
                                return {
                                    ok: false,
                                    reason: `network.secrets[].oauth.brokerBounce.${field} 必须是 / 开头的站内绝对路径(段字符限字母/数字/_/-,≤128 字符)`,
                                };
                            }
                        }
                        oaBounce = { path: bb.path, callbackPath: bb.callbackPath };
                    }
                    let oaIdentity;
                    if (oa.identity !== undefined) {
                        if (!isPlainObject(oa.identity)) {
                            return { ok: false, reason: 'network.secrets[].oauth.identity 必须是对象' };
                        }
                        const idn = oa.identity;
                        const idnUrl = parseHostBoundUrl(idn.url, 'identity.url');
                        if (!idnUrl.ok)
                            return idnUrl;
                        if (typeof idn.labelPath !== 'string' ||
                            idn.labelPath.length > 128 ||
                            !GHOST_SECRET_EXCHANGE_TOKEN_PATH_RE.test(idn.labelPath)) {
                            return {
                                ok: false,
                                reason: 'network.secrets[].oauth.identity.labelPath 必须是 ≤128 字符的点分路径(段名限字母/数字/_/-,如 "email" / "user.name")',
                            };
                        }
                        let idnTemplate;
                        if (idn.displayTemplate !== undefined) {
                            if (typeof idn.displayTemplate !== 'string' ||
                                idn.displayTemplate.length === 0 ||
                                idn.displayTemplate.length > GHOST_OAUTH_IDENTITY_TEMPLATE_MAX_CHARS) {
                                return {
                                    ok: false,
                                    reason: `network.secrets[].oauth.identity.displayTemplate 必须是 1–${GHOST_OAUTH_IDENTITY_TEMPLATE_MAX_CHARS} 字符的字符串`,
                                };
                            }
                            const placeholders = [
                                ...idn.displayTemplate.matchAll(GHOST_OAUTH_IDENTITY_TEMPLATE_PLACEHOLDER_RE),
                            ];
                            if (placeholders.length === 0) {
                                return {
                                    ok: false,
                                    reason: 'network.secrets[].oauth.identity.displayTemplate 必须含至少一个 {点分路径} 占位符(如 "{team} · {user}")',
                                };
                            }
                            for (const m of placeholders) {
                                const p = m[1] ?? '';
                                if (p.length > 128 || !GHOST_SECRET_EXCHANGE_TOKEN_PATH_RE.test(p)) {
                                    return {
                                        ok: false,
                                        reason: `network.secrets[].oauth.identity.displayTemplate 占位符 {${p}} 不是合法点分路径(段名限字母/数字/_/-)`,
                                    };
                                }
                            }
                            idnTemplate = idn.displayTemplate;
                        }
                        oaIdentity = {
                            url: idnUrl.url,
                            labelPath: idn.labelPath,
                            ...(idnTemplate !== undefined ? { displayTemplate: idnTemplate } : {}),
                        };
                    }
                    oauth = {
                        authorizeUrl: authorizeParsed.url,
                        tokenUrl: tokenParsed.url,
                        ...(oa.clientId !== undefined ? { clientId: oa.clientId } : {}),
                        ...(oa.clientSecret !== undefined ? { clientSecret: oa.clientSecret } : {}),
                        ...(oaScopes !== undefined ? { scopes: oaScopes } : {}),
                        ...(oa.scopeDelimiter !== undefined
                            ? { scopeDelimiter: oa.scopeDelimiter }
                            : {}),
                        ...(oa.pkce !== undefined ? { pkce: oa.pkce } : {}),
                        ...(oaExtra !== undefined ? { extraAuthorizeParams: oaExtra } : {}),
                        ...(oaIdentity !== undefined ? { identity: oaIdentity } : {}),
                        ...(oa.redirectPort !== undefined ? { redirectPort: oa.redirectPort } : {}),
                        ...(oa.tokenBroker !== undefined ? { tokenBroker: oa.tokenBroker } : {}),
                        ...(oaBounce !== undefined ? { brokerBounce: oaBounce } : {}),
                    };
                }
                let exchange;
                if (s.exchange !== undefined) {
                    if (!isPlainObject(s.exchange)) {
                        return {
                            ok: false,
                            reason: `network.secrets[${JSON.stringify(s.key)}].exchange 必须是对象`,
                        };
                    }
                    const ex = s.exchange;
                    if (typeof ex.url !== 'string' || ex.url.length === 0 || ex.url.length > 2048) {
                        return {
                            ok: false,
                            reason: 'network.secrets[].exchange.url 必须是 1–2048 字符的字符串',
                        };
                    }
                    let exUrl;
                    try {
                        exUrl = new URL(ex.url);
                    }
                    catch {
                        return { ok: false, reason: 'network.secrets[].exchange.url 不是合法的绝对地址' };
                    }
                    if (exUrl.protocol !== 'https:' ||
                        exUrl.port !== '' ||
                        exUrl.username ||
                        exUrl.password) {
                        return {
                            ok: false,
                            reason: 'network.secrets[].exchange.url 仅支持 https 默认端口且不允许内嵌用户名/密码',
                        };
                    }
                    if (!hosts.some((pattern) => ghostNetworkHostMatches(pattern, exUrl.hostname))) {
                        return {
                            ok: false,
                            reason: `network.secrets[].exchange.url 的域名 ${JSON.stringify(exUrl.hostname)} 必须命中 network.hosts 白名单`,
                        };
                    }
                    if (typeof ex.bodyFormat !== 'string' ||
                        ex.bodyFormat.length === 0 ||
                        ex.bodyFormat.length > GHOST_SECRET_EXCHANGE_BODY_MAX_CHARS ||
                        ex.bodyFormat.split('{value}').length !== 2) {
                        return {
                            ok: false,
                            reason: `network.secrets[].exchange.bodyFormat 必须是 ≤${GHOST_SECRET_EXCHANGE_BODY_MAX_CHARS} 字符且恰含一个 {value} 占位的字符串`,
                        };
                    }
                    let exContentType;
                    if (ex.contentType !== undefined) {
                        if (typeof ex.contentType !== 'string' ||
                            !GHOST_SECRET_EXCHANGE_CONTENT_TYPES.includes(ex.contentType)) {
                            return {
                                ok: false,
                                reason: `network.secrets[].exchange.contentType 仅支持 ${GHOST_SECRET_EXCHANGE_CONTENT_TYPES.join(' / ')}`,
                            };
                        }
                        exContentType = ex.contentType;
                    }
                    if (typeof ex.tokenPath !== 'string' ||
                        ex.tokenPath.length > 128 ||
                        !GHOST_SECRET_EXCHANGE_TOKEN_PATH_RE.test(ex.tokenPath)) {
                        return {
                            ok: false,
                            reason: 'network.secrets[].exchange.tokenPath 必须是 ≤128 字符的点分路径(段名限字母/数字/_/-,如 "session" / "data.token")',
                        };
                    }
                    let exTtl;
                    if (ex.ttlSeconds !== undefined) {
                        if (typeof ex.ttlSeconds !== 'number' ||
                            !Number.isInteger(ex.ttlSeconds) ||
                            ex.ttlSeconds < GHOST_SECRET_EXCHANGE_TTL_MIN_S ||
                            ex.ttlSeconds > GHOST_SECRET_EXCHANGE_TTL_MAX_S) {
                            return {
                                ok: false,
                                reason: `network.secrets[].exchange.ttlSeconds 必须是 ${GHOST_SECRET_EXCHANGE_TTL_MIN_S}–${GHOST_SECRET_EXCHANGE_TTL_MAX_S} 的整数(秒)`,
                            };
                        }
                        exTtl = ex.ttlSeconds;
                    }
                    exchange = {
                        url: ex.url,
                        bodyFormat: ex.bodyFormat,
                        ...(exContentType !== undefined ? { contentType: exContentType } : {}),
                        tokenPath: ex.tokenPath,
                        ...(exTtl !== undefined ? { ttlSeconds: exTtl } : {}),
                    };
                }
                secrets.push({
                    key: s.key,
                    label: s.label,
                    ...(source !== undefined ? { source } : {}),
                    ...(s.hint !== undefined ? { hint: s.hint } : {}),
                    ...(s.url !== undefined ? { url: s.url } : {}),
                    inject: {
                        header: inj.header,
                        format: inj.format,
                        ...(injectHosts !== undefined ? { hosts: injectHosts } : {}),
                    },
                    ...(exchange !== undefined ? { exchange } : {}),
                    ...(oauth !== undefined ? { oauth } : {}),
                });
            }
        }
        let connections;
        if (n.connections !== undefined) {
            if (!Array.isArray(n.connections) ||
                n.connections.length === 0 ||
                n.connections.length > GHOST_NETWORK_MAX_CONNECTION_DECLS) {
                return {
                    ok: false,
                    reason: `network.connections 必须是 1–${GHOST_NETWORK_MAX_CONNECTION_DECLS} 条的数组`,
                };
            }
            if (raw.settingsHtml === undefined) {
                return {
                    ok: false,
                    reason: '声明了 network.connections 必须同时声明 settingsHtml(连接地址与凭证由意识设置界面收单,没有界面就没人收单)',
                };
            }
            connections = [];
            const seenConnKeys = new Set();
            const secretKeySet = new Set((secrets ?? []).map((s) => s.key));
            for (const c of n.connections) {
                if (!isPlainObject(c))
                    return { ok: false, reason: 'network.connections 每项必须是对象' };
                if (typeof c.key !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/.test(c.key)) {
                    return {
                        ok: false,
                        reason: 'network.connections[].key 必须是小写字母开头的 1–32 位小写/数字/下划线',
                    };
                }
                if (seenConnKeys.has(c.key)) {
                    return { ok: false, reason: `network.connections 含重复 key ${JSON.stringify(c.key)}` };
                }
                if (secretKeySet.has(c.key)) {
                    return {
                        ok: false,
                        reason: `network.connections[].key ${JSON.stringify(c.key)} 与 network.secrets 的 key 撞名(两者共用命名空间)`,
                    };
                }
                seenConnKeys.add(c.key);
                if (typeof c.label !== 'string' || c.label.trim().length === 0 || c.label.length > 64) {
                    return { ok: false, reason: 'network.connections[].label 必须是 1–64 字符的非空字符串' };
                }
                if (c.hint !== undefined &&
                    (typeof c.hint !== 'string' || c.hint.trim().length === 0 || c.hint.length > 200)) {
                    return { ok: false, reason: 'network.connections[].hint 必须是 1–200 字符的非空字符串' };
                }
                if (!isPlainObject(c.inject)) {
                    return {
                        ok: false,
                        reason: `network.connections[${JSON.stringify(c.key)}].inject 必填(连接凭证要声明注入到哪个请求头)`,
                    };
                }
                const cinj = c.inject;
                if (typeof cinj.header !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(cinj.header)) {
                    return {
                        ok: false,
                        reason: 'network.connections[].inject.header 必须是 1–64 位字母/数字/连字符的头名',
                    };
                }
                if (GHOST_NETWORK_FORBIDDEN_INJECT_HEADERS.includes(cinj.header.toLowerCase())) {
                    return {
                        ok: false,
                        reason: `network.connections[].inject.header 不允许使用协议关键头 ${JSON.stringify(cinj.header)}`,
                    };
                }
                if (typeof cinj.format !== 'string' ||
                    cinj.format.length === 0 ||
                    cinj.format.length > 200 ||
                    cinj.format.split('{value}').length !== 2) {
                    return {
                        ok: false,
                        reason: 'network.connections[].inject.format 必须是 ≤200 字符且恰含一个 {value} 占位的字符串(如 "Bearer {value}")',
                    };
                }
                if (cinj.hosts !== undefined) {
                    return {
                        ok: false,
                        reason: 'network.connections[].inject.hosts 不允许声明(连接凭证只注入对应连接自身的地址)',
                    };
                }
                if (c.maxConnections !== undefined) {
                    if (typeof c.maxConnections !== 'number' ||
                        !Number.isInteger(c.maxConnections) ||
                        c.maxConnections < 1 ||
                        c.maxConnections > GHOST_NETWORK_MAX_CONNECTIONS_PER_DECL) {
                        return {
                            ok: false,
                            reason: `network.connections[].maxConnections 必须是 1–${GHOST_NETWORK_MAX_CONNECTIONS_PER_DECL} 的整数(缺省 ${GHOST_NETWORK_MAX_CONNECTIONS_PER_DECL})`,
                        };
                    }
                }
                connections.push({
                    key: c.key,
                    label: c.label,
                    ...(c.hint !== undefined ? { hint: c.hint } : {}),
                    inject: { header: cinj.header, format: cinj.format },
                    ...(c.maxConnections !== undefined ? { maxConnections: c.maxConnections } : {}),
                });
            }
        }
        network = {
            hosts,
            ...(secrets !== undefined ? { secrets } : {}),
            ...(connections !== undefined ? { connections } : {}),
        };
    }
    let agent;
    if (raw.agent !== undefined) {
        if (!isPlainObject(raw.agent)) {
            return { ok: false, reason: 'agent 能力详单必须是对象(如 { "background": true })' };
        }
        if (!slots.includes('agent')) {
            return { ok: false, reason: '声明了 agent 能力详单但 slots 未包含 "agent"' };
        }
        const agentRaw = raw.agent;
        const unknownAgentField = Object.keys(agentRaw).find((key) => key !== 'background');
        if (unknownAgentField) {
            return {
                ok: false,
                reason: `agent 含不允许的字段 ${JSON.stringify(unknownAgentField)}`,
            };
        }
        if (agentRaw.background !== undefined && typeof agentRaw.background !== 'boolean') {
            return { ok: false, reason: 'agent.background 必须是布尔值' };
        }
        if (agentRaw.background !== true) {
            return {
                ok: false,
                reason: 'agent 能力详单目前只有 background: true 这一项;仅需用户点击触发时请省略 agent 字段',
            };
        }
        agent = { background: true };
    }
    let node;
    if (raw.node !== undefined) {
        if (!isPlainObject(raw.node)) {
            return { ok: false, reason: 'node 能力详单必须是对象' };
        }
        if (!slots.includes('node')) {
            return { ok: false, reason: '声明了 node 能力详单但 slots 未包含 "node"' };
        }
        const nodeRaw = raw.node;
        const allowedNodeFields = new Set([
            'entry',
            'protocol',
            'lifecycle',
            'idleTimeoutSeconds',
            'entries',
            'childSpawn',
            'secretBindings',
        ]);
        const unknownNodeField = Object.keys(nodeRaw).find((key) => !allowedNodeFields.has(key));
        if (unknownNodeField) {
            return {
                ok: false,
                reason: `node 含不允许的字段 ${JSON.stringify(unknownNodeField)};不能声明 command/args/shell/env`,
            };
        }
        if (!isSafeGhostRelativePath(nodeRaw.entry)) {
            return { ok: false, reason: 'node.entry 必须是安装目录内的安全相对路径' };
        }
        if (!/\.(?:c?js)$/.test(nodeRaw.entry)) {
            return { ok: false, reason: 'node.entry 必须是 CommonJS .js / .cjs 文件' };
        }
        if (nodeRaw.entry.toLowerCase() === raw.entry.toLowerCase()) {
            return { ok: false, reason: 'node.entry 不能与浏览器沙箱 entry 使用同一个文件' };
        }
        if (typeof nodeRaw.protocol !== 'string' ||
            !GHOST_NODE_PROTOCOLS.includes(nodeRaw.protocol)) {
            return { ok: false, reason: `node.protocol 必须是 ${GHOST_NODE_PROTOCOLS.join(' / ')}` };
        }
        if (nodeRaw.lifecycle !== undefined &&
            (typeof nodeRaw.lifecycle !== 'string' ||
                !GHOST_NODE_LIFECYCLES.includes(nodeRaw.lifecycle))) {
            return { ok: false, reason: `node.lifecycle 必须是 ${GHOST_NODE_LIFECYCLES.join(' / ')}` };
        }
        if (nodeRaw.idleTimeoutSeconds !== undefined &&
            (typeof nodeRaw.idleTimeoutSeconds !== 'number' ||
                !Number.isInteger(nodeRaw.idleTimeoutSeconds) ||
                nodeRaw.idleTimeoutSeconds < 30 ||
                nodeRaw.idleTimeoutSeconds > 3600)) {
            return { ok: false, reason: 'node.idleTimeoutSeconds 必须是 30–3600 的整数' };
        }
        if (nodeRaw.lifecycle === 'resident' && nodeRaw.idleTimeoutSeconds !== undefined) {
            return { ok: false, reason: 'node.lifecycle 为 resident 时不能再声明 idleTimeoutSeconds' };
        }
        let nodeEntries;
        if (nodeRaw.entries !== undefined) {
            if (!Array.isArray(nodeRaw.entries) || nodeRaw.entries.length === 0) {
                return { ok: false, reason: 'node.entries 必须是非空数组(额外工作进程入口清单)' };
            }
            if (nodeRaw.entries.length > GHOST_NODE_MAX_EXTRA_ENTRIES) {
                return { ok: false, reason: `node.entries 最多 ${GHOST_NODE_MAX_EXTRA_ENTRIES} 条` };
            }
            const seen = new Set();
            for (const extra of nodeRaw.entries) {
                if (!isSafeGhostRelativePath(extra)) {
                    return { ok: false, reason: 'node.entries 每项必须是安装目录内的安全相对路径' };
                }
                if (!/\.(?:c?js)$/.test(extra)) {
                    return { ok: false, reason: 'node.entries 每项必须是 CommonJS .js / .cjs 文件' };
                }
                const extraFold = extra.toLowerCase();
                if (extraFold === raw.entry.toLowerCase()) {
                    return { ok: false, reason: 'node.entries 不能包含浏览器沙箱 entry' };
                }
                if (extraFold === nodeRaw.entry.toLowerCase()) {
                    return { ok: false, reason: 'node.entries 不能重复主入口 node.entry' };
                }
                if (seen.has(extraFold)) {
                    return { ok: false, reason: `node.entries 含重复入口 ${JSON.stringify(extra)}` };
                }
                seen.add(extraFold);
            }
            nodeEntries = nodeRaw.entries;
        }
        if (nodeRaw.childSpawn !== undefined && typeof nodeRaw.childSpawn !== 'boolean') {
            return { ok: false, reason: 'node.childSpawn 必须是布尔值' };
        }
        let nodeSecretBindings;
        if (nodeRaw.secretBindings !== undefined) {
            if (!Array.isArray(nodeRaw.secretBindings) ||
                nodeRaw.secretBindings.length === 0 ||
                nodeRaw.secretBindings.length > GHOST_NODE_MAX_SECRET_BINDINGS) {
                return {
                    ok: false,
                    reason: `node.secretBindings 必须是 1–${GHOST_NODE_MAX_SECRET_BINDINGS} 条的数组`,
                };
            }
            if (raw.settingsHtml === undefined) {
                return {
                    ok: false,
                    reason: 'node.secretBindings 需要 settingsHtml 收集凭证',
                };
            }
            nodeSecretBindings = [];
            const seenSecretKeys = new Set();
            for (const bindingRaw of nodeRaw.secretBindings) {
                if (!isPlainObject(bindingRaw)) {
                    return { ok: false, reason: 'node.secretBindings 每项必须是对象' };
                }
                const binding = bindingRaw;
                const unknownBindingField = Object.keys(binding).find((key) => !['key', 'label', 'methods', 'entry', 'hint', 'url'].includes(key));
                if (unknownBindingField) {
                    return {
                        ok: false,
                        reason: `node.secretBindings[] 含不允许的字段 ${JSON.stringify(unknownBindingField)}`,
                    };
                }
                if (typeof binding.key !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/.test(binding.key)) {
                    return {
                        ok: false,
                        reason: 'node.secretBindings[].key 必须是小写字母开头的 1–32 位小写/数字/下划线',
                    };
                }
                if (seenSecretKeys.has(binding.key)) {
                    return {
                        ok: false,
                        reason: `node.secretBindings 含重复 key ${JSON.stringify(binding.key)}`,
                    };
                }
                seenSecretKeys.add(binding.key);
                if (typeof binding.label !== 'string' ||
                    binding.label.trim().length === 0 ||
                    binding.label.length > 64) {
                    return {
                        ok: false,
                        reason: 'node.secretBindings[].label 必须是 1–64 字符的非空字符串',
                    };
                }
                if (!Array.isArray(binding.methods) ||
                    binding.methods.length === 0 ||
                    binding.methods.length > GHOST_NODE_MAX_SECRET_METHODS) {
                    return {
                        ok: false,
                        reason: `node.secretBindings[].methods 必须是 1–${GHOST_NODE_MAX_SECRET_METHODS} 条的数组`,
                    };
                }
                const methods = [];
                for (const method of binding.methods) {
                    if (typeof method !== 'string' || !/^[A-Za-z0-9_./:-]{1,128}$/.test(method)) {
                        return {
                            ok: false,
                            reason: 'node.secretBindings[].methods 每项必须是 1–128 位安全方法名',
                        };
                    }
                    if (nodeRaw.protocol === 'mcp-stdio' && isGhostNodeMcpReservedMethod(method)) {
                        return {
                            ok: false,
                            reason: `node.secretBindings[].methods 不能绑定宿主保留的 MCP 方法 ${JSON.stringify(method)}`,
                        };
                    }
                    if (methods.includes(method)) {
                        return {
                            ok: false,
                            reason: `node.secretBindings[].methods 含重复方法 ${JSON.stringify(method)}`,
                        };
                    }
                    methods.push(method);
                }
                let bindingEntry;
                if (binding.entry !== undefined) {
                    if (typeof binding.entry !== 'string' ||
                        (binding.entry !== nodeRaw.entry && !(nodeEntries ?? []).includes(binding.entry))) {
                        return {
                            ok: false,
                            reason: 'node.secretBindings[].entry 必须逐字命中 node.entry 或 node.entries',
                        };
                    }
                    bindingEntry = binding.entry;
                }
                if (binding.hint !== undefined &&
                    (typeof binding.hint !== 'string' ||
                        binding.hint.trim().length === 0 ||
                        binding.hint.length > 200)) {
                    return {
                        ok: false,
                        reason: 'node.secretBindings[].hint 必须是 1–200 字符的非空字符串',
                    };
                }
                if (binding.url !== undefined) {
                    if (typeof binding.url !== 'string' ||
                        binding.url.length === 0 ||
                        binding.url.length > 200) {
                        return {
                            ok: false,
                            reason: 'node.secretBindings[].url 必须是 1–200 字符的字符串',
                        };
                    }
                    let parsed;
                    try {
                        parsed = new URL(binding.url);
                    }
                    catch {
                        return { ok: false, reason: 'node.secretBindings[].url 不是合法的绝对地址' };
                    }
                    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
                        return {
                            ok: false,
                            reason: 'node.secretBindings[].url 仅支持 https 且不允许内嵌用户名/密码',
                        };
                    }
                }
                nodeSecretBindings.push({
                    key: binding.key,
                    label: binding.label,
                    methods,
                    ...(bindingEntry !== undefined ? { entry: bindingEntry } : {}),
                    ...(binding.hint !== undefined ? { hint: binding.hint } : {}),
                    ...(binding.url !== undefined ? { url: binding.url } : {}),
                });
            }
        }
        node = {
            entry: nodeRaw.entry,
            protocol: nodeRaw.protocol,
            ...(nodeRaw.lifecycle !== undefined
                ? { lifecycle: nodeRaw.lifecycle }
                : {}),
            ...(nodeRaw.idleTimeoutSeconds !== undefined
                ? { idleTimeoutSeconds: nodeRaw.idleTimeoutSeconds }
                : {}),
            ...(nodeEntries !== undefined ? { entries: nodeEntries } : {}),
            ...(nodeRaw.childSpawn !== undefined ? { childSpawn: nodeRaw.childSpawn } : {}),
            ...(nodeSecretBindings !== undefined ? { secretBindings: nodeSecretBindings } : {}),
        };
    }
    if (slots.includes('node') && node === undefined) {
        return { ok: false, reason: 'slots 声明了 "node" 但缺少 node 工作进程详单' };
    }
    if (node?.secretBindings) {
        for (const binding of node.secretBindings) {
            if (network?.secrets?.some((secret) => secret.key === binding.key)) {
                return {
                    ok: false,
                    reason: `network.secrets 的 key ${JSON.stringify(binding.key)} 与 node.secretBindings 撞名`,
                };
            }
            if (network?.connections?.some((connection) => connection.key === binding.key)) {
                return {
                    ok: false,
                    reason: `network.connections[].key ${JSON.stringify(binding.key)} 与 node.secretBindings 的 key 撞名(两者共用命名空间)`,
                };
            }
        }
    }
    let preview;
    if (raw.preview !== undefined) {
        if (!isPlainObject(raw.preview)) {
            return { ok: false, reason: 'preview 详单必须是对象(如 { "hosts": ["*.example.com"] })' };
        }
        if (!slots.includes('preview')) {
            return { ok: false, reason: '声明了 preview 详单但 slots 未包含 "preview"' };
        }
        const previewRaw = raw.preview;
        const unknownPreviewField = Object.keys(previewRaw).find((key) => key !== 'hosts');
        if (unknownPreviewField !== undefined) {
            return { ok: false, reason: `preview 含不允许的字段 ${JSON.stringify(unknownPreviewField)}` };
        }
        if (!Array.isArray(previewRaw.hosts) || previewRaw.hosts.length === 0) {
            return { ok: false, reason: 'preview.hosts 必须是非空数组(可打开预览的域名白名单)' };
        }
        if (previewRaw.hosts.length > GHOST_PREVIEW_MAX_HOSTS) {
            return { ok: false, reason: `preview.hosts 最多 ${GHOST_PREVIEW_MAX_HOSTS} 条` };
        }
        const seenPreviewHosts = new Set();
        for (const host of previewRaw.hosts) {
            if (!isValidGhostNetworkHostPattern(host) &&
                !(typeof host === 'string' && GHOST_PREVIEW_LOOPBACK_HOSTS.has(host))) {
                return { ok: false, reason: `preview.hosts 含不合法域名模式 ${JSON.stringify(host)}` };
            }
            if (seenPreviewHosts.has(host)) {
                return { ok: false, reason: `preview.hosts 含重复域名 ${JSON.stringify(host)}` };
            }
            seenPreviewHosts.add(host);
        }
        preview = { hosts: previewRaw.hosts };
    }
    if (slots.includes('preview') && preview === undefined) {
        return {
            ok: false,
            reason: 'slots 声明了 "preview" 但缺少 preview 详单(hosts 域名白名单必填)',
        };
    }
    let skill;
    if (raw.skill !== undefined) {
        if (!isPlainObject(raw.skill)) {
            return {
                ok: false,
                reason: 'skill 详单必须是对象(如 { "items": [{ "dir": "skills/foo", "name": "foo", "description": "..." }] })',
            };
        }
        if (!slots.includes('skill')) {
            return { ok: false, reason: '声明了 skill 详单但 slots 未包含 "skill"' };
        }
        const skillRaw = raw.skill;
        const unknownSkillField = Object.keys(skillRaw).find((key) => key !== 'items');
        if (unknownSkillField !== undefined) {
            return { ok: false, reason: `skill 含不允许的字段 ${JSON.stringify(unknownSkillField)}` };
        }
        if (!Array.isArray(skillRaw.items) || skillRaw.items.length === 0) {
            return { ok: false, reason: 'skill.items 必须是非空数组(随包捆绑的技能清单)' };
        }
        if (skillRaw.items.length > GHOST_SKILL_MAX_ITEMS) {
            return { ok: false, reason: `skill.items 最多 ${GHOST_SKILL_MAX_ITEMS} 条` };
        }
        const skillItems = [];
        const seenSkillNames = new Set();
        const seenSkillDirs = new Set();
        for (const item of skillRaw.items) {
            if (!isPlainObject(item)) {
                return { ok: false, reason: 'skill.items 每项必须是对象({ dir, name, description })' };
            }
            const itemRaw = item;
            const unknownItemField = Object.keys(itemRaw).find((key) => key !== 'dir' && key !== 'name' && key !== 'description');
            if (unknownItemField !== undefined) {
                return {
                    ok: false,
                    reason: `skill.items 条目含不允许的字段 ${JSON.stringify(unknownItemField)}`,
                };
            }
            if (!isSafeGhostRelativePath(itemRaw.dir)) {
                return {
                    ok: false,
                    reason: `skill.items[].dir 必须是包内安全相对路径(如 "skills/foo"),得到 ${JSON.stringify(itemRaw.dir)}`,
                };
            }
            if (typeof itemRaw.name !== 'string' ||
                itemRaw.name.length > GHOST_SKILL_NAME_MAX_CHARS ||
                !GHOST_SKILL_NAME_RE.test(itemRaw.name)) {
                return {
                    ok: false,
                    reason: `skill.items[].name 必须是小写字母/数字加单连字符分段(禁首尾/连续连字符)、长度 1–${GHOST_SKILL_NAME_MAX_CHARS},得到 ${JSON.stringify(itemRaw.name)}`,
                };
            }
            if (typeof itemRaw.description !== 'string' ||
                itemRaw.description.trim().length === 0 ||
                itemRaw.description.length > 1024) {
                return { ok: false, reason: 'skill.items[].description 必须是 1–1024 字符的非空字符串' };
            }
            const nameFold = itemRaw.name.toLowerCase();
            if (seenSkillNames.has(nameFold)) {
                return { ok: false, reason: `skill.items 含重复 name ${JSON.stringify(itemRaw.name)}` };
            }
            seenSkillNames.add(nameFold);
            const dirFold = itemRaw.dir.toLowerCase();
            if (seenSkillDirs.has(dirFold)) {
                return { ok: false, reason: `skill.items 含重复 dir ${JSON.stringify(itemRaw.dir)}` };
            }
            seenSkillDirs.add(dirFold);
            skillItems.push({ dir: itemRaw.dir, name: itemRaw.name, description: itemRaw.description });
        }
        skill = { items: skillItems };
    }
    if (slots.includes('skill') && skill === undefined) {
        return { ok: false, reason: 'slots 声明了 "skill" 但缺少 skill 详单(items 技能清单必填)' };
    }
    let manual;
    if (raw.manual !== undefined) {
        if (!isPlainObject(raw.manual)) {
            return {
                ok: false,
                reason: 'manual 必须是对象(如 { "items": [{ "dir": "manual/getting-started", "name": "getting-started", "description": "..." }] })',
            };
        }
        const manualRaw = raw.manual;
        const unknownManualField = Object.keys(manualRaw).find((key) => key !== 'items');
        if (unknownManualField !== undefined) {
            return { ok: false, reason: `manual 含不允许的字段 ${JSON.stringify(unknownManualField)}` };
        }
        if (!Array.isArray(manualRaw.items) || manualRaw.items.length === 0) {
            return { ok: false, reason: 'manual.items 必须是非空数组(随包手册索引)' };
        }
        if (manualRaw.items.length > GHOST_MANUAL_MAX_ITEMS) {
            return { ok: false, reason: `manual.items 最多 ${GHOST_MANUAL_MAX_ITEMS} 条` };
        }
        const manualItems = [];
        const seenManualNames = new Set();
        const seenManualDirs = new Set();
        for (const item of manualRaw.items) {
            if (!isPlainObject(item)) {
                return { ok: false, reason: 'manual.items 每项必须是对象({ dir, name, description })' };
            }
            const itemRaw = item;
            const unknownItemField = Object.keys(itemRaw).find((key) => key !== 'dir' && key !== 'name' && key !== 'description');
            if (unknownItemField !== undefined) {
                return {
                    ok: false,
                    reason: `manual.items 条目含不允许的字段 ${JSON.stringify(unknownItemField)}`,
                };
            }
            if (!isSafeGhostRelativePath(itemRaw.dir)) {
                return {
                    ok: false,
                    reason: `manual.items[].dir 必须是包内安全相对路径(如 "manual/getting-started"),得到 ${JSON.stringify(itemRaw.dir)}`,
                };
            }
            const dirFold = itemRaw.dir.toLowerCase();
            if (declaredFilePathFolds.some((path) => pathsConflict(dirFold, path))) {
                return {
                    ok: false,
                    reason: `manual.items[].dir ${JSON.stringify(itemRaw.dir)} 与插件声明文件路径大小写折叠后冲突`,
                };
            }
            if (typeof itemRaw.name !== 'string' ||
                itemRaw.name.length > GHOST_SKILL_NAME_MAX_CHARS ||
                !GHOST_SKILL_NAME_RE.test(itemRaw.name)) {
                return {
                    ok: false,
                    reason: `manual.items[].name 必须是小写字母/数字加单连字符分段(禁首尾/连续连字符)、长度 1–${GHOST_SKILL_NAME_MAX_CHARS},得到 ${JSON.stringify(itemRaw.name)}`,
                };
            }
            if (typeof itemRaw.description !== 'string' ||
                itemRaw.description.trim().length === 0 ||
                itemRaw.description.length > GHOST_MANUAL_DESCRIPTION_MAX_CHARS) {
                return {
                    ok: false,
                    reason: `manual.items[].description 必须是 1–${GHOST_MANUAL_DESCRIPTION_MAX_CHARS} 字符的非空字符串`,
                };
            }
            const nameFold = itemRaw.name.toLowerCase();
            if (seenManualNames.has(nameFold)) {
                return { ok: false, reason: `manual.items 含重复 name ${JSON.stringify(itemRaw.name)}` };
            }
            seenManualNames.add(nameFold);
            if (seenManualDirs.has(dirFold)) {
                return { ok: false, reason: `manual.items 含重复 dir ${JSON.stringify(itemRaw.dir)}` };
            }
            seenManualDirs.add(dirFold);
            manualItems.push({
                dir: itemRaw.dir,
                name: itemRaw.name,
                description: itemRaw.description,
            });
        }
        manual = { items: manualItems };
    }
    if (raw.command !== undefined) {
        if (typeof raw.command !== 'string' ||
            raw.command.length === 0 ||
            raw.command.length > 32 ||
            /[\s/]/.test(raw.command)) {
            return { ok: false, reason: 'command 必须是 1–32 字符、不含空白与 "/" 的字符串' };
        }
        if (tools === undefined) {
            return { ok: false, reason: '声明了 command 但没有 tools——没有工具的指令无事可做' };
        }
    }
    let keywords;
    if (raw.keywords !== undefined) {
        if (!Array.isArray(raw.keywords) || raw.keywords.length === 0 || raw.keywords.length > 8) {
            return { ok: false, reason: 'keywords 必须是 1–8 项的数组' };
        }
        if (tools === undefined) {
            return { ok: false, reason: '声明了 keywords 但没有 tools——没有工具的触发词无事可做' };
        }
        const seen = new Set();
        keywords = [];
        for (const k of raw.keywords) {
            if (typeof k !== 'string')
                return { ok: false, reason: 'keywords 每项必须是字符串' };
            const word = k.trim();
            if (word.length < 2 || word.length > 24) {
                return {
                    ok: false,
                    reason: `keywords 每项须为 2–24 字符(单字词命中面失控):${JSON.stringify(k)}`,
                };
            }
            const fold = word.toLowerCase();
            if (seen.has(fold))
                continue;
            seen.add(fold);
            keywords.push(word);
        }
    }
    return {
        ok: true,
        manifest: {
            schemaVersion: GHOST_MANIFEST_SCHEMA_VERSION,
            id: raw.id,
            name: raw.name,
            version: raw.version,
            ...(raw.minCindyVersion !== undefined
                ? { minCindyVersion: raw.minCindyVersion }
                : {}),
            kind: 'chip',
            ...(raw.author !== undefined ? { author: raw.author } : {}),
            ...(locales !== undefined ? { locales } : {}),
            ...(raw.description !== undefined ? { description: raw.description } : {}),
            ...(raw.whenToUse !== undefined ? { whenToUse: raw.whenToUse } : {}),
            ...(raw.icon !== undefined ? { icon: raw.icon } : {}),
            entry: raw.entry,
            ...(raw.launch !== undefined ? { launch: raw.launch } : {}),
            ...(agent !== undefined ? { agent } : {}),
            ...(node !== undefined ? { node } : {}),
            ...(raw.settingsHtml !== undefined ? { settingsHtml: raw.settingsHtml } : {}),
            ...(raw.settingsHeight !== undefined ? { settingsHeight: raw.settingsHeight } : {}),
            slots,
            ...(card !== undefined ? { card } : {}),
            ...(tools !== undefined ? { tools } : {}),
            ...(cindy !== undefined ? { cindy } : {}),
            ...(subscribe !== undefined ? { subscribe } : {}),
            ...(network !== undefined ? { network } : {}),
            ...(raw.command !== undefined ? { command: raw.command } : {}),
            ...(keywords !== undefined ? { keywords } : {}),
            ...(panel !== undefined ? { panel } : {}),
            ...(preview !== undefined ? { preview } : {}),
            ...(skill !== undefined ? { skill } : {}),
            ...(manual !== undefined ? { manual } : {}),
        },
    };
}
