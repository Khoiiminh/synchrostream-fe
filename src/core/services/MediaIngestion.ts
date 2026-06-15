// src/core/engines/MediaIngestion.ts
import { AppDispatch } from '@/store';
import { 
    setUploadStep, 
    setChunkProgress, 
    setEngineError, 
    setEngineSuccess, 
    IngestionStep 
} from '@/store/slices/ingestionSlice';
import { 
    InitiateUploadPayload, 
    NestResponse, 
    InitiateUploadResponseData, 
    UploadPartResponseData, 
    CompleteUploadPayload, 
    CompleteUploadResponseData 
} from '../types/ingestion';

interface ApiError {
    data?: { message?: string };
    message?: string;
}

// Strictly map to the unwrap execution lifecycle provided by RTK-Query hooks
type RTKMutationTrigger<TRequest, TResponse> = (arg: TRequest) => {
    unwrap: () => Promise<NestResponse<TResponse>>;
};

export class MediaIngestionClient {
    private readonly CHUNK_SIZE = 6 * 1024 * 1024; // 10MB chunks

    constructor(
        private readonly dispatch: AppDispatch,
        private readonly initiateUpload: RTKMutationTrigger<InitiateUploadPayload, InitiateUploadResponseData>,
        private readonly uploadPart: RTKMutationTrigger<FormData, UploadPartResponseData>,
        private readonly completeUpload: RTKMutationTrigger<CompleteUploadPayload, CompleteUploadResponseData>
    ) {}

    public async processIngestionPipeline(payload: { title: string; genre: string; description: string; file: File }): Promise<string> {
        this.dispatch(setEngineError(null));
        this.dispatch(setEngineSuccess(null));
        this.dispatch(setUploadStep('initializing' as IngestionStep));
        this.dispatch(setChunkProgress(0));

        try {
            // Step 1: Handshake and initialize multipart session
            const initResponse = await this.initiateUpload({
                title: payload.title,
                genre: payload.genre,
                description: payload.description
            }).unwrap();

            const { movieId, uploadId } = initResponse.data;
            
            // Slices file data down by the new 6MB safely scaled chunks
            const totalChunks = Math.ceil(payload.file.size / this.CHUNK_SIZE);
            const uploadedPartsDictionary: Array<{ PartNumber: number; ETag: string }> = [];

            this.dispatch(setUploadStep('uploading_chunks' as IngestionStep));

            // Step 2: Slice and stream segments sequentially through Next.js proxy rewrite layer
            for (let index = 0; index < totalChunks; index++) {
                const startByte = index * this.CHUNK_SIZE;
                const endByte = Math.min(startByte + this.CHUNK_SIZE, payload.file.size);
                const chunkBlob = payload.file.slice(startByte, endByte);
                
                const formData = new FormData();
                formData.append('movieId', movieId);
                formData.append('uploadId', uploadId);
                formData.append('partNumber', (index + 1).toString());
                formData.append('file', new File([chunkBlob], `part-${index + 1}`));

                // This payload now registers safely at ~6.1MB, bypassing the Next.js 10MB body cap
                const uploadResponse = await this.uploadPart(formData).unwrap();
                
                uploadedPartsDictionary.push({
                    PartNumber: index + 1,
                    ETag: uploadResponse.data.etag
                });

                this.dispatch(setChunkProgress(Math.round(((index + 1) / totalChunks) * 100)));
            }

            // Step 3: Conclude upload orchestration and close transaction
            this.dispatch(setUploadStep('finalizing' as IngestionStep));
            
            await this.completeUpload({
                movieId,
                uploadId,
                parts: uploadedPartsDictionary
            }).unwrap();

            this.dispatch(setEngineSuccess(`Asset pipeline finalized. Generated ID: ${movieId}`));
            return movieId;
        } catch (error: unknown) {
            const casted = error as ApiError;
            const msg = casted?.data?.message || casted?.message || 'Transaction collapsed inside ingestion loop.';
            this.dispatch(setEngineError(msg));
            throw error;
        }
    }
}