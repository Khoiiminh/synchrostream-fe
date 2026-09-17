"use client";

import * as mediasoupClient from "mediasoup-client";
import { useEffect, useRef } from "react";

interface SfuTransportTestProps {
    mediaSessionId: string;
    participantId: string;
    signalingEndpoint: string;
    signalingToken: string;
}

export default function SfuTransportTest({
    mediaSessionId,
    participantId,
    signalingEndpoint,
    signalingToken,
}: SfuTransportTestProps) {
    const socketRef = useRef<WebSocket | null>(null);

    useEffect(() => {
        if (
            !mediaSessionId ||
            !participantId ||
            !signalingEndpoint ||
            !signalingToken
        ) {
            return;
        }

        console.log("[SFU Test] Creating mediasoup Device");

        const device = new mediasoupClient.Device();

        console.log("[SFU Test] Device created");
        console.log(
            "[SFU Test] Connecting to SFU signaling server", 
            { 
                signalingEndpoint, 
                mediaSessionId, 
                participantId, 
            }
        );

        const socket = new WebSocket(signalingEndpoint);

        socketRef.current = socket;

        socket.onopen = () => {
            console.log("[SFU Test] WebSocket connected");

            const joinRequest = {
                type: "join-signaling",
                data: {
                    token: signalingToken,
                },
            };

            console.log("[SFU Test] Sending join-signaling");

            socket.send(JSON.stringify(joinRequest));
        };

        socket.onmessage = async (event) => {
            try {
                const message = JSON.parse(event.data);

                console.log("[SFU Test] Received signaling message", message);

                if (message.type === 'join-signaling-success') {
                    console.log(
                        "[SFU Test] Successfully joined SFU signaling",
                        {
                            mediaSessionId: message.data.mediaSessionId,
                            participantId: message.data.participantId,
                        },
                    );

                    const getRtpCapabilitiesRequest = {
                        type: "get-rtp-capabilities",
                        data: {
                            mediaSessionId,
                            participantId,
                        },
                    };

                    console.log("[SFU Test] Requesting RTP capabilities");

                    socket.send(
                        JSON.stringify(getRtpCapabilitiesRequest),
                    );
                }

                if (message.type === "get-rtp-capabilities-success") {
                    console.log(
                        "[SFU Test] RTP capabilities received",
                        message.data,
                    );

                    try {
                        await device.load({
                            routerRtpCapabilities: message.data.rtpCapabilities,
                        });

                        console.log(
                            "[SFU Test] mediasoup Device loaded successfully",
                        );

                        console.log(
                            "[SFU Test] Device RTP capabilities loaded",
                            {
                                canProduceAudio: device.canProduce("audio"),
                                canProduceVideo: device.canProduce("video"),
                            },
                        );
                    } catch (error) {
                        console.error(
                            "[SFU Test] Failed to load mediasoup Device",
                            error,
                        );
                    }
                }
            } catch (error) {
                console.error(
                    "[SFU Test] WebSocket signaling error",
                    error,
                );
            }
        };

        socket.onclose = (event) => {
            console.log(
                "[SFU Test] WebSocket closed",
                {
                    code: event.code,
                    reason: event.reason,
                },
            );
        };

        return () => {
            console.log("[SFU Test] Cleaning up signaling connection");

            socket.close();

            if (socketRef.current === socket) {
                socketRef.current = null;
            }
        };
    }, [
        mediaSessionId,
        participantId,
        signalingEndpoint,
        signalingToken,
    ]);

    return (
        <div>
            <h2>SFU Transport Test</h2>
            <p>
                Check the browser console for SFU signaling activity.
            </p>
        </div>
    )
}