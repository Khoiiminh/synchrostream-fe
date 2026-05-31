export interface ApiErrorResponse {
    status?: number | 'FETCH_ERROR' | 'PARSING_ERROR' | 'TIMEOUT_ERROR';
    data?: {
        success?: boolean;
        message?: string;
    };
}