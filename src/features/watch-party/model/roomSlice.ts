import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface ParticipantNode {
    participantId: string;
    userId: string;
    username: string;
    hasControlPrivilege: boolean;
    latencyScore: number;
}

export interface PlaybackStateSnapshot {
    playhead: number;
    status: "PLAYING" | "PAUSED";
    lastUpdated: number;
}

export interface RoomSnapshotPayload {
    roomId: string;
    roomCode: string;
    ownerId: string;
    movieId: string;
    /** Null until the room's LiveKit session is ACTIVE; pushed later via room:state_update. */
    mediaSessionId: string | null;
    playback: PlaybackStateSnapshot;
    occupancy: {
        current: number;
        max: number;
    };
    members: ParticipantNode[];
}

interface OverlayStyles {
    videoSize: number; // In pixels (e.g., width)
    videoOpacity: number; // From 0 to 1
    chatWidth: number; // In pixels
    chatHeight: number; // In pixels
}

/** Structured detail for room errors the UI can act on (e.g. offer a room switch). */
export interface RoomErrorDetail {
    code?: string;
    /** For ACTIVE_MEMBERSHIP_ELSEWHERE: the room the user is still in. */
    currentRoomCode?: string;
    /** True when the user owns that room, so leaving it closes it for everyone. */
    currentRoomIsOwned?: boolean;
}

interface RoomState {
    activeRoom: RoomSnapshotPayload | null;
    errorMessage: string | null;
    errorDetail: RoomErrorDetail | null;
    uiOptions: OverlayStyles;
}

const initialState: RoomState = {
    activeRoom: null,
    errorMessage: null,
    errorDetail: null,
    uiOptions: {
        videoSize: 120,
        videoOpacity: 0.85,
        chatWidth: 320,
        chatHeight: 400,
    },
};

export const roomSlice = createSlice({
    name: "room",
    initialState,
    reducers: {
        syncRoomState: (state, action: PayloadAction<RoomSnapshotPayload>) => {
            state.activeRoom = action.payload;
            state.errorMessage = null;
            state.errorDetail = null;
        },
        updateRoomPlayback: (
            state,
            action: PayloadAction<{
                status: "PLAYING" | "PAUSED";
                playhead: number;
                lastUpdated: number;
            }>,
        ) => {
            if (state.activeRoom) {
                state.activeRoom.playback.status = action.payload.status;
                state.activeRoom.playback.playhead = action.payload.playhead;
                state.activeRoom.playback.lastUpdated =
                    action.payload.lastUpdated;
            }
        },
        removeMember: (state, action: PayloadAction<{ userId: string }>) => {
            if (state.activeRoom) {
                state.activeRoom.members = state.activeRoom.members.filter(
                    (m) => m.userId !== action.payload.userId,
                );
                state.activeRoom.occupancy.current =
                    state.activeRoom.members.length;
            }
        },
        setRoomError: (
            state,
            action: PayloadAction<{
                message: string;
                detail?: RoomErrorDetail | null;
            }>,
        ) => {
            state.errorMessage = action.payload.message;
            state.errorDetail = action.payload.detail ?? null;
        },
        clearRoomSession: () => initialState,
        setUiStyles: (state, action: PayloadAction<Partial<OverlayStyles>>) => {
            state.uiOptions = { ...state.uiOptions, ...action.payload };
        },
    },
});

export const {
    syncRoomState,
    updateRoomPlayback,
    removeMember,
    setRoomError,
    clearRoomSession,
    setUiStyles,
} = roomSlice.actions;
export default roomSlice.reducer;
