import * as mediasoupClient from "mediasoup-client";

export interface SfuMediaEngineConfig {
    mediaSessionId: string;
    participantId: string;
    signalingEndpoint: string;
    signalingToken: string;
}

export interface ParticipantMedia {
  participantId: string;
  stream: MediaStream;
  hasAudio: boolean;
  hasVideo: boolean;
}

export type SfuMediaEngineStatus =
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "MEDIA_CONNECTED"
  | "ERROR";

interface ProducerInfo {
  id: string;
  participantId: string;
  kind: mediasoupClient.types.MediaKind;
}

interface ConsumerRecord {
  consumer: mediasoupClient.types.Consumer;
  participantId: string;
  producerId: string;
  kind: mediasoupClient.types.MediaKind;
}

interface ConnectCallback {
  resolve: () => void;
  reject: (error: Error) => void;
}

interface ProduceCallback {
  resolve: (producerId: string) => void;
  reject: (error: Error) => void;
}

type MediaListener = (participants: ParticipantMedia[]) => void;
type StatusListener = (status: SfuMediaEngineStatus, error?: Error) => void;

type TransportDirection = "send" | "receive";
type CreateTransportData = {
    direction: TransportDirection;
    transport: {
        id: string;
        iceParameters: mediasoupClient.types.IceParameters;
        iceCandidates: mediasoupClient.types.IceCandidate[];
        dtlsParameters: mediasoupClient.types.DtlsParameters;
    };
};

type SendTransportData = CreateTransportData & {
    direction: "send";
}

type ReceiveTransport = CreateTransportData & {
    direction: "receive";
}

type ConsumeData = {
    id: string;
    producerId: string;
    kind: mediasoupClient.types.MediaKind;
    rtpParameters: mediasoupClient.types.RtpParameters;
}

interface JoinSignalingSuccessMessage {
    type: "join-signaling-success";
}

interface GetRtpCapabilitiesSuccessMessage {
    type: "get-rtp-capabilities-success";
    data: {
        rtpCapabilities: mediasoupClient.types.RtpCapabilities;
    };
}

interface CreateTransportSuccessMessage {
    type: "create-transport-success";
    data: CreateTransportData;
}

interface ConnectTransportSuccessMessage {
    type: "connect-transport-success";
    data: {
        direction: TransportDirection;
    };
}

interface ProduceSuccessMessage {
    type: "produce-success";
    data: {
        producerId: string;
    };
}

interface GetProducersSuccessMessage {
    type: "get-producers-success";
    data: {
        producers: ProducerInfo[];
    };
}

interface NewProducerMessage {
    type: "new-producer";
    data: ProducerInfo;
}

interface ConsumeSuccessMessage {
    type: "consume-success";
    data: ConsumeData;
}

interface ResumeConsumerSuccessMessage {
    type: "resume-consumer-success";
}

interface SignalingErrorMessage {
    type: "error";
    data: {
        message?: string;
    };
}

type SignalingMessage =   
    | JoinSignalingSuccessMessage
    | GetRtpCapabilitiesSuccessMessage
    | CreateTransportSuccessMessage
    | ConnectTransportSuccessMessage
    | ProduceSuccessMessage
    | GetProducersSuccessMessage
    | NewProducerMessage
    | ConsumeSuccessMessage
    | ResumeConsumerSuccessMessage
    | SignalingErrorMessage;

export class SfuMediaEngine {
  private socket: WebSocket | null = null;
  private device: mediasoupClient.types.Device | null = null;

  private sendTransport: mediasoupClient.types.Transport | null = null;
  private recvTransport: mediasoupClient.types.Transport | null = null;

  private localStream: MediaStream | null = null;

  private readonly consumers = new Map<string, ConsumerRecord>();
  private readonly producerInfos = new Map<string, ProducerInfo>();
  private readonly consumingProducerIds = new Set<string>();
  private readonly pendingProducerIds = new Set<string>();

  private readonly participantStreams = new Map<string, MediaStream>();

  private readonly connectCallbacks = new Map<"send" | "receive", ConnectCallback>();

  private readonly produceCallbacks: ProduceCallback[] = [];

  private readonly mediaListeners = new Set<MediaListener>();
  private readonly statusListeners = new Set<StatusListener>();

  private config: SfuMediaEngineConfig | null = null;

  private isCleaningUp = false;
  private isProducingLocalMedia = false;

  public getLocalParticipantId(): string | null {
    return this.config?.participantId ?? null;
  }

  public getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  public getStatus(): SfuMediaEngineStatus {
    if (!this.socket) {
      return "DISCONNECTED";
    }

    if (this.socket.readyState === WebSocket.CONNECTING) {
      return "CONNECTING";
    }

    if (this.socket.readyState === WebSocket.OPEN) {
      return this.consumers.size > 0
        ? "MEDIA_CONNECTED"
        : "CONNECTED";
    }

    return "DISCONNECTED";
  }

  public onMediaUpdate(listener: MediaListener): () => void {
    this.mediaListeners.add(listener);

    listener(this.getParticipantMedia());

    return () => {
      this.mediaListeners.delete(listener);
    };
  }

  public onStatusUpdate(listener: StatusListener): () => void {
    this.statusListeners.add(listener);

    listener(this.getStatus());

    return () => {
      this.statusListeners.delete(listener);
    };
  }

  public getParticipantMedia(): ParticipantMedia[] {
    return Array.from(this.participantStreams.entries()).map(
      ([participantId, stream]) => {
        const hasAudio = stream.getAudioTracks().length > 0;
        const hasVideo = stream.getVideoTracks().length > 0;

        return {
          participantId,
          stream,
          hasAudio,
          hasVideo,
        };
      },
    );
  }

  public async connect(config: SfuMediaEngineConfig): Promise<void> {
    if (this.socket) {
      return;
    }

    this.config = config;
    this.isCleaningUp = false;

    this.notifyStatus("CONNECTING");

    try {
      this.device = new mediasoupClient.Device();

      await this.openSocket();

      this.sendJson({
        type: "join-signaling",
        data: {
          token: config.signalingToken,
        },
      });

      this.notifyStatus("CONNECTED");

    } catch (error) {

      const normalizedError = error instanceof Error
        ? error
        : new Error("Failed to connect to SFU");

      this.notifyStatus("ERROR", normalizedError);

      await this.cleanup();

      throw normalizedError;
    }
  }

  public async disconnect(): Promise<void> {
    await this.cleanup();
  }

  public async enableLocalMedia(): Promise<void> {
    if (this.isProducingLocalMedia) {
      return;
    }

    if (!this.sendTransport) {
      throw new Error(
        "Cannot enable local media before the send transport is ready.",
      );
    }

    this.isProducingLocalMedia = true;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });

      this.localStream = stream;

      const audioTrack = stream.getAudioTracks()[0];

      if (audioTrack) {
        await this.produceTrack(audioTrack);
      }

      const videoTrack = stream.getVideoTracks()[0];

      if (videoTrack) {
        await this.produceTrack(videoTrack);
      }
    } catch (error) {
      this.isProducingLocalMedia = false;

      if (this.localStream) {
        this.localStream.getTracks().forEach((track) => {
          track.stop();
        });

        this.localStream = null;
      }

      throw error;
    }
  }

  private async produceTrack(track: MediaStreamTrack): Promise<void> {
    if (!this.sendTransport) {
      throw new Error("Send transport is not available.");
    }

    await new Promise<void>((resolve, reject) => {
      this.sendTransport?.produce({
        track,

        appData: {
          mediaSessionId: this.config?.mediaSessionId,
          participantId: this.config?.participantId,
        },

        codecOptions:
          track.kind === "audio"
            ? {
                opusStereo: true,
                opusDtx: true,
              }
            : undefined,

        encodings:
          track.kind === "video"
            ? [
                {
                  maxBitrate: 1_500_000,
                },
              ]
            : undefined,

        codec:
          undefined,

        // mediasoup resolves the actual Producer through
        // the transport's "produce" callback.
      }).then(() => {
        resolve();
      }).catch((error) => {
        reject(error);
      });
    });
  }

  private async openSocket(): Promise<void> {
    const config = this.config;

    if (!config) {
        throw new Error("SFU configuration is missing.");
    }

    await new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(
            config.signalingEndpoint,
        );

        this.socket = socket;

        let settled = false;

        socket.onopen = () => {
            if (!settled) {
            settled = true;
            resolve();
            }
        };

        socket.onerror = () => {
            const error = new Error(
            "SFU signaling WebSocket connection failed.",
            );

            if (!settled) {
            settled = true;
            reject(error);
            }

            this.notifyStatus("ERROR", error);
        };

        socket.onclose = () => {
            if (!settled) {
            settled = true;

            reject(
                new Error(
                "SFU signaling WebSocket closed before connection completed.",
                ),
            );
            }

            if (!this.isCleaningUp) {
            this.notifyStatus("DISCONNECTED");
            }
        };

        socket.onmessage = (event) => {
            this.handleMessage(event);
        };
    });
  }

  private handleMessage(event: MessageEvent): void {
        let message: SignalingMessage;

        try {
            message = JSON.parse(event.data);
        } catch (error) {
            console.error(
                "[SfuMediaEngine] Invalid signaling message",
                error,
            );

        return;
        }

        void this.handleSignalingMessage(message);
  }

  private async handleSignalingMessage(message:SignalingMessage): Promise<void> {
        const messType = message.type;

        try {
            switch (messType) {
                    case "join-signaling-success": {
                    await this.requestRtpCapabilities();
                    break;
                }

                case "get-rtp-capabilities-success": {
                    await this.handleRtpCapabilities(
                        message.data,
                    );
                    break;
                }

                case "create-transport-success": {

                    console.log(
                        "[SfuMediaEngine] RAW CREATE TRANSPORT SUCCESS",
                        JSON.stringify(message, null, 2),
                    );

                    await this.handleCreateTransportSuccess(
                        message.data,
                    );
                    break;
                }

                case "connect-transport-success": {
                    this.handleConnectTransportSuccess(
                        message.data,
                    );
                    break;
                }

                case "produce-success": {
                    this.handleProduceSuccess(message.data);
                    break;
                }

                case "get-producers-success": {
                    await this.handleGetProducersSuccess(
                        message.data,
                    );
                    break;
                }

                case "new-producer": {
                    await this.handleNewProducer(message.data);
                    break;
                }

                case "consume-success": {
                    console.log(
                        "[SfuMediaEngine] RAW CONSUME SUCCESS",
                        JSON.stringify(message, null, 2),
                    );

                    await this.handleConsumeSuccess(message.data);
                        break;
                }

                case "resume-consumer-success": {
                    this.notifyStatus("MEDIA_CONNECTED");
                        break;  
                }

                case "error": {
                    console.error(
                        "[SfuMediaEngine] RAW SFU ERROR",
                        JSON.stringify(message, null, 2),
                    );

                    const error = new Error(
                        message.data?.message ||
                        "SFU signaling error.",
                    );

                    this.notifyStatus("ERROR", error);
                    break;
                }

                default:
                    console.debug(
                        "[SfuMediaEngine] Ignoring signaling message",
                        messType,
                    );
        }
        } catch (error) {

            const normalizedError = error instanceof Error
                ? error
                : new Error("SFU signaling operation failed.");

            console.error(
                "[SfuMediaEngine] Signaling handling failed",
                normalizedError,
            );

            this.notifyStatus(
                "ERROR",
                normalizedError,
            );
        }
  }

  private async requestRtpCapabilities(): Promise<void> {
        if (!this.config) {
            throw new Error("SFU configuration is missing.");
        }

        this.sendJson({
            type: "get-rtp-capabilities",
            data: {
                mediaSessionId: this.config.mediaSessionId,
                participantId: this.config.participantId,
            },
        });
  }

  private async handleRtpCapabilities(
    data: {
      rtpCapabilities: mediasoupClient.types.RtpCapabilities;
    },
  ): Promise<void> {
        if (!this.device) {
            throw new Error("mediasoup Device is not initialized.");
        }

        await this.device.load({
            routerRtpCapabilities: data.rtpCapabilities,
        });

        console.log(
            "[SfuMediaEngine] Device capabilities",
            {
                audio: this.device.canProduce("audio"),
                video: this.device.canProduce("video"),
            },
        );

        await this.requestTransport("send");
        await this.requestTransport("receive");
  }

  private async requestTransport(direction: TransportDirection): Promise<void> {
        if (!this.config) {
            throw new Error("SFU configuration is missing.");
        }

        this.sendJson({
            type: "create-transport",
            data: {
                mediaSessionId: this.config.mediaSessionId,
                participantId: this.config.participantId,
                direction,
            },
        });
  }

  private async handleCreateTransportSuccess(data: CreateTransportData): Promise<void> {
        if (!this.device) {
            throw new Error("mediasoup Device is not initialized.");
        }

        if (data.direction === "send") {
            await this.createSendTransport({
                direction: "send",
                transport: {
                    id: data.transport.id,
                    iceParameters: data.transport.iceParameters,
                    iceCandidates: data.transport.iceCandidates,
                    dtlsParameters: data.transport.dtlsParameters,
                }
            });
            return;
        }

        await this.createReceiveTransport({
            direction: "receive",
            transport: {
                id: data.transport.id,
                iceParameters: data.transport.iceParameters,
                iceCandidates: data.transport.iceCandidates,
                dtlsParameters: data.transport.dtlsParameters,
            }
        });
  }

  private async createSendTransport(data: SendTransportData): Promise<void> {
        if (this.sendTransport) {
            return;
        }

        this.sendTransport = this.device!.createSendTransport({
            id: data.transport.id,
            iceParameters: data.transport.iceParameters,
            iceCandidates: data.transport.iceCandidates,
            dtlsParameters: data.transport.dtlsParameters,
        });

        this.sendTransport.on(
            "connect",
            ({ dtlsParameters }, callback, errback) => {
                this.connectCallbacks.set("send", {
                    resolve: callback,
                    reject: errback,
                });

                this.sendJson({
                    type: "connect-transport",
                    data: {
                        mediaSessionId: this.config!.mediaSessionId,
                        participantId: this.config!.participantId,
                        direction: "send",
                        id: this.sendTransport!.id,
                        dtlsParameters,
                    },
                });
            },
        );

        this.sendTransport.on(
            "produce",
            ({
                kind,
                rtpParameters,
                appData,
            }, callback, errback) => {
                this.produceCallbacks.push({
                    resolve: (producerId: string) => {
                        callback({ id: producerId });
                    },
                    reject: errback,
                });

                this.sendJson({
                    type: "produce",
                    data: {
                        mediaSessionId: this.config!.mediaSessionId,
                        participantId: this.config!.participantId,
                        transportId: this.sendTransport!.id,
                        kind,
                        rtpParameters,
                        appData,
                    },
                });
            },
        );

        await this.enableLocalMedia();
  }

  private async createReceiveTransport(data: ReceiveTransport): Promise<void> {
        if (this.recvTransport) {
            return;
        }

        this.recvTransport = this.device!.createRecvTransport({
            id: data.transport.id,
            iceParameters: data.transport.iceParameters,
            iceCandidates: data.transport.iceCandidates,
            dtlsParameters: data.transport.dtlsParameters,
        });

        this.recvTransport.on(
            "connect",
            ({
                dtlsParameters,
            }, callback, errback) => {
                this.connectCallbacks.set("receive", {
                    resolve: callback,
                    reject: errback,
                });

                this.sendJson({
                    type: "connect-transport",
                    data: {
                        mediaSessionId:
                        this.config!.mediaSessionId,
                        participantId:
                        this.config!.participantId,
                        direction: "receive",
                        transportId:
                        this.recvTransport!.id,
                        dtlsParameters,
                    },
                });
            },
        );

        await this.requestAvailableProducers();

        for (const producerId of this.pendingProducerIds) {
            await this.consumeProducer(producerId);
        }

        this.pendingProducerIds.clear();
  }

  private async requestAvailableProducers(): Promise<void> {
        if (!this.config) {
            throw new Error("SFU configuration is missing.");
        }

        this.sendJson({
            type: "get-producers",
            data: {
                mediaSessionId: this.config.mediaSessionId,
                participantId: this.config.participantId,
            },
        });
  }

  private async handleGetProducersSuccess(
    data: {
      producers: ProducerInfo[];
    },
  ): Promise<void> {
        for (const producer of data.producers) {
            this.producerInfos.set(
                producer.id,
                producer,
            );

            if ( producer.participantId === this.config?.participantId ) {
                continue;
            }

            await this.consumeProducer(producer.id);
        }
  }

  private async handleNewProducer(
    data: ProducerInfo,
  ): Promise<void> {
        this.producerInfos.set(
            data.id,
            data,
        );

        if ( data.participantId === this.config?.participantId) {
            return;
        }

        if (!this.recvTransport) {
            this.pendingProducerIds.add(data.id);
            return;
        }

        await this.consumeProducer(data.id);
  }

  private async consumeProducer(
    producerId: string,
  ): Promise<void> {
        if (!this.recvTransport) {
            this.pendingProducerIds.add(producerId);
            return;
        }

        if (this.consumingProducerIds.has(producerId)) {
            return;
        }

        const producer = this.producerInfos.get(producerId);

        if (!producer) {
            return;
        }

        if (producer.participantId === this.config?.participantId) {
            return;
        }

        this.consumingProducerIds.add(producerId);

        try {
            this.sendJson({
                type: "consume",
                data: {
                    mediaSessionId: this.config!.mediaSessionId,
                    participantId: this.config!.participantId,
                    producerId,
                    transportId: this.recvTransport.id,
                    rtpCapabilities: this.device!.recvRtpCapabilities,
                },
            });
        } catch (error) {
            this.consumingProducerIds.delete(
                producerId,
            );

            throw error;
        }
  }

  private async handleConsumeSuccess(data: ConsumeData): Promise<void> {
        if (!this.recvTransport) {
            return;
        }

        const consumer = await this.recvTransport.consume({
            id: data.id,
            producerId: data.producerId,
            kind: data.kind,
            rtpParameters: data.rtpParameters,
        });

        const participantId =  this.producerInfos.get( data.producerId )?.participantId;

        if (!participantId) {
            consumer.close();

            this.consumingProducerIds.delete(
                data.producerId,
            );

            return;
        }

        this.consumers.set(
            data.id,
            {
                consumer,
                participantId,
                producerId: data.producerId,
                kind: data.kind,
            },
        );

        this.addConsumerTrack(
            participantId,
            consumer.track,
            );

            consumer.on(
            "transportclose",
            () => {
                this.removeConsumer(
                data.id,
                );
            },
        );

        consumer.on(
            "@close",
            () => {
                this.removeConsumer(
                data.id,
                );

                this.consumingProducerIds.delete(
                data.producerId,
                );
            },
        );

        consumer.on(
            "trackended",
            () => {
                this.removeConsumer(
                data.id,
                );
            },
        );

        this.sendJson({
            type: "resume-consumer",
            data: {
                mediaSessionId:
                this.config!.mediaSessionId,
                participantId:
                this.config!.participantId,
                consumerId: data.id,
            },
        });
  }

  private addConsumerTrack(
        participantId: string,
        track: MediaStreamTrack,
  ): void {
        let stream = this.participantStreams.get(
            participantId,
        );

        if (!stream) {
            stream = new MediaStream();

            this.participantStreams.set(
                participantId,
                stream,
            );
        }

        const alreadyExists = stream
            .getTracks()
            .some( (existingTrack) => existingTrack.id === track.id );

        if (!alreadyExists) {
            stream.addTrack(track);
        }

        this.notifyMediaUpdate();
  }

  private removeConsumer(consumerId: string): void {
        const record = this.consumers.get(consumerId);

        if (!record) {
            return;
        }

        record.consumer.close();

        const stream = this.participantStreams.get(
            record.participantId,
        );

        if (stream) {
            const track = stream
                .getTracks()
                .find( (candidate) => candidate.id ===  record.consumer.track.id );

            if (track) {
                stream.removeTrack(track);
            }

            if (stream.getTracks().length === 0) {
                this.participantStreams.delete(
                    record.participantId,
                );
            }
        }

        this.consumers.delete(consumerId);

        this.notifyMediaUpdate();
  }

  private handleConnectTransportSuccess(
    data: {
      direction: "send" | "receive";
    },
  ): void {
        const callback = this.connectCallbacks.get(
            data.direction,
        );

        if (!callback) {
            return;
        }

        this.connectCallbacks.delete(
            data.direction,
        );

        callback.resolve();
  }

  private handleProduceSuccess(
    data: {
      producerId: string;
    },
  ): void {
        const callback = this.produceCallbacks.shift();

        if (!callback) {
            console.warn(
                "[SfuMediaEngine] Received produce-success without a pending callback.",
            );

            return;
        }

        callback.resolve(data.producerId);
  }

  private sendJson(message: {
    type: string;
    data?: unknown;
  }): void {
        if ( !this.socket || this.socket.readyState !== WebSocket.OPEN ) {
            throw new Error(
                "SFU signaling socket is not connected.",
            );
        }

        this.socket.send(
            JSON.stringify(message),
        );
  }

  private notifyMediaUpdate(): void {
        const media = this.getParticipantMedia();

        this.mediaListeners.forEach(
            (listener) => {
                listener(media);
            },
        );
  }

  private notifyStatus(
    status: SfuMediaEngineStatus,
    error?: Error,
  ): void {
        this.statusListeners.forEach(
            (listener) => {
                listener(status, error);
            },
        );
  }

  private async cleanup(): Promise<void> {
        if (this.isCleaningUp) {
            return;
        }

        this.isCleaningUp = true;

        this.connectCallbacks.forEach(
            (callback) => {
                callback.reject(
                new Error(
                    "SFU connection was closed.",
                ),
                );
            },
        );

        this.connectCallbacks.clear();

        this.produceCallbacks.forEach(
            (callback) => {
                callback.reject(
                new Error(
                    "SFU connection was closed.",
                ),
                );
            },
        );

        this.produceCallbacks.length = 0;

        this.consumers.forEach(
            (record) => {
                record.consumer.close();
            },
        );

        this.consumers.clear();

        this.consumingProducerIds.clear();
        this.pendingProducerIds.clear();
        this.producerInfos.clear();

        if (this.sendTransport) {
            this.sendTransport.close();
            this.sendTransport = null;
        }

        if (this.recvTransport) {
            this.recvTransport.close();
            this.recvTransport = null;
        }

        if (this.localStream) {
            this.localStream
                .getTracks()
                .forEach((track) => { track.stop(); });

            this.localStream = null;
        }

        this.participantStreams.clear();

        if (this.socket) {
            this.socket.onopen = null;
            this.socket.onmessage = null;
            this.socket.onerror = null;
            this.socket.onclose = null;

            if (
                this.socket.readyState === WebSocket.OPEN ||
                this.socket.readyState === WebSocket.CONNECTING
            ) {
                this.socket.close();
            }

            this.socket = null;
        }

        this.device = null;
        this.config = null;
        this.isProducingLocalMedia = false;

        this.notifyMediaUpdate();
        this.notifyStatus("DISCONNECTED");

        this.isCleaningUp = false;
    }
}