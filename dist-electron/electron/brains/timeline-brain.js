"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.timelineBrain = void 0;
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
class TimelineBrain {
    state = { events: [] };
    filePath = "";
    init(userDataDir) {
        this.filePath = node_path_1.default.join(userDataDir, "timeline.json");
        this.load();
    }
    load() {
        try {
            if (node_fs_1.default.existsSync(this.filePath)) {
                const data = JSON.parse(node_fs_1.default.readFileSync(this.filePath, "utf8"));
                if (data && Array.isArray(data.events)) {
                    this.state.events = data.events;
                }
            }
        }
        catch {
            // Start fresh
        }
    }
    save() {
        try {
            node_fs_1.default.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
        }
        catch {
            // Best effort
        }
    }
    /**
     * Log a new event into the timeline.
     */
    logEvent(event) {
        const id = Math.random().toString(36).substring(2, 9);
        this.state.events.push({ ...event, id });
        this.save();
    }
    /**
     * Retrieve upcoming events for proactive suggestions.
     */
    getUpcomingEvents(hoursLimit = 24) {
        const now = Date.now();
        const limit = now + hoursLimit * 60 * 60 * 1000;
        return this.state.events.filter((e) => e.type === "future_schedule" && e.timestamp >= now && e.timestamp <= limit);
    }
    /**
     * Get all timeline events.
     */
    getAllEvents() {
        return [...this.state.events];
    }
    /**
     * Generate a summary of today's activities.
     */
    getTodaySummary() {
        const now = Date.now();
        const startOfDay = new Date().setHours(0, 0, 0, 0);
        const todayEvents = this.state.events.filter((e) => e.timestamp >= startOfDay && e.timestamp <= now);
        if (todayEvents.length === 0)
            return "No significant activity recorded today.";
        return `Recorded ${todayEvents.length} events today.`;
    }
}
exports.timelineBrain = new TimelineBrain();
//# sourceMappingURL=timeline-brain.js.map