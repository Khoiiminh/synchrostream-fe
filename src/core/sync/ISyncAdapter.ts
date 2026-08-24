/**
 * The operations that UI needs
 */
export interface QualityLevel {
  index: number;
  height: number;
  bitrate: number;
  name: string;
}

export interface ISyncAdapter {
    play(): Promise<void>;
    pause(): Promise<void>;
    seek(seconds: number): void;

    attachVideo(element: HTMLVideoElement):void;
    detachVideo(): void;

    dispose(): void;

    getCurrentTime(): number;
    getQualityLevels(): QualityLevel[];
    getCurrentQualityIndex(): number;
    setQualityLevel(level: number): void;
}

