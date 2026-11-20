import { Store } from "@reduxjs/toolkit";
import { SyncEngine } from "@/shared/playback-sync/SyncEngine";
import { SoloSyncAdapter } from "@/shared/playback-sync/SoloSyncAdapter";
import { MediaSyncController } from "@/shared/playback-sync/MediaSyncController";
import { WatchPartyGatewayEngine } from "../services/WatchPartyGatewayEngine";
import { PartySyncAdapter } from "./PartySyncAdapter";
import { RemotePlaybackGuard } from "@/shared/playback-sync/RemotePlaybackGuard";

export function createSoloMediaController(store: Store, streamUrl: string) {
    const engine = new SyncEngine(store);

    const adapter = new SoloSyncAdapter(engine, streamUrl);

    return new MediaSyncController(adapter);
}

export function createPartyMediaController(
    store: Store,
    gateway: WatchPartyGatewayEngine,
    options: {
        streamUrl: string;
        roomId: string;
        roomCode: string;
        userId: string;
        ownerId: string;
    },
) {
    const engine = new SyncEngine(store);
    const remotePlaybackGuard = new RemotePlaybackGuard();

    const adapter = new PartySyncAdapter(
        engine,
        gateway,
        options.streamUrl,
        options.roomId,
        options.roomCode,
        options.userId,
        options.ownerId,
        remotePlaybackGuard,
    );

    return new MediaSyncController(adapter);
}
