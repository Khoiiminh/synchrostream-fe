"use client";

/*
 * Public API of the watch-party slice. Code outside src/features/watch-party
 * imports only from here or, for the route's page component, from ./routes
 * (the lint rule forbids other deep imports). This entry stays light: the
 * root layout and the navbar load it on every page, so it must not pull in
 * the room UI or LiveKit.
 *
 * "use client": the root layout (a server component) imports EngineProvider
 * from here, and this file also re-exports RTK Query APIs whose modules call
 * React context APIs. As a client boundary, server code receives references
 * instead of evaluating those modules; client code gets the real values.
 */

// The app-wide gateway engine provider.
export { EngineProvider } from "./engine/EngineContext";

// Store wiring (src/store/index.ts).
export { default as roomReducer } from "./model/roomSlice";
export { watchPartyApi, useCreateRoomMutation } from "./api/watchPartyApi";
export { mediaSessionApi } from "./api/mediaSessionApi";

// Room codes and passwords, used by the catalog's create modal and the
// navbar's join modal.
export {
    ROOM_CODE_PATTERN,
    ROOM_PASSWORD_MAX_LENGTH,
    ROOM_PASSWORD_MIN_LENGTH,
    saveJoinPassword,
    saveOwnedRoomPassword,
} from "./model/roomAccessKeys";
