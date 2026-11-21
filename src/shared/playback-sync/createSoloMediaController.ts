import type { Store } from "@reduxjs/toolkit";
import { SyncEngine } from "./SyncEngine";
import { SoloSyncAdapter } from "./SoloSyncAdapter";
import { MediaSyncController } from "./MediaSyncController";

/** A controller for watching alone: the player follows only local controls. */
export function createSoloMediaController(store: Store, streamUrl: string) {
    const engine = new SyncEngine(store);

    const adapter = new SoloSyncAdapter(engine, streamUrl);

    return new MediaSyncController(adapter);
}
