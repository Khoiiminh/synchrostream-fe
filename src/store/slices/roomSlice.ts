import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface ParticipantNode {
  participantId: string;
  userId: string;
  username: string;
  rtcIdentity: string;
  hasControlPrivilege: boolean;
  latencyScore: number;
}

export interface PlaybackStateSnapshot {
  playhead: number;
  status: 'PLAYING' | 'PAUSED';
  lastUpdated: number;
}

export interface RoomSnapshotPayload {
  roomId: string;
  roomCode: string;
  passwordPlain: string;
  ownerId: string;
  movieId: string; 
  playback: PlaybackStateSnapshot;
  occupancy: {
    current: number;
    max: number;
  };
  members: ParticipantNode[];
}

interface OverlayStyles {
  videoSize: number;       // In pixels (e.g., width)
  videoOpacity: number;    // From 0 to 1
  chatWidth: number;       // In pixels
  chatHeight: number;      // In pixels
}

interface RoomState {
  activeRoom: RoomSnapshotPayload | null;
  errorMessage: string | null;
  uiOptions: OverlayStyles;
}

const initialState: RoomState = {
  activeRoom: null,
  errorMessage: null,
  uiOptions: {
    videoSize: 120,
    videoOpacity: 0.85,
    chatWidth: 320,
    chatHeight: 400
  }
};

export const roomSlice = createSlice({
  name: 'room',
  initialState,
  reducers: {
    syncRoomState: (state, action: PayloadAction<RoomSnapshotPayload>) => {
      state.activeRoom = action.payload;
      state.errorMessage = null;
    },
    updateRoomPlayback: (state, action: PayloadAction<{ status: 'PLAYING' | 'PAUSED'; playhead: number; lastUpdated: number }>) => {
      if (state.activeRoom) {
        state.activeRoom.playback.status = action.payload.status;
        state.activeRoom.playback.playhead = action.payload.playhead;
        state.activeRoom.playback.lastUpdated = action.payload.lastUpdated;
      }
    },
    removeMember: (state, action: PayloadAction<{ userId: string }>) => {
      if (state.activeRoom) {
        state.activeRoom.members = state.activeRoom.members.filter(
          (m) => m.userId !== action.payload.userId
        );
        state.activeRoom.occupancy.current = state.activeRoom.members.length;
      }
    },
    setRoomError: (state, action: PayloadAction<{ message: string }>) => {
      state.errorMessage = action.payload.message;
    },
    clearRoomSession: () => initialState,
    setUiStyles: (state, action: PayloadAction<Partial<OverlayStyles>>) => {
      state.uiOptions = { ...state.uiOptions, ...action.payload };
    },
  },
});

export const { syncRoomState, updateRoomPlayback, removeMember, setRoomError, clearRoomSession, setUiStyles } = roomSlice.actions;
export default roomSlice.reducer;