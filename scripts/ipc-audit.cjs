// IPC surface contract v2: extract the IPC channel constant table (shared.ts),
// then verify (a) every preload invoke/listener channel exists in the table,
// (b) every table channel is registered in main (handle/on) or is a
// main->renderer event, (c) no literal drift between preload and main.
const fs = require("fs");
const shared = fs.readFileSync("electron/shared.ts", "utf8");
const main = fs.readFileSync("electron/main.ts", "utf8");
const pre = fs.readFileSync("electron/preload.ts", "utf8");

// Channel values defined in shared.ts (IPC = { CHAT_SEND: "quip:chat-send", ... })
const defined = new Set();
for (const m of shared.matchAll(/"([^"]+)"/g)) {
  if (m[1].startsWith("quip:")) defined.add(m[1]);
}

// Every channel string referenced in main/preload — either a literal or IPC.X
const collect = (src, re) => [...new Set([...src.matchAll(re)].map(m => m[1]))];
const mainRefs = new Set([
  ...collect(main, /ipcMain\.(?:handle|on)\(\s*(?:\n\s*)?(?:IPC\.([A-Z_]+)|"([^"]+)")/gm).map(x => x),
].flatMap(x => {
  // x is [group, group] tuple from matchAll — normalize
  return [];
}));
// simpler: resolve IPC.X through the shared table
const constTable = {};
for (const m of shared.matchAll(/([A-Z_]+)\s*:\s*"([^"]+)"/g)) constTable[m[1]] = m[2];

const resolve = (name) => constTable[name] ?? name;
const mainChannels = new Set();
for (const m of main.matchAll(/ipcMain\.(?:handle|on)\(\s*(?:\n\s*)?(?:IPC\.([A-Z_]+)|"([^"]+)")/g)) {
  mainChannels.add(resolve(m[1] ?? m[2]));
}
const mainSends = new Set();
for (const m of main.matchAll(/webContents\.send\(\s*(?:\n\s*)?(?:IPC\.([A-Z_]+)|"([^"]+)")/g)) {
  mainSends.add(resolve(m[1] ?? m[2]));
}
const preInvokes = new Set();
for (const m of pre.matchAll(/ipcRenderer\.invoke\(\s*(?:\n\s*)?(?:IPC\.([A-Z_]+)|"([^"]+)")/g)) {
  preInvokes.add(resolve(m[1] ?? m[2]));
}
const preListeners = new Set();
for (const m of pre.matchAll(/ipcRenderer\.on\(\s*(?:\n\s*)?(?:IPC\.([A-Z_]+)|"([^"]+)")/g)) {
  preListeners.add(resolve(m[1] ?? m[2]));
}

const brokenInvoke = [...preInvokes].filter(c => !mainChannels.has(c));
const deadHandler = [...mainChannels].filter(c => !preInvokes.has(c) && !mainSends.has(c));
const eventNoListener = [...mainSends].filter(c => !preListeners.has(c));
const listenerNoSource = [...preListeners].filter(c => !mainSends.has(c));

console.log("defined channels:", defined.size);
console.log("main registers:", mainChannels.size, "| main sends:", mainSends.size, "| preload invokes:", preInvokes.size, "| preload listeners:", preListeners.size);
console.log("BROKEN invoke-without-handler:", JSON.stringify(brokenInvoke));
console.log("registered-but-never-called-from-preload:", JSON.stringify(deadHandler));
console.log("event-without-listener:", JSON.stringify(eventNoListener));
console.log("listener-without-sender:", JSON.stringify(listenerNoSource));
