"use client";

/*
 * Public API of the watch-party slice. Code outside src/features/watch-party
 * imports only from here (the lint rule forbids deep imports).
 *
 * "use client": the root layout (a server component) imports EngineProvider
 * from here, and this file also re-exports RTK Query APIs whose modules call
 * React context APIs. As a client boundary, server code receives references
 * instead of evaluating those modules; client code gets the real values.
 */

// The room page and the app-wide engine provider.
export { PartyRoom } from "./ui/PartyRoom";
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
