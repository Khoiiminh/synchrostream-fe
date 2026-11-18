/**
 * Client-side storage for room passwords.
 *
 * Room passwords never travel in the page URL path or query string. They live
 * in two places in the browser:
 *
 * - Owned room password (localStorage, survives browser restarts): the plain
 *   password of the room this browser last created, so the owner can see and
 *   share it later. The server stores only a bcrypt hash and cannot return it.
 *   At most one entry: saving replaces any older one, and closing the room
 *   removes it.
 * - Join password (sessionStorage, one browser tab, cleared when the tab
 *   closes): the password the user entered or received to join a room, read by
 *   the party page for the join handshake and for re-joins after a refresh.
 *
 * Invite links carry the password in the URL fragment (`#pwd=...`), which the
 * browser never sends to any server. The party page moves it into the tab's
 * storage and removes it from the address bar on arrival.
 *
 * Every storage access is wrapped in try/catch: storage can be unavailable
 * (private mode, blocked site data) and the app must keep working without it.
 *
 * See docs/room-password-handling.md for the design decision.
 */
const OWNED_PREFIX = "synchrostream:room-password:";
const JOIN_PREFIX = "synchrostream:join-password:";

/**
 * Every room has its own password (no open rooms). Mirrors
 * ROOM_PASSWORD_MIN_LENGTH / MAX_LENGTH in the backend's watch-party.service.
 */
export const ROOM_PASSWORD_MIN_LENGTH = 4;
export const ROOM_PASSWORD_MAX_LENGTH = 64;

/** Room codes are exactly 6 letters or digits. */
export const ROOM_CODE_PATTERN = /^[A-Z0-9]{6}$/;

/** Name of the URL fragment (and legacy query) parameter carrying a password. */
export const PASSWORD_URL_PARAM = "pwd";

const normalizeCode = (roomCode: string) => roomCode.trim().toUpperCase();

/**
 * Saves the password of the room this browser just created, replacing any
 * other saved owner password. The server allows one active room per owner
 * (ACTIVE_OWNER_ROOM), and creating a room means the previous one was closed
 * (or closed by the confirmed leaveCurrent flow). Any older entry therefore
 * belongs to a dead room, so storage never holds more than one.
 */
export function saveOwnedRoomPassword(p: {
    roomCode: string;
    password: string;
}): void {
    try {
        const storage = window.localStorage;
        const staleKeys: string[] = [];
        for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (key?.startsWith(OWNED_PREFIX)) staleKeys.push(key);
        }
        staleKeys.forEach((key) => storage.removeItem(key));

        storage.setItem(OWNED_PREFIX + normalizeCode(p.roomCode), p.password);
    } catch {
        // Storage unavailable: the password row will say it is not saved here.
    }
}

export function loadOwnedRoomPassword(roomCode: string): string | null {
    try {
        return window.localStorage.getItem(
            OWNED_PREFIX + normalizeCode(roomCode),
        );
    } catch {
        return null;
    }
}

/** Removes the saved owner password for a room (no-op if there is none). */
export function clearOwnedRoomPassword(roomCode: string): void {
    try {
        window.localStorage.removeItem(OWNED_PREFIX + normalizeCode(roomCode));
    } catch {
        // Nothing to clear.
    }
}

export function saveJoinPassword(p: {
    roomCode: string;
    password: string;
}): void {
    try {
        window.sessionStorage.setItem(
            JOIN_PREFIX + normalizeCode(p.roomCode),
            p.password,
        );
    } catch {
        // Storage unavailable: the in-memory copy still covers this page visit.
    }
}

export function loadJoinPassword(roomCode: string): string | null {
    try {
        return window.sessionStorage.getItem(
            JOIN_PREFIX + normalizeCode(roomCode),
        );
    } catch {
        return null;
    }
}

export function clearJoinPassword(roomCode: string): void {
    try {
        window.sessionStorage.removeItem(JOIN_PREFIX + normalizeCode(roomCode));
    } catch {
        // Nothing to clear.
    }
}

/** Builds a shareable invite link; the password rides in the URL fragment. */
export function buildInviteLink(p: {
    origin: string;
    roomCode: string;
    password: string;
}): string {
    const base = `${p.origin}/party/${normalizeCode(p.roomCode)}`;
    return p.password
        ? `${base}#${PASSWORD_URL_PARAM}=${encodeURIComponent(p.password)}`
        : base;
}

/**
 * Reads a password handed over in the current URL, moves it into this tab's
 * storage and removes it from the address bar. Accepts the fragment form
 * (`#pwd=`) and, for links made before this change, the query form (`?pwd=`).
 *
 * Returns the password for this room: from the URL if one was there,
 * otherwise from this tab's storage, otherwise "".
 */
export function consumeJoinPasswordFromUrl(roomCode: string): string {
    const url = new URL(window.location.href);

    const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
    const fromFragment = fragment.get(PASSWORD_URL_PARAM);
    const fromQuery = url.searchParams.get(PASSWORD_URL_PARAM);
    const fromUrl = fromFragment ?? fromQuery;

    if (fromUrl !== null) {
        saveJoinPassword({ roomCode, password: fromUrl });

        url.searchParams.delete(PASSWORD_URL_PARAM);
        fragment.delete(PASSWORD_URL_PARAM);
        const remainingHash = fragment.toString();
        url.hash = remainingHash ? `#${remainingHash}` : "";

        // replaceState keeps the history entry, so Back does not return to the
        // password-bearing URL. Next.js App Router syncs with it.
        window.history.replaceState(window.history.state, "", url.toString());

        return fromUrl;
    }

    return loadJoinPassword(roomCode) ?? "";
}
