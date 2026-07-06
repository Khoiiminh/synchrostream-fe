import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface PlaybackStateSnapshot {
    isPlaying: boolean;
    currentTime: number;
    driftMs: number;
    activeMediaId: string | null;
    playbackRate: number;
}

const initialState: PlaybackStateSnapshot = {
    isPlaying: false,
    currentTime: 0,
    driftMs: 0,
    activeMediaId: null,
    playbackRate: 1.0,
};

export const  playbackSlice = createSlice({
    name: 'playback',
    initialState,
    reducers: {
        updatePlaybackSnapshot: (state, action: PayloadAction<Partial<PlaybackStateSnapshot>>) => {
            return { ...state, ...action.payload };
        },

        resetPlayback: () => initialState,
    },  
});

export const { updatePlaybackSnapshot, resetPlayback } = playbackSlice.actions;
export default playbackSlice.reducer;