'use client'

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { useLogoutMutation, useGetMeQuery, authApi } from "@/store/services/authApi";
import { 
    useInitiateUploadMutation, 
    useUploadPartMutation, 
    useCompleteUploadMutation 
} from "@/store/services/adminMediaApi"; // Removed useTriggerTranscodeMutation
import { MediaIngestionClient } from '@/core/services/MediaIngestion';
import { IngestionStep, resetIngestionEngine } from '@/store/slices/ingestionSlice';
import { useForm } from '@mantine/form';
import { 
    Stack, Title, Text, Button, TextInput, Textarea, 
    ActionIcon, Progress, Alert, Grid, Badge, Card, Tooltip
} from '@mantine/core';
import { 
    IconMovie, IconLogout, IconChevronLeft, 
    IconChevronRight, IconCloudUpload, IconLoader, IconCheck, IconX ,
    IconServer
} from '@tabler/icons-react'; 
import { io, Socket } from 'socket.io-client';
import { LoadingPage } from '../commons/LoadingPage';
import { createPortal } from 'react-dom';
import { clearCredentials } from '@/store/slices/authSlice';

// Strict Type Enumeration matching backend states
type CloudTranscodeStatus = 'IDLE' | 'PROCESSING' | 'AVAILABLE' | 'FAILED';

// Explicit Interface for incoming Telemetry Payload
interface MovieStatusChangedPayload {
    movieId: string;
    status: Exclude<CloudTranscodeStatus, 'IDLE'>;
    hlsUrl?: string;
}

// Expected response layout from processIngestionPipeline
interface IngestionPipelineResult {
    movieId: string;
    objectKey: string;
}

export function AdminControlCenterLeaf() {
    const dispatch = useAppDispatch();
    
    // UI Layout Presentation States
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [localLoading, setLocalLoading] = useState(false);

    // Track cloud transcode lifecycle status variables directly inside component state
    const [activeMovieId, setActiveMovieId] = useState<string | null>(null);
    const [cloudTranscodeStatus, setCloudTranscodeStatus] = useState<CloudTranscodeStatus>('IDLE');

    // Redux Pipeline Telemetry Selectors
    const { uploadStep, chunkProgress, engineError, engineSuccess } = useAppSelector((state) => state.ingestion);

    // Auth Actions
    const { data: userProfile } = useGetMeQuery();
    const [logout, { isLoading: isLoggingOut }] = useLogoutMutation();
    const [isClearing, setIsClearing] = useState(false);

    // API Mutations
    const [initiateUpload] = useInitiateUploadMutation();
    const [uploadPart] = useUploadPartMutation();
    const [completeUpload] = useCompleteUploadMutation();

    // Instantiate OOP engine worker via memoization guard
    const ingestionEngine = useMemo(() => {
        return new MediaIngestionClient(dispatch, initiateUpload, uploadPart, completeUpload);
    }, [dispatch, initiateUpload, uploadPart, completeUpload]);

    // WEBSOCKET TELEMETRY HOOK
    useEffect(() => {
        if (!activeMovieId) return;
        // Connect to the telemetry namespace on NestJS API server port
        const socket: Socket = io('http://localhost:7000/telemetry', {
            transports: ['websocket'],
            withCredentials: true
        });

        socket.on('connect', () => {
            console.log(`Telemetry stream link online. Tracking Movie ID: ${activeMovieId}`);
        });

        // Listen to live video transcoding worker updates
        socket.on('movie_status_changed', (data: MovieStatusChangedPayload) => {
            console.log('Received Cloud Telemetry Broadcast:', data);
            if (data.movieId === activeMovieId) {
                setCloudTranscodeStatus(data.status);
            }
        });

        socket.on('connect_error', (error) => {
            console.error('WebSocket Handshake Error on Port 7000:', error.message);
        });

        return () => {
            console.log('Severing telemetry stream link context...');
            socket.disconnect();
        };
    }, [activeMovieId]);

    const ingestionForm = useForm({
        initialValues: { title: '', genre: '', description: '', file: null as File | null },
        validate: {
            title: (val) => (val ? null : 'Title required'),
            genre: (val) => (val ? null : 'Genre classification required'),
            description: (val) => (val ? null : 'Description summary required'),
            file: (val) => (val ? null : 'Master .mp4 media payload binary required'),
        }
    });

    const handleLogout = async () => {
            try {
                setIsClearing(true);
                await logout().unwrap();
            } catch (error) {
                console.warn('Backend revocation completed or token was already stale');
            } finally {
                // Purge all RTK cache states across  the auth module
                dispatch(authApi.util.resetApiState());
    
                // Clear the slice state 
                dispatch(clearCredentials());
    
                localStorage.removeItem('access_token');
                window.location.href = '/';
            }
        };
    
        if (isClearing || isLoggingOut) {
            if (typeof window !== 'undefined') {
                return createPortal(
                    <LoadingPage message="Severing secure session lines safely..." />,
                    document.body
                );
            }
            return null;
        }

    const runIngestionPipeline = async (values: typeof ingestionForm.values) => {
        if (!values.file) return;
        setLocalLoading(true);
        setCloudTranscodeStatus('IDLE');
        try {
            // Process chunk upload strategy sequentially
            const result = await ingestionEngine.processIngestionPipeline({
                title: values.title,
                genre: values.genre,
                description: values.description,
                file: values.file
            }) as unknown as IngestionPipelineResult;

            // Extract and pin Movie ID from backend response to match WebSocket filters
            if (result && result.movieId) {
                setActiveMovieId(result .movieId);
            }

            ingestionForm.reset();
        } catch {
            // Error mapped to store implicitly via engine actor
        } finally {
            setLocalLoading(false);
        }
    };

    return (
        <div className="w-full h-screen flex bg-black text-zinc-100 overflow-hidden">
            {/* ... Sidebar Navigation remains identical ... */}
            <aside className={`h-full bg-[#020205] border-r border-zinc-900 transition-all duration-300 ease-in-out relative flex flex-col justify-between p-4 ${sidebarCollapsed ? 'w-20' : 'w-72'}`}>
                <Stack gap="xl">
                    <div className="flex items-center justify-between min-h-10">
                        {!sidebarCollapsed && (
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse" />
                                <Title order={4} className="tracking-tight text-white font-extrabold uppercase text-xs">Synchro Core</Title>
                            </div>
                        )}
                        <ActionIcon onClick={() => setSidebarCollapsed(!sidebarCollapsed)} variant="subtle" color="zinc" className="hover:bg-zinc-900 ml-auto">
                            {sidebarCollapsed ? <IconChevronRight size={16} /> : <IconChevronLeft size={16} />}
                        </ActionIcon>
                    </div>
                    <Stack gap="xs">
                        <button 
                            type="button"
                            onClick={() => { 
                                dispatch(resetIngestionEngine()); 
                                setCloudTranscodeStatus('IDLE');
                                setActiveMovieId(null);
                            }}
                            className="flex items-center gap-3 w-full p-3 rounded-xl transition-all duration-200 text-left bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 font-medium"
                        >
                            <IconMovie size={18} />
                            {!sidebarCollapsed && <span className="text-sm">Ingestion Console</span>}
                        </button>
                    </Stack>
                </Stack>
                {/* Operator Block */}
                <div className="border-t border-zinc-900 pt-4">
                    <div className="flex items-center justify-between">
                        {!sidebarCollapsed && (
                            <div className="min-w-0">
                                <Text size="xs" className="text-zinc-500 font-medium tracking-wider uppercase">Operator</Text>
                                <Text size="sm" className="text-white font-semibold truncate block">{userProfile?.data?.username || 'Admin Core'}</Text>
                            </div>
                        )}
                        <Tooltip label="Terminate Workspace Session" position="right">
                            <ActionIcon onClick={handleLogout} size="lg" color="red" variant="light" className="rounded-xl">
                                <IconLogout size={16} />
                            </ActionIcon>
                        </Tooltip>
                    </div>
                </div>
            </aside>

            <main className="flex-1 h-full flex flex-col min-w-0 bg-[#020204]">
                <header className="w-full px-8 py-4 flex justify-between items-center border-b border-zinc-900 bg-black/40 backdrop-blur-md">
                    <div className="flex items-center gap-6">
                        <Title order={3} className="text-[#4B4DB5] font-black tracking-wider text-lg uppercase hidden sm:block">SynchroStream</Title>
                        <div className="h-4 w-px bg-zinc-800 hidden sm:block" />
                        <Title order={4} className="text-white font-bold tracking-tight text-sm sm:text-base">Media Ingestion Hub</Title>
                    </div>
                    <Badge color="indigo" variant="dot" size="md" className="border border-zinc-800 bg-zinc-950">Operational Status Stable</Badge>
                </header>

                <div className="p-8 flex-1 overflow-y-auto">
                    {engineError && <Alert icon={<IconX size={16} />} color="red" title="Pipeline Exception" className="mb-6 rounded-xl">{engineError}</Alert>}
                    
                    {/* ENHANCED LIVE FEEDBACK ALERT OBJECTS */}
                    {engineSuccess && cloudTranscodeStatus !== 'AVAILABLE' && (
                        <Alert icon={<IconCheck size={16} />} color="indigo" title="Ingestion Wave Finalized" className="mb-6 rounded-xl border border-indigo-500/10 bg-indigo-950/20">
                            <Stack gap="xs">
                                <Text size="xs" className="text-zinc-300">{engineSuccess}</Text>
                                <div className="flex items-center gap-2 bg-black/40 px-3 py-2 rounded-lg border border-zinc-900 w-fit">
                                    <IconLoader size={12} className="text-indigo-400 animate-spin" />
                                    <Text size="xs" className="font-mono text-indigo-400 tracking-wider">Cloud Processing Status: Encoding HLS Bitrate Matrices...</Text>
                                </div>
                            </Stack>
                        </Alert>
                    )}

                    {cloudTranscodeStatus === 'AVAILABLE' && (
                        <Alert icon={<IconCheck size={18} />} color="green" title="Pipeline Processing Complete" className="mb-6 rounded-xl border border-emerald-500/20 bg-emerald-950/10">
                            <Text size="xs" className="text-emerald-300 font-medium">
                                Background cluster task successfully encoded all 237 assets. Master index manifest topology structure finalized on R2 storage. Movie profile is now fully live and streamable.
                            </Text>
                        </Alert>
                    )}

                    {cloudTranscodeStatus === 'FAILED' && (
                        <Alert icon={<IconX size={18} />} color="red" title="Transcoding Node Exception" className="mb-6 rounded-xl">
                            <Text size="xs">The file uploaded successfully, but the background transcoding child process failed on the worker instance.</Text>
                        </Alert>
                    )}

                    <Grid gap="xl">
                        <Grid.Col span={{ base: 12, lg: 7 }}>
                            <form onSubmit={ingestionForm.onSubmit(runIngestionPipeline)} className="bg-zinc-950/40 border border-zinc-900 p-6 rounded-2xl">
                                <Stack gap="md">
                                    <TextInput label="Asset Title" required disabled={localLoading} {...ingestionForm.getInputProps('title')} />
                                    <TextInput label="Genre Classification" required disabled={localLoading} {...ingestionForm.getInputProps('genre')} />
                                    <Textarea label="Catalog Description" required disabled={localLoading} minRows={3} {...ingestionForm.getInputProps('description')} />

                                    <div className="flex flex-col gap-1">
                                        <Text size="sm" className="font-medium text-zinc-300">Binary Stream Target File (.mp4)</Text>
                                        <div className="border border-dashed border-zinc-800 bg-black/30 rounded-xl p-6 text-center relative hover:border-zinc-700 transition-colors">
                                            <input type="file" accept="video/mp4" disabled={localLoading} onChange={(e) => ingestionForm.setFieldValue('file', e.target.files?.[0] || null)} className="absolute inset-0 opacity-0 cursor-pointer" />
                                            <Stack align="center" gap="xs">
                                                <IconCloudUpload size={28} className={ingestionForm.values.file ? "text-indigo-400" : "text-zinc-600"} />
                                                <Text size="xs" className="text-zinc-400">{ingestionForm.values.file ? ingestionForm.values.file.name : 'Select or drop raw video master here'}</Text>
                                            </Stack>
                                        </div>
                                    </div>

                                    <Button type="submit" loading={localLoading} fullWidth className="bg-indigo-600 hover:bg-indigo-700 mt-2 rounded-xl">
                                        Initiate Media Transmission Sequence
                                    </Button>
                                </Stack>
                            </form>
                        </Grid.Col>

                        <Grid.Col span={{ base: 12, lg: 5 }}>
                            <Card className="bg-zinc-950/40 border border-zinc-900 rounded-2xl p-6 h-full flex flex-col justify-between">
                                <Title order={5} className="text-zinc-400 border-b border-zinc-900 pb-3">Telemetry Monitor</Title>
                                <div className="flex-1 flex flex-col justify-center">
                                    {uploadStep === ('idle' as IngestionStep) && cloudTranscodeStatus === 'IDLE' ? (
                                        <Text size="sm" className="text-zinc-600 text-center">No active ingestion tasks allocated to cluster node streams.</Text>
                                    ) : (
                                        <div className="space-y-4">
                                            {/* Ingestion Phase Item Badge */}
                                            {uploadStep !== 'idle' && (
                                                <div className="flex items-center justify-between bg-black/40 border border-zinc-900 p-3 rounded-xl">
                                                    <div className="flex items-center gap-3">
                                                        {uploadStep !== ('success' as IngestionStep) ? <IconLoader size={16} className="text-indigo-400 animate-spin" /> : <IconCheck size={16} className="text-emerald-400" />}
                                                        <Text size="xs" className="font-mono text-zinc-300 uppercase tracking-wider">Local Upload: {uploadStep}</Text>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Chunk Bar Progress */}
                                            {uploadStep === ('uploading_chunks' as IngestionStep) && (
                                                <div className="space-y-1">
                                                    <Progress value={chunkProgress} color="indigo" radius="xl" animated />
                                                    <Text size="xs" className="text-right text-zinc-500 font-mono">{chunkProgress}%</Text>
                                                </div>
                                            )}

                                            {/* LIVE WORKER CLOUD TRANSCODE PROCESS STATUS TRACKER */}
                                            {cloudTranscodeStatus !== 'IDLE' && (
                                                <div className={`flex items-center justify-between border p-3 rounded-xl transition-all duration-300 ${
                                                    cloudTranscodeStatus === 'PROCESSING' ? 'bg-indigo-950/10 border-indigo-500/20 text-indigo-400' :
                                                    cloudTranscodeStatus === 'AVAILABLE' ? 'bg-emerald-950/10 border-emerald-500/20 text-emerald-400' : 'bg-red-950/10 border-red-500/20 text-red-400'
                                                }`}>
                                                    <div className="flex items-center gap-3">
                                                        {cloudTranscodeStatus === 'PROCESSING' && <IconLoader size={16} className="animate-spin" />}
                                                        {cloudTranscodeStatus === 'AVAILABLE' && <IconServer size={16} />}
                                                        {cloudTranscodeStatus === 'FAILED' && <IconX size={16} />}
                                                        <Stack gap={2}>
                                                            <Text size="xs" className="font-mono uppercase tracking-wider font-bold">Cloud Worker Matrix: {cloudTranscodeStatus}</Text>
                                                            {cloudTranscodeStatus === 'PROCESSING' && <Text size="10px" className="text-zinc-500 font-sans">Compiling 360p & 804p HLS segment nodes...</Text>}
                                                            {cloudTranscodeStatus === 'AVAILABLE' && <Text size="10px" className="text-emerald-500 font-sans">Database Status Sync: AVAILABLE</Text>}
                                                        </Stack>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </Card>
                        </Grid.Col>
                    </Grid>
                </div>
            </main>
        </div>
    );
}