import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export type IngestionStep = 'idle' | 'initialize' | 'uploading_chunks' | 'finalizing' | 'success';

interface IngestionState {
    uploadStep: IngestionStep;
    chunkProgress: number;
    engineError: string | null;
    engineSuccess: string | null;
}

const initialState: IngestionState = {
    uploadStep: 'idle',
    chunkProgress: 0,
    engineError: null,
    engineSuccess: null,
};

export const ingestionSlice = createSlice({
    name: 'ingestion',
    initialState,
    reducers: {
        setUploadStep: (state, action: PayloadAction<IngestionStep>) => {
            state.uploadStep = action.payload;
        },
        setChunkProgress: (state, action: PayloadAction<number>) => {
            state.chunkProgress = action.payload;
        },
        setEngineError: (state, action: PayloadAction<string | null>) => {
            state.engineError = action.payload;
            if (action.payload) state.uploadStep = 'idle';
        },
        setEngineSuccess: (state, action: PayloadAction<string | null>) => {
            state.engineSuccess = action.payload;
            state.uploadStep = 'success';
        },
        resetIngestionEngine: (state) => {
            state.uploadStep = 'idle';
            state.chunkProgress = 0;
            state.engineError = null;
            state.engineSuccess = null;
        }
    }
});

export const { 
    setUploadStep, 
    setChunkProgress, 
    setEngineError, 
    setEngineSuccess, 
    resetIngestionEngine 
} = ingestionSlice.actions;

export default ingestionSlice.reducer;