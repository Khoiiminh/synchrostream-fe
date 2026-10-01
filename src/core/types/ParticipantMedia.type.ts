export interface ParticipantMedia {
    participantId: string;
    stream: MediaStream;
    hasAudio: boolean;
    hasVideo: boolean;
}