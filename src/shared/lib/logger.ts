/**
 * Shared browser logger.
 *
 *   const log = createLogger("PlaybackCoordinator");
 *   log.debug("Drift check", { drift, tolerance });
 *   log.error("Remote play failed", { roomCode }, error);
 *
 * Output is `[Context] message` followed by any fields / error, so DevTools can
 * still expand objects.
 *
 * Levels:
 *   - development: everything is printed.
 *   - production:  warn and error are printed; debug and info are silent unless
 *                  enabled for troubleshooting from the browser console:
 *                    localStorage.debug = "*"                       // everything
 *                    localStorage.debug = "PlaybackCoordinator,Gateway*"
 *                  then reload. `localStorage.removeItem("debug")` turns it off.
 *
 * Log ids (userId, roomCode, participantId), never whole user/room objects,
 * tokens or e-mail addresses: these lines are visible to anyone with DevTools.
 */

type Level = "debug" | "info" | "warn" | "error";

export interface Logger {
    debug(message: string, ...details: unknown[]): void;
    info(message: string, ...details: unknown[]): void;
    warn(message: string, ...details: unknown[]): void;
    error(message: string, ...details: unknown[]): void;
}

const isProduction = process.env.NODE_ENV === "production";

let debugPatterns: RegExp[] | null = null;

function readDebugPatterns(): RegExp[] {
    if (debugPatterns) return debugPatterns;
    let raw = "";
    try {
        raw =
            typeof window === "undefined"
                ? ""
                : (window.localStorage.getItem("debug") ?? "");
    } catch {
        raw = "";
    }
    debugPatterns = raw
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map(
            (part) =>
                new RegExp(
                    `^${part.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
                    "i",
                ),
        );
    return debugPatterns;
}

function isVerboseEnabled(context: string): boolean {
    if (!isProduction) return true;
    return readDebugPatterns().some((pattern) => pattern.test(context));
}

export function createLogger(context: string): Logger {
    const prefix = `[${context}]`;
    const write = (level: Level, message: string, details: unknown[]) => {
        if (
            (level === "debug" || level === "info") &&
            !isVerboseEnabled(context)
        )
            return;
        // console.debug is hidden by Chrome's default filter, so debug goes to console.log.
        const sink = level === "debug" ? console.log : console[level];
        sink(`${prefix} ${message}`, ...details);
    };
    return {
        debug: (message, ...details) => write("debug", message, details),
        info: (message, ...details) => write("info", message, details),
        warn: (message, ...details) => write("warn", message, details),
        error: (message, ...details) => write("error", message, details),
    };
}
