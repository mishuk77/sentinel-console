import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Dataset, MLModel } from "@/lib/api";
import { api } from "@/lib/api";
import { Play, Loader2, Trophy, ArrowRight, FileText, CheckCircle2, Clock, Cpu, X, AlertTriangle, BarChart2, ChevronDown, ChevronRight, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Configuration type ─────────────────────────────────────
export interface TrainingPageConfig {
    /** "credit" | "fraud" — passed to backend as model_context */
    modelContext: "credit" | "fraud";
    /** Page title */
    title: string;
    /** Page subtitle */
    description: string;
    /** Column names to auto-highlight as likely targets */
    targetHints?: string[];
    /** Labels for the class balance bar */
    classLabels: { positive: string; negative: string };
    /** Target column label in the wizard */
    targetLabel: string;
    /** Target column helper text */
    targetHelper: string;
    /** Feature column label */
    featureLabel: string;
    /** Feature column helper text */
    featureHelper: string;
    /** Low class balance warning text */
    imbalanceWarning: string;
    /** Text for the "Start Training" button */
    startButtonText: string;
    /** Route to navigate after completion (relative to /systems/:systemId/) */
    completionRoute: string;
    /** Button text on completion banner */
    completionButtonText: string;
    /** Route to datasets page (for empty state) */
    datasetRoute: string;
    /** Section title for results grid */
    resultsTitle: string;
    /** Empty state title */
    emptyTitle: string;
    /** Empty state description when datasets exist */
    emptyWithDatasets: string;
    /** Empty state description when no datasets */
    emptyNoDatasets: string;
    /** Empty state link text */
    emptyLinkText: string;
}

type TrainingState = 'IDLE' | 'STARTING' | 'TRAINING' | 'COMPLETED' | 'FAILED';

export default function TrainingPage({ config }: { config: TrainingPageConfig }) {
    const { systemId } = useParams<{ systemId: string }>();
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const [selectedDataset, setSelectedDataset] = useState<string>("");
    const [error, setError] = useState<string | null>(null);
    const [configuration, setConfiguration] = useState<{ targetCol: string, featureCols: string[] }>({ targetCol: "", featureCols: [] });

    // Wizard State: 0 = Select Dataset, 1 = Preview, 2 = Configure
    const [wizardStep, setWizardStep] = useState<number>(0);
    const [previewData, setPreviewData] = useState<any>(null);

    // Data quality profile state
    const [profileData, setProfileData] = useState<any>(null);
    const [profileLoading, setProfileLoading] = useState(false);
    const [profileError, setProfileError] = useState<string | null>(null);

    // Explicit State Machine for Training Process
    const storageKey = `sentinel-training-log-${systemId}-${config.modelContext}`;
    const [trainingState, setTrainingState] = useState<TrainingState>('IDLE');
    const [jobId, setJobId] = useState<string | null>(null);
    const [trainingEvents, setTrainingEvents] = useState<Array<{ step: string; status: string; detail: string; ts: number }>>(() => {
        try {
            const saved = sessionStorage.getItem(storageKey);
            return saved ? JSON.parse(saved) : [];
        } catch { return []; }
    });

    // Persist training events to sessionStorage
    useEffect(() => {
        if (trainingEvents.length > 0) {
            try { sessionStorage.setItem(storageKey, JSON.stringify(trainingEvents)); } catch {}
        }
    }, [trainingEvents, storageKey]);

    // Pipeline log visibility
    const [logExpanded, setLogExpanded] = useState(true);

    // Elapsed time tracking
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const startTimeRef = useRef<number | null>(null);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const completedAtRef = useRef<number | null>(null);

    // Snapshot of model count before training starts
    const initialModelCountRef = useRef<number>(0);

    // Fetch Datasets
    const { data: datasets } = useQuery<Dataset[]>({
        queryKey: ["datasets", systemId],
        queryFn: async () => {
            const res = await api.get("/datasets/", { params: { system_id: systemId } });
            return res.data;
        },
        enabled: !!systemId
    });

    // Fetch Models — filtered by context
    const { data: allModels } = useQuery<MLModel[]>({
        queryKey: ["models", systemId],
        queryFn: async () => {
            const res = await api.get("/models/", { params: { system_id: systemId } });
            return res.data;
        },
        enabled: !!systemId,
        refetchInterval: (query) => {
            const anyTraining = query.state.data?.some(m => m.status === "TRAINING");
            if (trainingState === 'STARTING' || trainingState === 'TRAINING') return 1000;
            if (anyTraining) return 1000;
            return false;
        }
    });

    const isFraud = config.modelContext === "fraud";
    const models = allModels?.filter(m =>
        isFraud
            ? (m.metrics as any)?.model_context === "fraud"
            : (m.metrics as any)?.model_context !== "fraud"
    );

    // Elapsed time effect
    useEffect(() => {
        if (trainingState === 'STARTING' || trainingState === 'TRAINING' || trainingState === 'COMPLETED' || trainingState === 'FAILED') {
            if (!startTimeRef.current) {
                startTimeRef.current = Date.now();
            }
            timerRef.current = setInterval(() => {
                if (startTimeRef.current) {
                    const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
                    setElapsedSeconds(elapsed);
                    if (trainingState === 'FAILED' || (trainingState === 'COMPLETED' && completedAtRef.current !== null && elapsed >= completedAtRef.current + 5)) {
                        clearInterval(timerRef.current!);
                        timerRef.current = null;
                    }
                }
            }, 1000);
        } else {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
            if (trainingState === 'IDLE') {
                startTimeRef.current = null;
                completedAtRef.current = null;
                setElapsedSeconds(0);
            }
        }
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [trainingState]);

    // State Transitions Effect
    useEffect(() => {
        if (!models) return;
        const currentCount = models.length;
        const initialCount = initialModelCountRef.current;
        const hasNewModels = currentCount > initialCount;
        const hasTrainingModels = models.some(m => m.status === "TRAINING");

        if (trainingState === 'STARTING') {
            if (hasNewModels) {
                if (hasTrainingModels) {
                    setTrainingState('TRAINING');
                } else {
                    completedAtRef.current = startTimeRef.current
                        ? Math.floor((Date.now() - startTimeRef.current) / 1000) : 0;
                    // Check if all new models failed
                    const newModels = models.slice(initialCount);
                    const allFailed = newModels.length > 0 && newModels.every(m => m.status === "FAILED");
                    setTrainingState(allFailed ? 'FAILED' : 'COMPLETED');
                }
            }
        } else if (trainingState === 'TRAINING') {
            if (!hasTrainingModels) {
                completedAtRef.current = startTimeRef.current
                    ? Math.floor((Date.now() - startTimeRef.current) / 1000) : 0;
                const newModels = models.slice(initialCount);
                const allFailed = newModels.length > 0 && newModels.every(m => m.status === "FAILED");
                setTrainingState(allFailed ? 'FAILED' : 'COMPLETED');
            }
        }
    }, [models, trainingState]);

    // Poll training events
    useQuery({
        queryKey: ["training-events", jobId],
        queryFn: async () => {
            if (!jobId) return [];
            const res = await api.get(`/models/training-events/${jobId}`);
            setTrainingEvents(res.data || []);
            return res.data;
        },
        enabled: !!jobId && (trainingState === 'STARTING' || trainingState === 'TRAINING' || trainingState === 'COMPLETED' || trainingState === 'FAILED'),
        refetchInterval: (trainingState === 'COMPLETED' || trainingState === 'FAILED') ? 3000 : 1000,
    });

    // Start Training Mutation
    const trainMutation = useMutation({
        mutationFn: async ({ datasetId, payload }: { datasetId: string, payload: any }) => {
            const res = await api.post(`/models/${datasetId}/train`, payload);
            return res.data;
        },
        onSuccess: (data) => {
            initialModelCountRef.current = models?.length || 0;
            if (data?.job_id) {
                setJobId(data.job_id);
                setTrainingEvents([]);
            }
            queryClient.invalidateQueries({ queryKey: ["models"] });
            setError(null);
            setWizardStep(0);
            setSelectedDataset("");
            setTrainingState('STARTING');
        },
        onError: (err) => {
            console.error(err);
            setError("Failed to start training. Please try again.");
            setTrainingState('IDLE');
        },
    });

    const handleDismissTraining = () => {
        setTrainingState('IDLE');
        startTimeRef.current = null;
        completedAtRef.current = null;
        setElapsedSeconds(0);
        setJobId(null);
        // Don't clear trainingEvents — keep them for the persistent log
    };

    // Fetch data quality profile
    const fetchProfile = async () => {
        if (!selectedDataset) { setProfileError("No dataset selected."); return; }
        if (!configuration.targetCol) { setProfileError("Please select a target column first."); return; }
        if (configuration.featureCols.length === 0) { setProfileError("Please select at least one feature column first."); return; }
        setProfileLoading(true);
        setProfileData(null);
        setProfileError(null);
        try {
            const res = await api.get(`/datasets/${selectedDataset}/profile`, {
                params: {
                    target_col: configuration.targetCol,
                    feature_cols: configuration.featureCols.join(","),
                }
            });
            setProfileData(res.data);
        } catch (e: any) {
            const msg = e?.response?.data?.detail || e?.message || "Profile analysis failed.";
            setProfileError(msg);
        } finally {
            setProfileLoading(false);
        }
    };

    useEffect(() => {
        setProfileData(null);
        setProfileError(null);
    }, [configuration.targetCol, configuration.featureCols.length]);

    if (datasets?.length && !selectedDataset) {
        setSelectedDataset(datasets[0].id);
    }

    const handleStartTraining = () => {
        if (!configuration.targetCol) {
            setError("Please select a target column (Y).");
            return;
        }
        if (configuration.featureCols.length === 0) {
            setError("Please select at least one feature column (X).");
            return;
        }
        trainMutation.mutate({
            datasetId: selectedDataset,
            payload: {
                target_col: configuration.targetCol,
                feature_cols: configuration.featureCols,
                model_context: config.modelContext,
            }
        });
    };

    const currentDataset = datasets?.find(d => d.id === selectedDataset);
    const columns = (currentDataset?.metadata_info?.columns as string[]) || [];

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    };

    const getTrainingStep = () => {
        if (trainingState === 'COMPLETED') {
            const completedAt = completedAtRef.current ?? 0;
            return elapsedSeconds >= completedAt + 5 ? 4 : 3;
        }
        if (trainingState === 'TRAINING') return elapsedSeconds < 12 ? 2 : 3;
        if (trainingState === 'STARTING') return 1;
        return 0;
    };

    const trainingStep = getTrainingStep();
    const isFailed = trainingState === 'FAILED';
    const isTrainingActive = trainingState === 'STARTING' || trainingState === 'TRAINING'
        || (trainingState === 'COMPLETED' && trainingStep < 4) || isFailed;
    const isCompleted = trainingState === 'COMPLETED' && trainingStep >= 4;

    const targetHints = config.targetHints || [];
    const isHintedTarget = (col: string) => targetHints.some(h => col.toLowerCase() === h.toLowerCase());

    return (
        <div className="page">
            {/* Header */}
            <div>
                <h1 className="page-title">{config.title}</h1>
                <p className="page-desc">{config.description}</p>
            </div>

            {/* ── Training Progress Card ──────────────────────── */}
            {isTrainingActive && (
                <div className={cn(
                    "panel animate-in fade-in slide-in-from-top-4",
                    isFailed ? "border-down/30 bg-down/5" : "border-info/30 bg-info/5"
                )}>
                    <div className="flex items-start justify-between mb-6 p-5 pb-0">
                        <div className="flex items-center gap-4">
                            <div className={cn("p-3 rounded-full", isFailed ? "bg-down/10" : "bg-info/10")}>
                                {isFailed
                                    ? <AlertTriangle className="h-6 w-6 text-down" />
                                    : <Cpu className="h-6 w-6 text-info animate-pulse" />}
                            </div>
                            <div>
                                <h3 className="text-lg font-bold">
                                    {isFailed ? "Training Failed" : "Training in Progress"}
                                </h3>
                                <p className={cn("text-sm", isFailed ? "text-down" : "text-info")}>
                                    {isFailed
                                        ? "All models failed. Review the pipeline log below for details."
                                        : "Sentinel is training 5 models \u2014 hyperparameter tuning, feature engineering & ensemble"}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={handleDismissTraining}
                            className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-full transition-colors"
                            title="Dismiss (training will continue in background)"
                        >
                            <X className="h-5 w-5" />
                        </button>
                    </div>

                    {/* Pipeline Steps */}
                    <div className="flex items-center gap-1.5 mb-6 px-5">
                        {[
                            { step: 1, label: "Data Profiling & Balancing" },
                            { step: 2, label: "Feature Engineering" },
                            { step: 3, label: "Hyperparameter Tuning" },
                            { step: 4, label: "Ensemble & Leaderboard" },
                        ].map((item, idx) => (
                            <div key={item.step} className="flex items-center flex-1">
                                <div className={cn(
                                    "flex items-center gap-2 px-2.5 py-2 rounded-lg transition-all flex-1 min-w-0",
                                    trainingStep >= item.step
                                        ? "bg-info text-white"
                                        : "bg-muted/50 text-muted-foreground border border-border"
                                )}>
                                    {trainingStep === item.step ? (
                                        <Cpu className="h-3.5 w-3.5 shrink-0 animate-pulse" />
                                    ) : trainingStep > item.step ? (
                                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                                    ) : (
                                        <Clock className="h-3.5 w-3.5 shrink-0" />
                                    )}
                                    <span className="text-xs font-medium truncate">{item.label}</span>
                                </div>
                                {idx < 3 && (
                                    <div className={cn(
                                        "h-0.5 w-3 mx-0.5 shrink-0",
                                        trainingStep > item.step ? "bg-info" : "bg-border"
                                    )} />
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Elapsed Time & Status */}
                    <div className="bg-muted/30 rounded-lg p-4 flex items-center justify-between mx-5">
                        <div className="flex items-center gap-3">
                            <Clock className="h-5 w-5 text-info" />
                            <div>
                                <p className="text-sm font-medium">Elapsed Time</p>
                                <p className="text-2xl font-mono font-bold text-info">{formatTime(elapsedSeconds)}</p>
                            </div>
                        </div>
                        <div className="text-right text-sm text-muted-foreground">
                            {trainingStep === 1 && "Class imbalance detection · Winsorization · Target encoding..."}
                            {trainingStep === 2 && "Scaling features · Stratified split · Bayesian smoothing..."}
                            {trainingStep === 3 && trainingState !== 'COMPLETED' && "RandomizedSearchCV · LogReg, RF, XGBoost, LightGBM · 3-fold CV..."}
                            {trainingStep === 3 && trainingState === 'COMPLETED' && "Building probability-averaging ensemble & leaderboard..."}
                            {trainingState === 'STARTING' && elapsedSeconds >= 30 && (
                                <span className="text-warn">Taking longer than usual — still processing...</span>
                            )}
                        </div>
                    </div>

                    {/* Inline Pipeline Feed (during active training) */}
                    <div className="mx-5 mt-4 mb-5">
                        <div className={cn(
                            "bg-black/20 rounded-lg border border-border/50 overflow-y-auto font-mono text-[11px] p-3 space-y-1",
                            isFailed ? "max-h-[400px]" : "max-h-[280px]"
                        )}>
                            {trainingEvents.length === 0 ? (
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <span className="shrink-0 h-1.5 w-1.5 rounded-full bg-info animate-pulse" />
                                    <span>Connecting to worker — waiting for pipeline events...</span>
                                </div>
                            ) : (
                                trainingEvents.map((evt, i) => (
                                    <div key={i} className="flex items-start gap-2">
                                        <span className={cn(
                                            "shrink-0 mt-0.5 h-1.5 w-1.5 rounded-full",
                                            evt.status === "done" ? "bg-up" :
                                            evt.status === "warn" ? "bg-warn" :
                                            evt.status === "error" ? "bg-down" :
                                            "bg-info animate-pulse"
                                        )} />
                                        <span className="text-muted-foreground shrink-0">
                                            {new Date(evt.ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                        </span>
                                        <span className={cn(
                                            evt.status === "error" ? "text-down" :
                                            evt.status === "warn" ? "text-warn" :
                                            evt.status === "done" ? "text-up" :
                                            "text-foreground"
                                        )}>
                                            <span className="font-semibold">{evt.step}</span>
                                            {evt.detail && <span className="text-muted-foreground"> — {evt.detail}</span>}
                                        </span>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {trainingState === 'STARTING' && elapsedSeconds >= 45 && (
                        <div className="mx-5 mb-5 mt-4 p-3 bg-warn/10 border border-warn/30 rounded-lg text-sm text-warn">
                            <strong>Note:</strong> The backend is processing your request. Models will appear automatically once created.
                            You can dismiss this and check back later — training continues in the background.
                        </div>
                    )}
                </div>
            )}

            {/* ── Success Banner ──────────────────────────────── */}
            {isCompleted && (
                <div className="panel border-up/30 bg-up/5 p-5 flex items-center justify-between animate-in zoom-in-95 duration-300">
                    <div className="flex items-center gap-4">
                        <div className="bg-up/10 p-3 rounded-full">
                            <Trophy className="h-6 w-6 text-up" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold">Successfully Trained Models</h3>
                            <p className="text-muted-foreground">
                                {completedAtRef.current != null && completedAtRef.current > 0
                                    ? `Completed in ${formatTime(completedAtRef.current)}. ` : ''}
                                Your models are ready for evaluation.
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() => navigate(`/systems/${systemId}/${config.completionRoute}`)}
                        className="btn-primary flex items-center gap-2"
                    >
                        {config.completionButtonText} <ArrowRight className="h-4 w-4" />
                    </button>
                </div>
            )}


            {/* ── Collapsible Pipeline Log (persists after training) ── */}
            {trainingEvents.length > 0 && !isTrainingActive && (
                <div className="panel">
                    <button
                        onClick={() => setLogExpanded(prev => !prev)}
                        className="w-full px-5 py-3 flex items-center justify-between hover:bg-muted/30 transition-colors"
                    >
                        <div className="flex items-center gap-2.5">
                            <Terminal className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-semibold">Training Pipeline Log</span>
                            <span className="text-xs text-muted-foreground">
                                {trainingEvents.length} events
                                {completedAtRef.current != null && completedAtRef.current > 0
                                    ? ` · ${formatTime(completedAtRef.current)}` : ''}
                            </span>
                        </div>
                        {logExpanded
                            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                    </button>
                    {logExpanded && (
                        <div className="px-5 pb-4">
                            <div className="bg-black/20 rounded-lg border border-border/50 overflow-y-auto font-mono text-[11px] p-3 space-y-1 max-h-[500px]">
                                {trainingEvents.map((evt, i) => (
                                    <div key={i} className="flex items-start gap-2">
                                        <span className={cn(
                                            "shrink-0 mt-0.5 h-1.5 w-1.5 rounded-full",
                                            evt.status === "done" ? "bg-up" :
                                            evt.status === "warn" ? "bg-warn" :
                                            evt.status === "error" ? "bg-down" :
                                            "bg-info"
                                        )} />
                                        <span className="text-muted-foreground shrink-0">
                                            {new Date(evt.ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                        </span>
                                        <span className={cn(
                                            evt.status === "error" ? "text-down" :
                                            evt.status === "warn" ? "text-warn" :
                                            evt.status === "done" ? "text-up" :
                                            "text-foreground"
                                        )}>
                                            <span className="font-semibold">{evt.step}</span>
                                            {evt.detail && <span className="text-muted-foreground"> — {evt.detail}</span>}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── Wizard Card ────────────────────────────────── */}
            {trainingState === 'IDLE' && (
                <div className="panel max-w-3xl">
                    <div className="panel-body">

                    {/* Step 1: Dataset Selection */}
                    {wizardStep === 0 && (
                        <div className="flex items-end gap-4 animate-in fade-in slide-in-from-left-4">
                            <div className="flex-1 space-y-2">
                                <label className="text-sm font-medium leading-none text-muted-foreground">
                                    Training Dataset
                                </label>
                                <div className="text-lg font-semibold flex items-center gap-2">
                                    <FileText className="h-5 w-5 text-info" />
                                    {currentDataset?.metadata_info?.original_filename || "Loading..."}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                    {currentDataset ? `${currentDataset.metadata_info?.row_count?.toLocaleString()} rows • Uploaded ${new Date(currentDataset.created_at).toLocaleDateString()}` : ""}
                                </div>
                            </div>
                            <button
                                onClick={async () => {
                                    if (!selectedDataset) return;
                                    try {
                                        const res = await api.get(`/datasets/${selectedDataset}/preview`);
                                        setPreviewData(res.data);
                                        setWizardStep(1);
                                        setError(null);
                                        setTrainingState('IDLE');
                                    } catch {
                                        setError("Failed to load preview.");
                                    }
                                }}
                                disabled={!selectedDataset}
                                className="btn-primary btn-sm disabled:opacity-50"
                            >
                                Next: Preview &rarr;
                            </button>
                        </div>
                    )}

                    {/* Step 2: Preview */}
                    {wizardStep === 1 && previewData && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                            <div className="flex items-center justify-between border-b pb-4">
                                <h3 className="font-semibold text-lg">2. Preview Dataset</h3>
                            </div>
                            <div className="space-y-4">
                                <p className="text-sm text-muted-foreground">
                                    Verify that the data looks correct. Showing first 5 rows.
                                </p>
                                <div className="border rounded-md overflow-x-auto bg-muted/10">
                                    <table className="w-full text-xs text-left">
                                        <thead className="bg-muted text-muted-foreground">
                                            <tr>
                                                {previewData.columns.map((c: any) => (
                                                    <th key={c.name} className="px-3 py-2 font-medium whitespace-nowrap">
                                                        {c.name} <span className="text-[10px] text-muted-foreground font-normal">({c.type})</span>
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {previewData.rows.map((row: any, i: number) => (
                                                <tr key={i} className="border-t border-muted/20">
                                                    {previewData.columns.map((c: any) => (
                                                        <td key={c.name} className="px-3 py-2 whitespace-nowrap">{row[c.name]}</td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <div className="flex justify-end pt-4">
                                    <button onClick={() => setWizardStep(2)} className="btn-primary btn-sm">
                                        Confirm &amp; Configure &rarr;
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Step 3: Configuration */}
                    {wizardStep === 2 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                            <div className="flex items-center justify-between border-b pb-4">
                                <h3 className="font-semibold text-lg">3. Configure Training Job</h3>
                            </div>

                            {columns.length === 0 ? (
                                <div className="p-4 bg-warn/10 text-warn rounded-md text-sm">
                                    Warning: No column information found. You may need to re-upload this dataset.
                                    <br />
                                    <button onClick={handleStartTraining} className="mt-2 underline font-bold">Try Training with Defaults</button>
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 gap-8">
                                    {/* Target (Y) */}
                                    <div className="space-y-3">
                                        <label className="text-sm font-bold flex items-center gap-2">
                                            {config.targetLabel}
                                            <span className="text-xs font-normal text-muted-foreground">{config.targetHelper}</span>
                                        </label>
                                        <div className="p-1 max-h-[300px] overflow-y-auto border rounded-md">
                                            {columns.map(col => (
                                                <label key={`target-${col}`} className={cn(
                                                    "flex items-center gap-2 px-3 py-2 rounded cursor-pointer text-sm",
                                                    configuration.targetCol === col ? "bg-primary/10 font-semibold text-primary" : "hover:bg-muted"
                                                )}>
                                                    <input
                                                        type="radio"
                                                        name="targetCol"
                                                        value={col}
                                                        checked={configuration.targetCol === col}
                                                        onChange={(e) => setConfiguration(prev => ({
                                                            ...prev,
                                                            targetCol: e.target.value,
                                                            featureCols: prev.featureCols.filter(c => c !== e.target.value)
                                                        }))}
                                                        className="accent-primary"
                                                    />
                                                    {col}
                                                    {isHintedTarget(col) && (
                                                        <span className="ml-auto text-[10px] text-primary font-semibold">suggested</span>
                                                    )}
                                                </label>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Features (X) */}
                                    <div className="space-y-3">
                                        <label className="text-sm font-bold flex items-center gap-2">
                                            {config.featureLabel}
                                            <span className="text-xs font-normal text-muted-foreground">{config.featureHelper}</span>
                                        </label>
                                        <div className="flex items-center justify-between text-xs px-1">
                                            <span className="text-muted-foreground">{configuration.featureCols.length} selected</span>
                                            <button
                                                onClick={() => setConfiguration(prev => ({ ...prev, featureCols: columns.filter(c => c !== prev.targetCol) }))}
                                                className="text-primary hover:underline"
                                            >Select All</button>
                                        </div>
                                        <div className="p-1 max-h-[300px] overflow-y-auto border rounded-md bg-muted/10">
                                            {columns.filter(c => c !== configuration.targetCol).map(col => (
                                                <label key={`feature-${col}`} className={cn(
                                                    "flex items-center gap-2 px-3 py-2 rounded cursor-pointer text-sm",
                                                    configuration.featureCols.includes(col) ? "bg-muted shadow-sm" : "hover:bg-muted/50"
                                                )}>
                                                    <input
                                                        type="checkbox"
                                                        value={col}
                                                        checked={configuration.featureCols.includes(col)}
                                                        onChange={(e) => {
                                                            const checked = e.target.checked;
                                                            setConfiguration(prev => ({
                                                                ...prev,
                                                                featureCols: checked
                                                                    ? [...prev.featureCols, col]
                                                                    : prev.featureCols.filter(c => c !== col)
                                                            }));
                                                        }}
                                                        className="accent-primary rounded"
                                                    />
                                                    {col}
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Data Quality Report */}
                            {configuration.targetCol && configuration.featureCols.length > 0 && (
                                <div className="border rounded-lg overflow-hidden">
                                    <div className="flex items-center justify-between px-4 py-3 bg-muted/30 border-b">
                                        <div className="flex items-center gap-2 text-sm font-semibold">
                                            <BarChart2 className="h-4 w-4 text-info" />
                                            Data Quality Report
                                        </div>
                                        <button
                                            onClick={fetchProfile}
                                            disabled={profileLoading}
                                            className="text-xs font-medium text-primary hover:underline disabled:opacity-50 flex items-center gap-1"
                                        >
                                            {profileLoading ? (
                                                <><Loader2 className="h-3 w-3 animate-spin" /> Analyzing...</>
                                            ) : profileData ? "Re-run Analysis" : "Analyze Selection →"}
                                        </button>
                                    </div>

                                    {!profileData && !profileLoading && !profileError && (
                                        <div className="px-4 py-3 text-xs text-muted-foreground">
                                            Click &quot;Analyze Selection&quot; to inspect your data before training.
                                        </div>
                                    )}
                                    {profileError && (
                                        <div className="px-4 py-3 text-xs text-down bg-down/5 border-t border-down/20">
                                            {profileError}
                                        </div>
                                    )}

                                    {profileData && (
                                        <div className="p-4 space-y-4">
                                            <div className="grid grid-cols-3 gap-3">
                                                <div className="bg-muted/20 rounded-lg p-3 text-center">
                                                    <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Rows</p>
                                                    <p className="text-xl font-bold mt-0.5">{profileData.total_rows?.toLocaleString()}</p>
                                                </div>
                                                <div className="bg-muted/20 rounded-lg p-3 text-center">
                                                    <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Features</p>
                                                    <p className="text-xl font-bold mt-0.5">{profileData.feature_count}</p>
                                                </div>
                                                <div className={cn(
                                                    "rounded-lg p-3 text-center",
                                                    (profileData.overall_missing_pct ?? 0) > 10 ? "bg-warn/10" : "bg-muted/20"
                                                )}>
                                                    <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Missing</p>
                                                    <p className={cn(
                                                        "text-xl font-bold mt-0.5",
                                                        (profileData.overall_missing_pct ?? 0) > 10 ? "text-warn" : ""
                                                    )}>
                                                        {profileData.overall_missing_pct?.toFixed(1)}%
                                                    </p>
                                                </div>
                                            </div>

                                            {profileData.class_balance != null && (
                                                <div>
                                                    <p className="text-xs font-bold uppercase text-muted-foreground tracking-wider mb-2">
                                                        Target Distribution — <span className="font-mono text-foreground">{configuration.targetCol}</span>
                                                    </p>
                                                    <div className="flex items-center gap-3">
                                                        <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden flex">
                                                            <div className="h-full bg-down transition-all" style={{ width: `${profileData.class_balance * 100}%` }} />
                                                            <div className="h-full bg-up" style={{ width: `${(1 - profileData.class_balance) * 100}%` }} />
                                                        </div>
                                                        <div className="text-xs whitespace-nowrap space-x-3 shrink-0">
                                                            <span className="text-down font-medium">{config.classLabels.positive} {(profileData.class_balance * 100).toFixed(1)}%</span>
                                                            <span className="text-up font-medium">{config.classLabels.negative} {((1 - profileData.class_balance) * 100).toFixed(1)}%</span>
                                                        </div>
                                                    </div>
                                                    {profileData.class_balance < 0.03 && (
                                                        <p className="flex items-center gap-1 text-xs text-warn mt-1.5">
                                                            <AlertTriangle className="h-3 w-3" />
                                                            {config.imbalanceWarning}
                                                        </p>
                                                    )}
                                                </div>
                                            )}

                                            {profileData.columns?.length > 0 && (
                                                <div>
                                                    <p className="text-xs font-bold uppercase text-muted-foreground tracking-wider mb-2">Feature Summary</p>
                                                    <div className="border rounded-md overflow-hidden">
                                                        <table className="w-full text-xs">
                                                            <thead className="bg-muted/40 text-muted-foreground">
                                                                <tr>
                                                                    <th className="px-3 py-2 text-left font-semibold">Column</th>
                                                                    <th className="px-3 py-2 text-left font-semibold">Type</th>
                                                                    <th className="px-3 py-2 text-right font-semibold">Missing</th>
                                                                    <th className="px-3 py-2 text-right font-semibold">Unique</th>
                                                                    <th className="px-3 py-2 text-right font-semibold">Median</th>
                                                                    <th className="px-3 py-2 text-right font-semibold">Range / Values</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {profileData.columns.map((col: any, i: number) => (
                                                                    <tr key={col.name} className={cn("border-t", i % 2 === 1 ? "bg-muted/10" : "")}>
                                                                        <td className="px-3 py-1.5 font-medium">{col.name}</td>
                                                                        <td className="px-3 py-1.5 text-muted-foreground font-mono">{col.dtype}</td>
                                                                        <td className={cn(
                                                                            "px-3 py-1.5 text-right tabular-nums",
                                                                            col.missing_pct > 10 ? "text-warn font-semibold" : col.missing_pct > 0 ? "text-muted-foreground" : ""
                                                                        )}>
                                                                            {col.missing_pct > 0 ? `${col.missing_pct}%` : "—"}
                                                                        </td>
                                                                        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{col.unique_count}</td>
                                                                        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                                                                            {col.median != null ? col.median.toLocaleString() : "—"}
                                                                        </td>
                                                                        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                                                                            {col.min != null
                                                                                ? `${col.min.toLocaleString()} – ${col.max?.toLocaleString()}`
                                                                                : `${col.unique_count} categories`}
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Algorithms & Validation */}
                            <div className="pt-4 border-t space-y-6">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="p-4 bg-muted/20 rounded border">
                                        <div className="text-xs uppercase font-bold text-muted-foreground mb-2">Algorithms (5 Models)</div>
                                        <ul className="text-sm list-disc list-inside space-y-1">
                                            <li>Logistic Regression (Baseline)</li>
                                            <li>Random Forest (Ensemble)</li>
                                            <li>XGBoost (Gradient Boosting)</li>
                                            <li>LightGBM (Gradient Boosting)</li>
                                            <li>Stacked Ensemble (Avg.)</li>
                                        </ul>
                                    </div>
                                    <div className="p-4 bg-muted/20 rounded border">
                                        <div className="text-xs uppercase font-bold text-muted-foreground mb-2">Validation Strategy</div>
                                        <div className="flex items-center gap-2 text-sm mb-2">
                                            <div className="h-2 w-full bg-muted rounded-full overflow-hidden flex">
                                                <div className="h-full bg-info w-[80%]"></div>
                                                <div className="h-full bg-warn w-[20%]"></div>
                                            </div>
                                        </div>
                                        <div className="flex justify-between text-xs text-muted-foreground">
                                            <span>80% Train (3-fold CV + Hyperparam Search)</span>
                                            <span>20% Holdout</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between">
                                    <p className="text-sm text-muted-foreground">
                                        Sentinel will train 5 models with hyperparameter tuning, auto class-balancing, and a stacked ensemble — ranked by holdout AUC.
                                    </p>
                                    <button
                                        onClick={handleStartTraining}
                                        disabled={trainMutation.isPending}
                                        className="btn-primary disabled:opacity-50 disabled:pointer-events-none"
                                    >
                                        {trainMutation.isPending ? (
                                            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Training...</>
                                        ) : (
                                            <><Play className="mr-2 h-4 w-4" /> {config.startButtonText}</>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {error && <div className="mt-4 p-3 bg-down/10 text-down rounded-md text-sm font-medium">{error}</div>}
                    </div>
                </div>
            )}

            {/* ── Model Results Grid ─────────────────────────── */}
            <div className="space-y-4">
                <div className="flex items-center justify-between border-b pb-2">
                    <h3 className="panel-title text-base">{config.resultsTitle}</h3>
                </div>

                {models && models.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {(() => {
                            const bestModel = [...models].sort((a, b) => (b.metrics?.auc || 0) - (a.metrics?.auc || 0))[0];

                            return models.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map((m) => (
                                <div key={m.id} className="panel p-5 hover:shadow-md transition-shadow relative">
                                    {isCompleted && m.id === bestModel?.id && m.metrics?.auc && (
                                        <span className="absolute -top-2 -right-2 badge badge-green text-[10px] px-2 py-1 rounded-full shadow-sm uppercase tracking-wider">
                                            Recommended
                                        </span>
                                    )}
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <h4 className="font-bold text-base capitalize">
                                                {m.algorithm === "lightgbm" ? "LightGBM" :
                                                 m.algorithm === "xgboost" ? "XGBoost" :
                                                 m.algorithm === "ensemble" ? "Stacked Ensemble" :
                                                 m.algorithm?.replace("_", " ")}
                                            </h4>
                                            <p className="text-xs text-muted-foreground font-mono mt-1">{m.name}</p>
                                        </div>
                                        <span className={cn(
                                            "badge",
                                            m.status === "TRAINING" && "badge-blue animate-pulse",
                                            m.status === "CANDIDATE" && "badge-muted",
                                            m.status === "ACTIVE" && "badge-green",
                                            m.status === "FAILED" && "badge-red",
                                        )}>
                                            {m.status === "TRAINING" ? "IN PROGRESS" : m.status}
                                        </span>
                                    </div>

                                    <div className="space-y-2">
                                        <div className="flex justify-between items-end">
                                            <span className="text-sm text-muted-foreground">AUC</span>
                                            <span className={cn(
                                                "text-2xl font-bold",
                                                (m.metrics?.auc || 0) > 0.8 ? "text-up" : "text-foreground"
                                            )}>
                                                {m.metrics?.auc ? (m.metrics.auc * 100).toFixed(1) + "%" : "--"}
                                            </span>
                                        </div>
                                        <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-up rounded-full transition-all duration-500"
                                                style={{ width: `${(m.metrics?.auc || 0) * 100}%` }}
                                            />
                                        </div>
                                        {m.metrics?.gini != null && (
                                            <div className="flex justify-between text-xs pt-0.5">
                                                <span className="text-muted-foreground">Gini</span>
                                                <span className="font-medium">{(m.metrics.gini * 100).toFixed(1)}%</span>
                                            </div>
                                        )}
                                        {m.metrics?.cv_auc_mean != null && (
                                            <div className="flex justify-between text-xs">
                                                <span className="text-muted-foreground">3-fold CV</span>
                                                <span className="font-medium">
                                                    {(m.metrics.cv_auc_mean * 100).toFixed(1)}%
                                                    {m.metrics.cv_auc_std != null && (
                                                        <span className="text-muted-foreground"> ±{(m.metrics.cv_auc_std * 100).toFixed(1)}%</span>
                                                    )}
                                                </span>
                                            </div>
                                        )}
                                        {m.metrics?.training_details?.configs_searched && (
                                            <div className="flex justify-between text-xs">
                                                <span className="text-muted-foreground">Configs Searched</span>
                                                <span className="font-medium">{m.metrics.training_details.configs_searched}</span>
                                            </div>
                                        )}
                                        {m.metrics?.training_details?.overfit_risk && (
                                            <div className="flex justify-between text-xs">
                                                <span className="text-muted-foreground">Overfit Risk</span>
                                                <span className={cn(
                                                    "font-medium",
                                                    m.metrics.training_details.overfit_risk === "HIGH" ? "text-down" :
                                                    m.metrics.training_details.overfit_risk === "MODERATE" ? "text-warn" :
                                                    "text-up"
                                                )}>
                                                    {m.metrics.training_details.overfit_risk}
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    <div className="mt-4 pt-4 border-t flex justify-between items-center">
                                        <span className="text-xs text-muted-foreground">
                                            {new Date(m.created_at).toLocaleTimeString()}
                                        </span>
                                        {m.status !== "TRAINING" && m.status !== "FAILED" && (
                                            <button
                                                onClick={() => navigate(`/systems/${systemId}/models/${m.id}`)}
                                                className="text-sm font-medium text-primary hover:underline"
                                            >
                                                View Details &rarr;
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))
                        })()}
                    </div>
                ) : (
                    !isTrainingActive && (
                        <div className="p-12 text-center bg-muted/20 rounded-xl border border-dashed">
                            <div className="bg-muted/30 rounded-full h-14 w-14 flex items-center justify-center mx-auto mb-4">
                                <Play className="h-7 w-7 text-muted-foreground/50" />
                            </div>
                            <h3 className="text-base font-semibold text-foreground mb-2">{config.emptyTitle}</h3>
                            <p className="text-muted-foreground text-sm max-w-md mx-auto mb-4">
                                {datasets && datasets.length > 0 ? config.emptyWithDatasets : config.emptyNoDatasets}
                            </p>
                            {(!datasets || datasets.length === 0) && (
                                <button
                                    onClick={() => navigate(`/systems/${systemId}/${config.datasetRoute}`)}
                                    className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                                >
                                    <FileText className="h-4 w-4" />
                                    {config.emptyLinkText}
                                </button>
                            )}
                        </div>
                    )
                )}
            </div>
        </div>
    );
}
