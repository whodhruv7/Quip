"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.memoryBrain = exports.fsStorage = void 0;
const memory_brain_1 = require("./memory-brain");
const node_fs_1 = __importDefault(require("node:fs"));
const promises_1 = __importDefault(require("node:fs/promises"));
exports.fsStorage = {
    exists: (p) => node_fs_1.default.existsSync(p),
    read: (p) => node_fs_1.default.readFileSync(p, "utf8"),
    writeSync: (p, data) => node_fs_1.default.writeFileSync(p, data),
    writeAsync: (p, data) => promises_1.default.writeFile(p, data),
};
exports.memoryBrain = new memory_brain_1.MemoryBrain(exports.fsStorage);
//# sourceMappingURL=memory-brain-instance.js.map