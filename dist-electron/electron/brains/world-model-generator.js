"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_CANNOTDO_SUMMARY = exports.MAX_CANDO_SUMMARY = exports.SCHEMA_VERSION = void 0;
exports.generateWorldModel = generateWorldModel;
exports.SCHEMA_VERSION = 1;
exports.MAX_CANDO_SUMMARY = 8;
exports.MAX_CANNOTDO_SUMMARY = 4;
function getBrowserCapabilities(profile) {
    const canDo = [];
    const cannotDo = [];
    if (profile.browsers.length > 0) {
        canDo.push("open websites", "search the web", `open URLs in ${profile.defaultBrowser ?? "your default browser"}`);
    }
    else {
        cannotDo.push("open websites (no browser detected)");
    }
    return { canDo, cannotDo };
}
function getMediaCapabilities(profile) {
    const canDo = [];
    const cannotDo = [];
    if (profile.musicApps.length > 0 || profile.browsers.length > 0) {
        const where = profile.musicApps.some((m) => m.id === "spotify") ? "Spotify" : "YouTube";
        canDo.push(`play music and media (via ${where})`);
    }
    else {
        cannotDo.push("play media (no music app or browser detected)");
    }
    return { canDo, cannotDo };
}
function getMailCapabilities(profile) {
    const canDo = [];
    const needsPermission = [];
    if (profile.mailApps.length > 0 || profile.browsers.length > 0) {
        canDo.push("draft emails");
        needsPermission.push("send emails");
    }
    return { canDo, needsPermission };
}
function generateWorldModel(profile) {
    let canDo = [
        "have a conversation",
        "answer questions",
        "use markdown in replies",
    ];
    let needsPermission = [];
    let cannotDo = [
        "delete files without explicit confirmation",
        "make payments",
        "access passwords or private keys",
        "send messages on your behalf without approval",
    ];
    const browserCaps = getBrowserCapabilities(profile);
    canDo = canDo.concat(browserCaps.canDo);
    cannotDo = cannotDo.concat(browserCaps.cannotDo);
    const mediaCaps = getMediaCapabilities(profile);
    canDo = canDo.concat(mediaCaps.canDo);
    cannotDo = cannotDo.concat(mediaCaps.cannotDo);
    const mailCaps = getMailCapabilities(profile);
    canDo = canDo.concat(mailCaps.canDo);
    needsPermission = needsPermission.concat(mailCaps.needsPermission);
    if (profile.editors.length > 0) {
        canDo.push(`open your editor (${profile.defaultEditor ?? "code editor"})`);
    }
    canDo.push("open system settings", "open file explorer", "open the terminal", "open the calculator", "open the notes app");
    needsPermission.push("change system settings", "open sensitive apps", "compose and send emails");
    const hw = [
        `${profile.platformLabel} ${profile.osVersion}`,
        `${profile.cpuCores} cores, ${profile.totalMemoryGB}GB RAM`,
        `${profile.monitorCount} display(s) at ${profile.primaryResolution.width}x${profile.primaryResolution.height}`,
    ].join(", ");
    let canDoStr = canDo.slice(0, exports.MAX_CANDO_SUMMARY).join(", ");
    if (canDo.length > exports.MAX_CANDO_SUMMARY)
        canDoStr += " (and more)";
    let cannotDoStr = cannotDo.slice(0, exports.MAX_CANNOTDO_SUMMARY).join(", ");
    if (cannotDo.length > exports.MAX_CANNOTDO_SUMMARY)
        cannotDoStr += " (and more)";
    const summary = `You are running on: ${hw}. ` +
        `You CAN: ${canDoStr}. ` +
        `You NEED PERMISSION for: ${needsPermission.join(", ")}. ` +
        `You CANNOT: ${cannotDoStr}. ` +
        `Never claim a capability you don't have. If asked for something you cannot do, say so plainly and suggest an alternative.`;
    return {
        schemaVersion: exports.SCHEMA_VERSION,
        generatedAt: Date.now(),
        canDo,
        needsPermission,
        cannotDo,
        summary,
    };
}
//# sourceMappingURL=world-model-generator.js.map