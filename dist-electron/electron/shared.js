"use strict";
// Quip V2 — IPC channel names + shared types.
// Kept in a single file so main process and renderer stay in sync.
Object.defineProperty(exports, "__esModule", { value: true });
exports.IPC = void 0;
exports.IPC = {
    // Window movement
    MOVE_WINDOW: "quip:move-window",
    GET_WINDOW_POSITION: "quip:get-window-position",
    // Chat streaming
    CHAT_SEND: "quip:chat-send",
    CHAT_CHUNK: "quip:chat-chunk",
    CHAT_DONE: "quip:chat-done",
    CHAT_ERROR: "quip:chat-error",
    // Task execution
    TASK_EXECUTE: "quip:task-execute",
    TASK_PROGRESS: "quip:task-progress",
    CONFIRMATION_REQUEST: "quip:confirmation-request",
    CONFIRMATION_RESOLVE: "quip:confirmation-resolve",
    // Device brain
    GET_DEVICE_PROFILE: "quip:get-device-profile",
    RESCAN_DEVICE: "quip:rescan-device",
    // Spatial brain
    GET_SPATIAL_CONFIG: "quip:get-spatial-config",
    SPATIAL_CHANGE: "quip:spatial-change",
    // Environment brain
    ENVIRONMENT_CHANGE: "quip:environment-change",
    // Memory brain
    GET_MEMORIES: "quip:get-memories",
    FORGET_MEMORY: "quip:forget-memory",
    PIN_MEMORY: "quip:pin-memory",
    PRUNE_MEMORIES: "quip:prune-memories",
    // Knowledge graph
    GET_KNOWLEDGE_GRAPH: "quip:get-knowledge-graph",
    REMOVE_ENTITY: "quip:remove-entity",
    // Workspace context
    GET_WORKSPACE_CONTEXT: "quip:get-workspace-context",
    // Relationship engine (user profile / communication DNA)
    GET_USER_PROFILE: "quip:get-user-profile",
    RESET_USER_PROFILE: "quip:reset-user-profile",
    // Companion mood
    GET_COMPANION_MOOD: "quip:get-companion-mood",
    // Companion evolution
    GET_COMPANION_PROGRESSION: "quip:get-companion-progression",
    ON_COSMETIC_UNLOCK: "quip:cosmetic-unlock",
    // Model router
    GET_MODEL_STATUS: "quip:get-model-status",
    // Permission system
    GET_PERMISSIONS: "quip:get-permissions",
    UPDATE_PERMISSION: "quip:update-permission",
    // Bootstrap
    BOOTSTRAP_PROGRESS: "quip:bootstrap-progress",
    // Swarm Mode (Multi-Instance)
    SPAWN_COMPANION: "quip:spawn-companion",
    INTER_COMPANION_MSG: "quip:inter-companion-msg",
};
//# sourceMappingURL=shared.js.map