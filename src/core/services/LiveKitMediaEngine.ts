import { ParticipantMedia } from "../types/ParticipantMedia.type";
import { LocalTrack, RemoteTrack, Room, RoomEvent, Track } from "livekit-client";

export type LiveKitMediaEngineStatus = 
    | "DISCONNECTED"
    | "CONNECTING"
    | "CONNECTED"
    | "MEDIA_CONNECTED"
    | "ERROR";

export interface LiveKitMediaEngineConfig {
    mediaSessionId: string;
    participantId: string;
    serverUrl: string;
    participantToken: string;
}

type MediaListener = (participants: ParticipantMedia[]) => void;

type StatusListener = (
    status: LiveKitMediaEngineStatus,
    error?: Error,
) => void;

type LocalStreamListener = (stream: MediaStream | null) => void;

interface ParticipantTrackRecord {
    participantId: string;
    trackSid: string;
    track: MediaStreamTrack;
    kind: Track.Kind;
}

export class LiveKitMediaEngine {
    private room: Room | null = null;
    private config: LiveKitMediaEngineConfig | null = null;
    private localStream: MediaStream | null = null;
    private readonly participantStreams = new Map<string, MediaStream>();
    private readonly trackRecords = new Map<string, ParticipantTrackRecord>();
    private readonly mediaListeners = new Set<MediaListener>();
    private readonly statusListeners  = new Set<StatusListener>();
    private readonly localStreamListeners = new Set<LocalStreamListener>();
    private isCleaningUp = false;
    private isProducingLocalMedia = false;

    public getLocalParticipantId(): string | null {
        return this.config?.participantId ?? null;
    }

    public getLocalStream(): MediaStream | null {
        return this.localStream;
    }

    public getStatus(): LiveKitMediaEngineStatus {
        if (!this.room) {
            return "DISCONNECTED";
        }

        if (this.room.state === "connecting") {
            return "CONNECTING";
        }

        if (this.room.state === "connected" && this.trackRecords.size > 0) {
            return "MEDIA_CONNECTED"
        }
        
        if (this.room.state === "connected") {
            return "CONNECTED";
        }

        return "DISCONNECTED";
    }

    public onMediaUpdate(listener: MediaListener): () => void {
        this.mediaListeners.add(listener);

        listener(this.getParticipantMedia());

        return () => {
            this.mediaListeners.delete(listener);
        };
    }

    public onStatusUpdate(listener: StatusListener): () => void {
        this.statusListeners.add(listener);

        listener(this.getStatus());

        return () => {
            this.statusListeners.delete(listener);
        };
    }

    public onLocalStreamUpdate(listener: LocalStreamListener): () => void {
        this.localStreamListeners.add(listener);

        listener(this.localStream);

        return () => {
            this.localStreamListeners.delete(listener);
        };
    }

    public getParticipantMedia(): ParticipantMedia[] {
        
        return Array.from(this.participantStreams.entries())
            .map(([participantId, stream]) => {
                const hasAudio = stream.getAudioTracks().length > 0;

                const hasVideo = stream.getVideoTracks().length > 0;

                return {
                    participantId,
                    stream,
                    hasAudio,
                    hasVideo,
                };
            }
        );
    }

    public async connect(config: LiveKitMediaEngineConfig): Promise<void> {
        if (this.room) {
            return;
        }

        this.config = config;
        this.isCleaningUp = false;

        this.notifyStatus("CONNECTING");

        try {
            const room = new Room({
                adaptiveStream: true,
                dynacast: true,
            });

            this.room = room;

            this.registerRoomEvents(room);

            await room.connect(
                config.serverUrl,
                config.participantToken,
            );

            this.notifyStatus("CONNECTED");

            console.log(
                "[LiveKitMediaEngine] Connected to LiveKit room",
                {
                    mediaSessionId: config.mediaSessionId,
                    participantId: config.participantId,
                    roomName: room.name,
                },
            );
        } catch (error) {
            const normalizedError = error instanceof Error
                ? error
                : new Error(
                        "Failed to connect to LiveKit.",
                    );

            this.notifyStatus(
                "ERROR",
                normalizedError,
            );

            await this.cleanup();

            throw normalizedError;
        }
    }

    public async enableLocalMedia(): Promise<void> {
        if (this.isProducingLocalMedia) {
            return;
        }

        if (!this.room) {
            throw new Error(
                "Cannot enable local media before connecting to LiveKit.",
            );
        }

        if (this.room.state !== "connected") {
            throw new Error(
                "Cannot enable local media before the LiveKit room is connected.",
            );
        }

        this.isProducingLocalMedia = true;

        try {
            const localTracks = await this.room.localParticipant.createTracks(
                {
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: false,
                    },
                    video: true,
                },
            );

            const localStream = new MediaStream();

            for (const localTrack of localTracks) {
                localStream.addTrack(
                    localTrack.mediaStreamTrack,
                );
            }

            this.localStream = localStream;

            this.notifyLocalStreamUpdate();

            console.log(
                "[LiveKitMediaEngine] Local media created",
                {
                    streamId: localStream.id,
                    audioTracks: localStream
                        .getAudioTracks()
                        .map((track) => ({
                            id: track.id,
                            readyState: track.readyState,
                            enabled: track.enabled,
                            settings: track.getSettings(),
                        })),

                    videoTracks: localStream
                        .getVideoTracks()
                        .map((track) => ({
                            id: track.id,
                            readyState: track.readyState,
                            enabled: track.enabled,
                            settings: track.getSettings(),
                        })),
                },
            );

            for (const localTrack of localTracks) {
                await this.room.localParticipant.publishTrack(
                    localTrack,
                    {
                        source: localTrack.kind === Track.Kind.Audio
                            ? Track.Source.Microphone
                            : Track.Source.Camera,
                    },
                );
            }

            this.notifyLocalParticipantMedia();

            console.log(
                "[LiveKitMediaEngine] Local media published",
                {
                    participantId: this.config?.participantId,
                },
            );
        } catch (error) {
            this.isProducingLocalMedia = false;

            if (this.localStream) {
                this.localStream.getTracks()
                    .forEach((track) => {
                        track.stop();
                    });

                this.localStream = null;
            }

            this.notifyLocalStreamUpdate();

            throw error;
        }
    }

    public async disconnect(): Promise<void> {
        await this.cleanup();
    }

    private registerRoomEvents(room: Room): void {
        room.on(
            RoomEvent.TrackSubscribed,
            (
                track: RemoteTrack,
                publication,
                participant,
            ) => {
                this.handleRemoteTrackSubscribed(
                    track,
                    publication.trackSid,
                    participant.identity,
                );
            },
        );

        room.on(
            RoomEvent.TrackUnsubscribed,
            (
                track: RemoteTrack,
                publication,
                participant,
            ) => {
                this.handleRemoteTrackUnsubscribed(
                    track,
                    publication.trackSid,
                    participant.identity,
                );
            },
        );

        room.on(
            RoomEvent.TrackUnpublished,
            (
                publication,
                participant,
            ) => {
                this.handleRemoteTrackUnpublished(
                    publication.trackSid,
                    participant.identity,
                );
            },
        );

        room.on(
            RoomEvent.LocalTrackPublished,
            (
                publication,
                participant,
            ) => {
                this.handleLocalTrackPublished(
                    publication.trackSid,
                    publication.track,
                    participant.identity,
                );
            },
        );

        room.on(
            RoomEvent.LocalTrackUnpublished,
            (
                publication,
                participant,
            ) => {
                this.handleLocalTrackUnpublished(
                    publication.trackSid,
                    participant.identity,
                );
            },
        );

        room.on(
            RoomEvent.Disconnected,
            () => {
                if (this.isCleaningUp) {
                    return;
                }

                this.notifyStatus("DISCONNECTED");
            },
        );

        room.on(
            RoomEvent.Reconnecting,
            () => {
                this.notifyStatus("CONNECTING");
            },
        );

        room.on(
            RoomEvent.Reconnected,
            () => {
                this.notifyStatus(
                    this.trackRecords.size > 0
                        ? "MEDIA_CONNECTED"
                        : "CONNECTED",
                );
            },
        );

        room.on(
            RoomEvent.MediaDevicesError,
            (error) => {
                const normalizedError = error instanceof Error
                    ? error
                    : new Error(
                            "LiveKit media device error.",
                        );

                this.notifyStatus(
                    "ERROR",
                    normalizedError,
                );
            },
        );
    }

    private handleRemoteTrackSubscribed(
        track: RemoteTrack,
        trackSid: string,
        participantId: string,
    ): void {
        if (
            track.kind !== Track.Kind.Audio &&
            track.kind !== Track.Kind.Video
        ) {
            return;
        }

        const mediaTrack = track.mediaStreamTrack;

        if (!mediaTrack) {
            return;
        }

        this.addParticipantTrack(
            participantId,
            trackSid,
            mediaTrack,
            track.kind,
        );

        this.notifyStatus("MEDIA_CONNECTED");
    }

    private handleRemoteTrackUnsubscribed(
        track: RemoteTrack,
        trackSid: string,
        participantId: string,
    ): void {
        this.removeParticipantTrack(
            participantId,
            trackSid,
        );
    }

    private handleRemoteTrackUnpublished(
        trackSid: string,
        participantId: string,
    ): void {
        this.removeParticipantTrack(
            participantId,
            trackSid,
        );
    }

    private handleLocalTrackPublished(
        trackSid: string | undefined,
        track: LocalTrack | undefined,
        participantId: string,
    ): void {
        if (!trackSid || !track) {
            return;
        }

        if (
            track.kind !== Track.Kind.Audio &&
            track.kind !== Track.Kind.Video
        ) {
            return;
        }

        /*
         * Local media is exposed through localStream.
         *
         * The local participant's tracks are published to LiveKit,
         * but are not added to participantStreams because
         * participantStreams is reserved for remotely consumed media.
         */
    }

    private handleLocalTrackUnpublished(
        trackSid: string,
        participantId: string,
    ): void {
        this.removeParticipantTrack(
            participantId,
            trackSid,
        );
    }

    private addParticipantTrack(
        participantId: string,
        trackSid: string,
        track: MediaStreamTrack,
        kind: Track.Kind,
    ): void {
        const existingRecord = this.trackRecords.get(trackSid);

        if (existingRecord) {
            return;
        }

        let stream = this.participantStreams.get(participantId);

        if (!stream) {
            stream = new MediaStream();

            this.participantStreams.set(
                participantId,
                stream,
            );
        }

        const existingTrack = stream
            .getTracks()
            .find(
                (candidate) =>
                    candidate.id === track.id,
            );

        if (!existingTrack) {
            stream.addTrack(track);
        }

        this.trackRecords.set(
            trackSid,
            {
                participantId,
                trackSid,
                track,
                kind,
            },
        );

        this.notifyMediaUpdate();
    }

    private removeParticipantTrack(
        participantId: string,
        trackSid: string,
    ): void {
        const record = this.trackRecords.get(trackSid);

        if (!record) {
            return;
        }

        const stream = this.participantStreams.get(
            participantId,
        );

        if (stream) {
            const track = stream
                .getTracks()
                .find(
                    (candidate) => candidate.id === record.track.id,
                );

            if (track) {
                stream.removeTrack(track);
            }

            if (stream.getTracks().length === 0) {
                this.participantStreams.delete(
                    participantId,
                );
            }
        }

        this.trackRecords.delete(
            trackSid,
        );

        this.notifyMediaUpdate();

        if (
            this.trackRecords.size === 0 &&
            this.room?.state === "connected"
        ) {
            this.notifyStatus("CONNECTED");
        }
    }

    private notifyLocalParticipantMedia(): void {
        const participantId = this.config?.participantId;

        if (!participantId || !this.localStream) {
            return;
        }

        /*
         * The local participant is intentionally
         * exposed separately through localStream.
         *
         * ParticipantMedia is primarily used for
         * remote participant media.
         */
    }

    private notifyLocalStreamUpdate(): void {
        for (const listener of this.localStreamListeners) {
            listener(this.localStream);
        }
    }

    private notifyMediaUpdate(): void {
        const media = this.getParticipantMedia();

        for (const listener of this.mediaListeners) {
            listener(media);
        }
    }

    private notifyStatus(
        status: LiveKitMediaEngineStatus,
        error?: Error,
    ): void {
        for (const listener of this.statusListeners) {
            listener(status, error);
        }
    }

    private async cleanup(): Promise<void> {
        if (this.isCleaningUp) {
            return;
        }

        this.isCleaningUp = true;

        if (this.room) {
            try {
                await this.room.disconnect(
                    true,
                );
            } catch (error) {
                console.error(
                    "[LiveKitMediaEngine] Failed to disconnect room",
                    error,
                );
            }

            this.room = null;
        }

        this.trackRecords.clear();
        this.participantStreams.clear();

        if (this.localStream) {
            this.localStream.getTracks()
                .forEach((track) => {
                    track.stop();
                });

            this.localStream = null;
        }

        this.config = null;
        this.isProducingLocalMedia = false;

        this.notifyLocalStreamUpdate();
        this.notifyMediaUpdate();
        this.notifyStatus("DISCONNECTED");

        this.isCleaningUp = false;
    }
}