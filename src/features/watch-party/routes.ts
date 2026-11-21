/*
 * Route-level entry of the watch-party slice: the room page and everything
 * it loads (LiveKit, the player, chat). Only app/party imports this, so other
 * pages never download it. Light shared pieces are in ./index.
 */
export { PartyRoom } from "./ui/PartyRoom";
