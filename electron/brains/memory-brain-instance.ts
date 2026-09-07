import { MemoryBrain, StorageAdapter } from "./memory-brain";
import fs from "node:fs";
import fsPromises from "node:fs/promises";

export const fsStorage: StorageAdapter = {
  exists: (p) => fs.existsSync(p),
  read: (p) => fs.readFileSync(p, "utf8"),
  writeSync: (p, data) => fs.writeFileSync(p, data),
  writeAsync: (p, data) => fsPromises.writeFile(p, data),
};

export const memoryBrain = new MemoryBrain(fsStorage);
