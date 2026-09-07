"use strict";
// Quip Execution Engine — File / Folder / Project Discovery
// ─────────────────────────────────────────────────────────────────────────────
// Resolves "open my quip project" / "open downloads" / "open invoice.pdf"
// to real local paths, then opens + verifies them.
//
// Performance rule: NO full-drive scans. Known folders first, then shallow
// scans of common project roots only (depth-limited, cached per session).
// ─────────────────────────────────────────────────────────────────────────────
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveLocalTarget = resolveLocalTarget;
exports.openLocalTarget = openLocalTarget;
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const electron_1 = require("electron");
const action_verifier_1 = require("./action-verifier");
const HOME = node_os_1.default.homedir();
// ─── Known folders ───────────────────────────────────────────────────────────
const KNOWN_FOLDERS = {
    downloads: () => node_path_1.default.join(HOME, "Downloads"),
    download: () => node_path_1.default.join(HOME, "Downloads"),
    desktop: () => node_path_1.default.join(HOME, "Desktop"),
    documents: () => node_path_1.default.join(HOME, "Documents"),
    document: () => node_path_1.default.join(HOME, "Documents"),
    docs: () => node_path_1.default.join(HOME, "Documents"),
    pictures: () => node_path_1.default.join(HOME, "Pictures"),
    photos: () => node_path_1.default.join(HOME, "Pictures"),
    music: () => node_path_1.default.join(HOME, "Music"),
    videos: () => node_path_1.default.join(HOME, "Videos"),
    home: () => HOME,
};
function resolveKnownFolder(word) {
    const fn = KNOWN_FOLDERS[word.toLowerCase().trim()];
    return fn ? fn() : null;
}
// ─── Project roots (shallow scan targets) ────────────────────────────────────
function projectRoots() {
    const candidates = [
        node_path_1.default.join(HOME, "Desktop"),
        node_path_1.default.join(HOME, "Documents"),
        node_path_1.default.join(HOME, "dev"),
        node_path_1.default.join(HOME, "projects"),
        node_path_1.default.join(HOME, "Projects"),
        node_path_1.default.join(HOME, "code"),
        node_path_1.default.join(HOME, "source"),
        node_path_1.default.join(HOME, "repos"),
        node_path_1.default.join(HOME, "Downloads"),
    ];
    return candidates.filter((p) => {
        try {
            return node_fs_1.default.existsSync(p) && node_fs_1.default.statSync(p).isDirectory();
        }
        catch {
            return false;
        }
    });
}
const SKIP_DIRS = new Set([
    "node_modules", ".git", "dist", "build", ".next", ".cache",
    "out", "target", "vendor", "__pycache__", ".venv", "venv",
]);
/** Shallow search for a folder/file by name (depth ≤ 3, skips build dirs). */
function findMatching(root, queryLower, depth, maxDepth, out, limit) {
    if (out.length >= limit || depth > maxDepth)
        return;
    let entries = [];
    try {
        entries = node_fs_1.default.readdirSync(root, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const entry of entries) {
        if (out.length >= limit)
            return;
        if (entry.name.startsWith(".") && entry.name !== ".env")
            continue;
        if (SKIP_DIRS.has(entry.name))
            continue;
        const full = node_path_1.default.join(root, entry.name);
        const nameLower = entry.name.toLowerCase();
        const baseNoExt = nameLower.replace(/\.[^.]+$/, "");
        if (nameLower === queryLower || baseNoExt === queryLower) {
            out.push(full);
            if (out.length >= limit)
                return;
        }
        if (entry.isDirectory()) {
            findMatching(full, queryLower, depth + 1, maxDepth, out, limit);
        }
    }
}
/**
 * Resolve a natural-language local target.
 * Order: context reuse → known folders → exact path → project-root scan.
 */
async function resolveLocalTarget(query, context) {
    const q = query.trim().toLowerCase().replace(/[?.!]+$/, "");
    if (!q)
        return null;
    // 1. Context: "open that folder again" / "open my project"
    if (context?.lastOpenedPath) {
        try {
            if (node_fs_1.default.existsSync(context.lastOpenedPath) && /project|folder|that|it|again/.test(q)) {
                return {
                    kind: "folder",
                    path: context.lastOpenedPath,
                    displayName: node_path_1.default.basename(context.lastOpenedPath),
                    confidence: 0.75,
                };
            }
        }
        catch {
            /* fall through */
        }
    }
    // 2. Known folders
    for (const word of q.split(/\s+/)) {
        const folder = resolveKnownFolder(word);
        if (folder && node_fs_1.default.existsSync(folder)) {
            return { kind: "folder", path: folder, displayName: node_path_1.default.basename(folder), confidence: 0.9 };
        }
    }
    // 3. Exact / absolute path in the message
    const pathMatch = query.match(/([A-Za-z]:\\[^"<>|*?]+|[A-Za-z]:\/[^"<>|*?]+|~\/[\w\-./ ]+)/);
    if (pathMatch) {
        const candidate = pathMatch[1].trim();
        const expanded = candidate.startsWith("~") ? node_path_1.default.join(HOME, candidate.slice(1)) : candidate;
        try {
            const stat = node_fs_1.default.statSync(expanded);
            return {
                kind: stat.isDirectory() ? "folder" : "file",
                path: expanded,
                displayName: node_path_1.default.basename(expanded),
                confidence: 0.95,
            };
        }
        catch {
            /* not a real path — continue */
        }
    }
    // 4. Shallow scan of project roots (cached root list, bounded depth)
    const results = [];
    for (const root of projectRoots()) {
        findMatching(root, q, 0, 3, results, 5);
        if (results.length >= 3)
            break;
    }
    if (results.length > 0) {
        const best = results[0];
        try {
            const stat = node_fs_1.default.statSync(best);
            return {
                kind: stat.isDirectory() ? "project" : "file",
                path: best,
                displayName: node_path_1.default.basename(best),
                confidence: 0.8,
            };
        }
        catch {
            /* race — fall through */
        }
    }
    return null;
}
/** Open a resolved local target and verify it actually opened. */
async function openLocalTarget(target) {
    let exists = false;
    try {
        exists = node_fs_1.default.existsSync(target.path);
    }
    catch {
        exists = false;
    }
    if (!exists) {
        return (0, action_verifier_1.fail)(`I couldn't find "${target.displayName}" on disk anymore.`, [`path missing: ${target.path}`], "path-missing");
    }
    if (target.kind === "file") {
        const err = await electron_1.shell.openPath(target.path);
        if (err) {
            return (0, action_verifier_1.fail)(`I couldn't open "${target.displayName}" — ${err}`, [`shell.openPath error: ${err}`], "open-file-failed");
        }
        return (0, action_verifier_1.ok)(`Opened ${target.displayName}.`, [`shell.openPath succeeded for ${target.path}`]);
    }
    // Folder / project — explorer shows the path in its title bar on Windows.
    const res = await electron_1.shell.openPath(target.path);
    if (res) {
        return (0, action_verifier_1.fail)(`I couldn't open the folder "${target.displayName}" — ${res}`, [`shell.openPath error: ${res}`], "open-folder-failed");
    }
    const nameVerified = await (0, action_verifier_1.windowWithTitleExists)(target.displayName);
    return (0, action_verifier_1.ok)(`Opened ${target.kind === "project" ? "the project" : "the folder"} ${target.displayName}.`, [
        `shell.openPath succeeded for ${target.path}`,
        nameVerified ? "explorer window title verified" : "window title not yet visible (opened non-blocking)",
    ]);
}
//# sourceMappingURL=file-discovery.js.map