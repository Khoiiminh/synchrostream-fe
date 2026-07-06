export interface NestResponse<T> {
    success: boolean;
    message: string;
    data: T;
    timestamp: string;
}

export interface InitiateUploadPayload {
    title: string;
    genre: string;
    description: string;
}

export interface InitiateUploadResponseData {
    movieId: string;
    uploadId: string;
    objectKey: string;
}

export interface UploadPartResponseData {
    etag: string;
}

export interface CompleteUploadPartItem {
    PartNumber: number;
    ETag: string;
}

export interface CompleteUploadPayload {
    movieId: string;
    uploadId: string;
    parts: CompleteUploadPartItem[];
}

export interface CompleteUploadResponseData {
    message: string;
    objectKey: string;
}