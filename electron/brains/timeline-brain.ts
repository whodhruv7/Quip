import { app } from "electron";
import path from "node:path";
import fs from "node:fs";

// -----------------------------------------------------------------------------
// Timeline Brain (Phase 2 Scaffolding)
// Tracks past, present, and future events for deep personalization.
// -----------------------------------------------------------------------------

export interface TimelineEvent {
  id: string;
  title: string;
  type: "past_reflection" | "present_activity" | "future_schedule";
  timestamp: number;
  durationMs?: number;
  metadata?: Record<string, any>;
}

export interface TimelineState {
  events: TimelineEvent[];
}

class TimelineBrain {
  private state: TimelineState = { events: [] };
  private filePath: string = "";

  init(userDataDir: string) {
    this.filePath = path.join(userDataDir, "timeline.json");
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
        if (data && Array.isArray(data.events)) {
          this.state.events = data.events;
        }
      }
    } catch {
      // Start fresh
    }
  }

  private save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
    } catch {
      // Best effort
    }
  }

  /**
   * Log a new event into the timeline.
   */
  logEvent(event: Omit<TimelineEvent, "id">) {
    const id = Math.random().toString(36).substring(2, 9);
    this.state.events.push({ ...event, id });
    this.save();
  }

  /**
   * Retrieve upcoming events for proactive suggestions.
   */
  getUpcomingEvents(hoursLimit: number = 24): TimelineEvent[] {
    const now = Date.now();
    const limit = now + hoursLimit * 60 * 60 * 1000;
    return this.state.events.filter(
      (e) => e.type === "future_schedule" && e.timestamp >= now && e.timestamp <= limit
    );
  }

  /**
   * Get all timeline events.
   */
  getAllEvents(): TimelineEvent[] {
    return [...this.state.events];
  }

  /**
   * Generate a summary of today's activities.
   */
  getTodaySummary(): string {
    const now = Date.now();
    const startOfDay = new Date().setHours(0, 0, 0, 0);
    const todayEvents = this.state.events.filter(
      (e) => e.timestamp >= startOfDay && e.timestamp <= now
    );
    
    if (todayEvents.length === 0) return "No significant activity recorded today.";
    return `Recorded ${todayEvents.length} events today.`;
  }
}

export const timelineBrain = new TimelineBrain();
