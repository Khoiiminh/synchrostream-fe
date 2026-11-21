import { useEffect, useState, type RefObject } from "react";
import type {
    LiveKitMediaEngine,
    LiveKitMediaEngineStatus,
} from "../engine/LiveKitMediaEngine";

const PUSH_TO_TALK_KEY = "KeyV";

/**
 * Push-to-talk. The microphone is open only while the talk key or button is
 * held: a browser tab that holds the mic gets its playback (the movie)
 * lowered by Windows, so an always-open mic would break the movie.
 */
export function usePushToTalk(
    engineRef: RefObject<LiveKitMediaEngine | null>,
    liveKitStatus: LiveKitMediaEngineStatus,
) {
    const [isTalkHeld, setIsTalkHeld] = useState(false);

    // Apply the held state to the engine.
    const canTalk =
        liveKitStatus === "CONNECTED" || liveKitStatus === "MEDIA_CONNECTED";

    useEffect(() => {
        const engine = engineRef.current;

        if (!engine) {
            return;
        }

        void engine.setMicrophoneActive(isTalkHeld && canTalk);
    }, [isTalkHeld, canTalk, engineRef]);

    // Hold V anywhere except while typing (e.g. in chat).
    useEffect(() => {
        const isTypingTarget = (target: EventTarget | null) => {
            const element = target as HTMLElement | null;

            return (
                !!element &&
                (element.isContentEditable ||
                    element.tagName === "INPUT" ||
                    element.tagName === "TEXTAREA" ||
                    element.tagName === "SELECT")
            );
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (
                event.code !== PUSH_TO_TALK_KEY ||
                event.repeat ||
                isTypingTarget(event.target)
            ) {
                return;
            }

            if (event.ctrlKey || event.metaKey || event.altKey) {
                return;
            }

            event.preventDefault();
            setIsTalkHeld(true);
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.code === PUSH_TO_TALK_KEY) {
                setIsTalkHeld(false);
            }
        };

        // A key-up is never delivered if focus leaves the page mid-press.
        const release = () => setIsTalkHeld(false);
        const handleVisibilityChange = () => {
            if (document.visibilityState !== "visible") release();
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        window.addEventListener("blur", release);
        document.addEventListener("visibilitychange", handleVisibilityChange);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
            window.removeEventListener("blur", release);
            document.removeEventListener(
                "visibilitychange",
                handleVisibilityChange,
            );
        };
    }, []);

    return { isTalkHeld, setIsTalkHeld, canTalk };
}
