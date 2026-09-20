"use client";

import * as mediasoupClient from "mediasoup-client";
import { useEffect, useRef, useState } from "react";

interface SfuTransportTestProps {
    mediaSessionId: string;
    participantId: string;
    signalingEndpoint: string;
    signalingToken: string;
}

interface RemoteStream {
    producerId: string;
    participantId: string;
    kind: mediasoupClient.types.MediaKind;
    stream: MediaStream;
}

interface ProducerInfo {
    id: string;
    participantId: string;
    kind: mediasoupClient.types.MediaKind;
}

export default function SfuTransportTest({
    mediaSessionId,
    participantId,
    signalingEndpoint,
    signalingToken,
}: SfuTransportTestProps) {
    const socketRef = useRef<WebSocket | null>(null);

    const sendTransportRef = useRef<mediasoupClient.types.Transport | null>(null);

    const recvTransportRef = useRef<mediasoupClient.types.Transport | null>(null);

    const localStreamRef = useRef<MediaStream | null>(null);

    const produceCallbackRef = useRef<((response: { id: string }) => void) | null>(null);

    const produceErrbackRef = useRef<((error: Error) => void) | null>(null);

    const connectCallbacksRef = useRef(
        new Map<
            "send" | "receive",
            {
                callback: () => void;
                errback: (error: Error) => void;
            }
        >(),
    );

    const consumersRef = useRef(
        new Map<string, mediasoupClient.types.Consumer>(),
    );

    const consumingProducerIdsRef = useRef(new Set<string>());

    const remoteStreamsRef = useRef(
        new Map<string, RemoteStream>(),
    );

    const pendingProducerIdsRef = useRef<ProducerInfo[]>([]);

    const remoteAudioRefs = useRef(new Map<string, HTMLAudioElement>());

    const [remoteStreams, setRemoteStreams] = useState<RemoteStream[]>([]);

    const [status, setStatus] = useState("Disconnected");

    const [audioPlaybackBlocked, setAudioPlaybackBlocked] = useState(false);

    useEffect(() => {
        if (
            !mediaSessionId ||
            !participantId ||
            !signalingEndpoint ||
            !signalingToken
        ) {
            return;
        }

        let disposed = false;

        const consumers = consumersRef.current;
        const remoteStreams = remoteStreamsRef.current;
        const consumingProducerIds = consumingProducerIdsRef.current;
        const pendingProducerIds = pendingProducerIdsRef.current;
        const connectCallbacks = connectCallbacksRef.current;

        const device = new mediasoupClient.Device();

        console.log("[SFU Test] Creating mediasoup Device");

        const socket = new WebSocket(signalingEndpoint);

        socketRef.current = socket;

        const sendJson = (message: unknown): void => {
            if (socket.readyState !== WebSocket.OPEN) {
                throw new Error(
                    "[SFU Test] WebSocket is not open",
                );
            }

            socket.send(JSON.stringify(message));
        };

        const sendJoinSignaling = (): void => {
            console.log("[SFU Test] Sending join-signaling");

            sendJson({
                type: "join-signaling",
                data: {
                    token: signalingToken,
                },
            });
        };

        const requestRtpCapabilities = (): void => {
            console.log(
                "[SFU Test] Requesting RTP capabilities",
            );

            sendJson({
                type: "get-rtp-capabilities",
                data: {
                    mediaSessionId,
                    participantId,
                },
            });
        };

        const requestSendTransport = (): void => {
            console.log(
                "[SFU Test] Requesting send transport",
            );

            sendJson({
                type: "create-transport",
                data: {
                    mediaSessionId,
                    participantId,
                    direction: "send",
                },
            });
        };

        const requestReceiveTransport = (): void => {
            console.log(
                "[SFU Test] Requesting receive transport",
            );

            sendJson({
                type: "create-transport",
                data: {
                    mediaSessionId,
                    participantId,
                    direction: "receive",
                },
            });
        };

        const requestAvailableProducers = (): void => {
            console.log(
                "[SFU Test] Requesting available producers",
            );

            sendJson({
                type: "get-producers",
                data: {
                    mediaSessionId,
                    participantId,
                },
            });
        };

        const consumeProducer = (producer: ProducerInfo): void => {
            if (producer.participantId === participantId) {
                return;
            }

            if (consumingProducerIds.has(producer.id)) {
                console.log(
                    "[SFU Test] Producer is already being consumed",
                    {
                        producerId: producer.id,
                    },
                );

                return;
            }

            const recvTransport = recvTransportRef.current;

            if (!recvTransport) {
                console.log(
                    "[SFU Test] Receive transport is not ready. Queueing producer",
                    {
                        producerId: producer.id,
                    },
                );

                const alreadyQueued = pendingProducerIds.some(
                    (queuedProducer) =>
                        queuedProducer.id === producer.id,
                );

                if (!alreadyQueued) {
                    pendingProducerIds.push(producer);
                }

                return;
            }

            if (recvTransport.closed) {
                console.error(
                    "[SFU Test] Receive transport is closed",
                    {
                        transportId: recvTransport.id,
                    },
                );

                return;
            }

            consumingProducerIds.add(producer.id);

            console.log(
                "[SFU Test] Requesting consumer",
                {
                    producerId: producer.id,
                    participantId: producer.participantId,
                    kind: producer.kind,
                },
            );

            try {
                sendJson({
                    type: "consume",
                    data: {
                        mediaSessionId,
                        participantId,
                        producerId: producer.id,
                        rtpCapabilities: device.recvRtpCapabilities,
                    },
                });
            } catch (error) {
                consumingProducerIds.delete(
                    producer.id,
                );

                console.error(
                    "[SFU Test] Failed to request consumer",
                    error,
                );
            }
        };

        const consumePendingProducers = (): void => {
            if (!recvTransportRef.current) {
                return;
            }

            const pendingProducers = pendingProducerIds;

            pendingProducerIdsRef.current = [];

            for (const producer of pendingProducers) {
                consumeProducer(producer);
            }
        };

        const createSendTransport = (
            transportOptions: {
                id: string;
                iceParameters: mediasoupClient.types.IceParameters;
                iceCandidates: mediasoupClient.types.IceCandidate[];
                dtlsParameters: mediasoupClient.types.DtlsParameters;
            },
        ): void => {
            console.log(
                "[SFU Test] Creating browser send transport",
            );

            const sendTransport = device.createSendTransport({
                id: transportOptions.id,
                iceParameters: transportOptions.iceParameters,
                iceCandidates: transportOptions.iceCandidates,
                dtlsParameters: transportOptions.dtlsParameters,
            });

            sendTransportRef.current = sendTransport;

            console.log(
                "[SFU Test] Browser send transport created",
                {
                    transportId: sendTransport.id,
                },
            );

            sendTransport.on(
                "connect",
                (
                    { dtlsParameters },
                    callback,
                    errback,
                ) => {
                    console.log(
                        "[SFU Test] Send transport connect event",
                        {
                            transportId: sendTransport.id,
                            dtlsParameters,
                        },
                    );

                    connectCallbacks.set(
                        "send",
                        {
                            callback,
                            errback,
                        },
                    );

                    try {
                        sendJson({
                            type: "connect-transport",
                            data: {
                                mediaSessionId,
                                participantId,
                                direction: "send",
                                dtlsParameters,
                            },
                        });
                    } catch (error) {
                        connectCallbacks.delete(
                            "send",
                        );

                        errback(
                            error instanceof Error
                                ? error
                                : new Error(
                                      "Failed to connect send transport",
                                  ),
                        );
                    }
                },
            );

            sendTransport.on(
                "produce",
                (
                    {
                        kind,
                        rtpParameters,
                        appData,
                    },
                    callback,
                    errback,
                ) => {
                    console.log(
                        "[SFU Test] Send transport produce event",
                        {
                            transportId: sendTransport.id,
                            kind,
                            rtpParameters,
                            appData,
                        },
                    );

                    produceCallbackRef.current = callback;
                    produceErrbackRef.current = errback;

                    try {
                        sendJson({
                            type: "produce",
                            data: {
                                mediaSessionId,
                                participantId,
                                transportId:
                                    sendTransport.id,
                                kind,
                                rtpParameters,
                                appData,
                            },
                        });
                    } catch (error) {
                        console.error(
                            "[SFU Test] Failed to send produce",
                            error,
                        );

                        if (produceErrbackRef.current) {
                            produceErrbackRef.current(
                                error instanceof Error
                                    ? error
                                    : new Error(
                                          "Failed to send produce",
                                      ),
                            );
                        }

                        produceCallbackRef.current = null;
                        produceErrbackRef.current = null;
                    }
                },
            );
        };

        const createReceiveTransport = (
            transportOptions: {
                id: string;
                iceParameters: mediasoupClient.types.IceParameters;
                iceCandidates: mediasoupClient.types.IceCandidate[];
                dtlsParameters: mediasoupClient.types.DtlsParameters;
            },
        ): void => {
            console.log(
                "[SFU Test] Creating browser receive transport",
            );

            const recvTransport = device.createRecvTransport({
                id: transportOptions.id,
                iceParameters:transportOptions.iceParameters,
                iceCandidates: transportOptions.iceCandidates,
                dtlsParameters: transportOptions.dtlsParameters,
            });

            recvTransportRef.current = recvTransport;

            console.log(
                "[SFU Test] Browser receive transport created",
                {
                    transportId: recvTransport.id,
                },
            );

            recvTransport.on(
                "connect",
                (
                    { dtlsParameters },
                    callback,
                    errback,
                ) => {
                    console.log(
                        "[SFU Test] Receive transport connect event",
                        {
                            transportId: recvTransport.id,
                            dtlsParameters,
                        },
                    );

                    connectCallbacks.set(
                        "receive",
                        {
                            callback,
                            errback,
                        },
                    );

                    try {
                        sendJson({
                            type: "connect-transport",
                            data: {
                                mediaSessionId,
                                participantId,
                                direction: "receive",
                                dtlsParameters,
                            },
                        });
                    } catch (error) {
                        connectCallbacks.delete(
                            "receive",
                        );

                        errback(
                            error instanceof Error
                                ? error
                                : new Error(
                                      "Failed to connect receive transport",
                                  ),
                        );
                    }
                },
            );

            console.log(
                "[SFU Test] Receive transport ready",
            );

            requestAvailableProducers();

            consumePendingProducers();
        };

        const produceMicrophone = async (): Promise<void> => {
            const sendTransport = sendTransportRef.current;

            if (!sendTransport) {
                throw new Error(
                    "[SFU Test] Send transport does not exist",
                );
            }

            console.log(
                "[SFU Test] Requesting microphone access",
            );

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: false,
            });

            if (disposed) {
                stream.getTracks().forEach((track) => {
                    track.stop();
                });

                return;
            }

            localStreamRef.current = stream;

            console.log(
                "[SFU Test] Microphone access granted",
            );

            const audioTrack = stream.getAudioTracks()[0];

            if (!audioTrack) {
                throw new Error(
                    "[SFU Test] No audio track was created",
                );
            }

            console.log(
                "[SFU Test] Producing audio track",
            );

            const producer = await sendTransport.produce({
                track: audioTrack,
            });

            console.log(
                "[SFU Test] Audio producer created",
                {
                    producerId: producer.id,
                },
            );
        };

        socket.onopen = (): void => {
            console.log(
                "[SFU Test] WebSocket connected",
            );

            setStatus("Connected");

            sendJoinSignaling();
        };

        socket.onmessage = async (event): Promise<void> => {
            try {
                const message = JSON.parse(
                    event.data,
                );

                console.log(
                    "[SFU Test] Received signaling message",
                    message,
                );

                if (message.type === "join-signaling-success") {
                    console.log(
                        "[SFU Test] Successfully joined SFU signaling",
                        {
                            mediaSessionId: message.data.mediaSessionId,
                            participantId: message.data.participantId,
                        },
                    );

                    requestRtpCapabilities();

                    return;
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
                                canProduceVideo:device.canProduce("video"),
                            },
                        );

                        requestSendTransport();
                        requestReceiveTransport();
                    } catch (error) {
                        console.error(
                            "[SFU Test] Failed to load mediasoup Device",
                            error,
                        );

                        setStatus(
                            "Failed to load mediasoup Device",
                        );
                    }

                    return;
                }

                if (message.type === "create-transport-success") {
                    console.log(
                        "[SFU Test] Transport received",
                        message.data,
                    );

                    const transport = message.data.transport;

                    const direction = message.data.direction;

                    if (direction === "send") {
                        createSendTransport(
                            transport,
                        );

                        try {
                            await produceMicrophone();
                        } catch (error) {
                            console.error(
                                "[SFU Test] Failed to produce microphone",
                                error,
                            );

                            setStatus(
                                "Failed to produce microphone",
                            );
                        }

                        return;
                    }

                    if (direction === "receive") {
                        createReceiveTransport(
                            transport,
                        );

                        return;
                    }
                }

                if (message.type === "connect-transport-success") {
                    const direction = message.data.direction;

                    if (
                        direction !== "send" &&
                        direction !== "receive"
                    ) {
                        console.error(
                            "[SFU Test] Unknown transport direction",
                            direction,
                        );

                        return;
                    }

                    const pendingCallback = connectCallbacks.get( direction );

                    if (!pendingCallback) {
                        console.warn(
                            "[SFU Test] No pending connect callback",
                            {
                                direction,
                            },
                        );

                        return;
                    }

                    connectCallbacks.delete( direction );

                    console.log(
                        "[SFU Test] Transport connection accepted by SFU",
                        {
                            direction,
                        },
                    );

                    pendingCallback.callback();

                    return;
                }

                if (message.type === "produce-success") {
                    console.log(
                        "[SFU Test] Produce succeeded",
                        message.data,
                    );

                    if (!produceCallbackRef.current) {
                        console.error(
                            "[SFU Test] No produce callback is waiting",
                        );

                        return;
                    }

                    produceCallbackRef.current({ id: message.data.id });

                    produceCallbackRef.current = null;
                    produceErrbackRef.current = null;

                    return;
                }

                if (message.type === "get-producers-success") {
                    console.log(
                        "[SFU Test] Available producers received",
                        message.data,
                    );

                    const producers = message.data.producers as ProducerInfo[];

                    console.log(
                        "[SFU Test] Number of available producers",
                        producers.length,
                    );

                    for (const producer of producers) {
                        console.log(
                            "[SFU Test] Available producer",
                            {
                                producerId: producer.id,
                                participantId: producer.participantId,
                                kind: producer.kind,
                            },
                        );

                        consumeProducer(producer);
                    }

                    return;
                }

                if (message.type === "new-producer") {
                    const producer: ProducerInfo = {
                        id: message.data.producerId,
                        participantId: message.data.participantId,
                        kind: message.data.kind,
                    };

                    console.log(
                        "[SFU Test] New remote producer announced",
                        producer,
                    );

                    consumeProducer(producer);

                    return;
                }

                if (message.type === "consume-success") {
                    const response = message.data;

                    console.log(
                        "[SFU Test] Consume succeeded",
                        response,
                    );

                    const recvTransport = recvTransportRef.current;

                    if (!recvTransport) {
                        console.error(
                            "[SFU Test] Receive transport does not exist",
                        );

                        consumingProducerIds.delete(
                            response.producerId,
                        );

                        return;
                    }

                    try {
                        const consumer = await recvTransport.consume(
                            {
                                id: response.id,
                                producerId: response.producerId,
                                kind: response.kind,
                                rtpParameters: response.rtpParameters,
                            },
                        );

                        if (disposed) {
                            consumer.close();

                            return;
                        }

                        consumers.set(
                            consumer.id,
                            consumer,
                        );

                        const remoteStream = new MediaStream([ consumer.track ]);

                        const remoteStreamInfo: RemoteStream = {
                            producerId: response.producerId,
                            participantId: "unknown",
                            kind: consumer.kind,
                            stream: remoteStream,
                        };

                        remoteStreams.set(
                            consumer.id,
                            remoteStreamInfo,
                        );

                        setRemoteStreams(
                            Array.from(
                                remoteStreams.values(),
                            ),
                        );

                        console.log(
                            "[SFU Test] Browser Consumer created",
                            {
                                consumerId: consumer.id,
                                producerId: consumer.producerId,
                                kind: consumer.kind,
                                trackId: consumer.track.id,
                            },
                        );

                        consumer.on(
                            "transportclose",
                            () => {
                                console.log(
                                    "[SFU Test] Consumer transport closed",
                                    {
                                        consumerId: consumer.id,
                                    },
                                );

                                consumers.delete(
                                    consumer.id,
                                );

                                remoteStreams.delete(
                                    consumer.id,
                                );

                                setRemoteStreams(
                                    Array.from(
                                        remoteStreams.values(),
                                    ),
                                );
                            },
                        );

                        consumer.on("trackended", () => {
                            console.log(
                                "[SFU Test] Consumer track ended",
                                {
                                    consumerId: consumer.id,
                                },
                            );
                        });

                        console.log(
                            "[SFU Test] Requesting consumer resume",
                            {
                                consumerId:
                                    consumer.id,
                            },
                        );

                        sendJson({
                            type: "resume-consumer",
                            data: {
                                mediaSessionId,
                                participantId,
                                consumerId: consumer.id,
                            },
                        });
                    } catch (error) {
                        consumingProducerIds.delete(
                            response.producerId,
                        );

                        console.error(
                            "[SFU Test] Failed to create browser Consumer",
                            error,
                        );
                    }

                    return;
                }

                if (message.type === "resume-consumer-success") {
                    console.log(
                        "[SFU Test] Consumer resumed",
                        message.data,
                    );

                    setStatus("Media connected");

                    return;
                }

                if (message.type === "error") {
                    console.error(
                        "[SFU Test] SFU signaling error",
                        message.error,
                    );

                    setStatus(
                        message.error?.message ??
                            "SFU signaling error",
                    );

                    return;
                }
            } catch (error) {
                console.error(
                    "[SFU Test] WebSocket signaling error",
                    error,
                );
            }
        };

        socket.onclose = (event): void => {
            console.log(
                "[SFU Test] WebSocket closed",
                {
                    code: event.code,
                    reason: event.reason,
                },
            );

            setStatus("Disconnected");
        };

        socket.onerror = (event): void => {
            console.error(
                "[SFU Test] WebSocket error",
                event,
            );

            setStatus("WebSocket error");
        };

        return (): void => {
            disposed = true;

            console.log(
                "[SFU Test] Cleaning up SFU test resources",
            );

            for (const consumer of consumers.values()) {
                consumer.close();
            }

            consumers.clear();

            remoteStreams.clear();
            consumingProducerIds.clear();
            pendingProducerIdsRef.current = [];

            connectCallbacks.clear();

            if (localStreamRef.current) {
                for (const track of localStreamRef.current.getTracks()) {
                    track.stop();
                }

                localStreamRef.current = null;
            }

            if (sendTransportRef.current) {
                console.log(
                    "[SFU Test] Closing send transport",
                    {
                        transportId:
                            sendTransportRef.current.id,
                    },
                );

                sendTransportRef.current.close();
                sendTransportRef.current = null;
            }

            if (recvTransportRef.current) {
                console.log(
                    "[SFU Test] Closing receive transport",
                    {
                        transportId:
                            recvTransportRef.current.id,
                    },
                );

                recvTransportRef.current.close();
                recvTransportRef.current = null;
            }

            produceCallbackRef.current = null;
            produceErrbackRef.current = null;

            if (
                socket.readyState === WebSocket.OPEN ||
                socket.readyState === WebSocket.CONNECTING
            ) {
                socket.close();
            }

            if (socketRef.current === socket) {
                socketRef.current = null;
            }

            setRemoteStreams([]);
        };
    }, [
        mediaSessionId,
        participantId,
        signalingEndpoint,
        signalingToken,
    ]);

    

    const enableRemoteAudio = async (): Promise<void> => {
        const audioElements = document.querySelectorAll<HTMLAudioElement>(
            "[data-sfu-remote-audio]",
        );

        let playbackSucceeded = false;

        for (const audioElement of audioElements) {
            try {
                await audioElement.play();

                playbackSucceeded = true;
            } catch (error) {
                console.error(
                    "[SFU Test] Failed to play remote audio",
                    error,
                );
            }
        }

        if (playbackSucceeded) {
            setAudioPlaybackBlocked(false);
        }
    };

    return (
        <div>
            <h2>SFU Transport Test</h2>

            <p>
                Status: <strong>{status}</strong>
            </p>

            <p>
                Participant: {participantId}
            </p>

            <p>
                Media session: {mediaSessionId}
            </p>

            <button
                type="button"
                onClick={enableRemoteAudio}
            >
                Enable Remote Audio
            </button>

            {audioPlaybackBlocked && (
                <p>
                    Browser audio playback is waiting for user
                    interaction.
                </p>
            )}

            <div>
                <h3>Remote Media</h3>

                {remoteStreams.length === 0 && (
                    <p>
                        No remote media received yet.
                    </p>
                )}

                {remoteStreams.map((remoteStream) => (
                    <div
                        key={remoteStream.producerId}
                    >
                        <p>
                            Producer:{" "}
                            {remoteStream.producerId}
                        </p>

                        <p>
                            Kind: {remoteStream.kind}
                        </p>

                        {remoteStream.kind === "audio" && (
                            <audio
                                data-sfu-remote-audio
                                autoPlay
                                controls
                                playsInline
                                ref={(element) => {
                                    if (!element) {
                                        return;
                                    }

                                    element.srcObject =
                                        remoteStream.stream;

                                    element
                                        .play()
                                        .then(() => {
                                            setAudioPlaybackBlocked(
                                                false,
                                            );
                                        })
                                        .catch((error) => {
                                            console.warn(
                                                "[SFU Test] Browser blocked remote audio autoplay",
                                                error,
                                            );

                                            setAudioPlaybackBlocked(
                                                true,
                                            );
                                        });
                                }}
                            />
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}