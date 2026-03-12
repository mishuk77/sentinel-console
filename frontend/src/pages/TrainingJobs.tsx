import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Dataset, MLModel } from "@/lib/api";
import { api } from "@/lib/api";
import { Play, Loader2, Trophy, ArrowRight, FileText, CheckCircle2, Clock, Cpu, X, AlertTriangle, BarChart2 } from "lucide-react";
import { cn } from "@/lib/utils";

type TrainingState = 'IDLE' | 'STARTING' | 'TRAINING' | 'COMPLETED';

export default function TrainingJobs() {
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
    const [trainingState, setTrainingState] = useState<TrainingState>('IDLE');

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

    // Fetch Models (Jobs) — exclude fraud models
    const { data: allModels } = useQuery<MLModel[]>({
        queryKey: ["models", systemId],
        queryFn: async () => {
            const res = await api.get("/models/", { params: { system_id: systemId } });
            return res.data;
        },
        enabled: !!systemId,
        // Poll aggressively during STARTING and TRAINING phases
        refetchInterval: (query) => {
            const anyTraining = query.state.data?.some(m => m.status === "TRAINING");

            // If we are actively polling or just starting, poll every 1s
            if (trainingState === 'STARTING' || trainingState === 'TRAINING') return 1000;

            // If we passively see something training (e.g. page refresh), also poll
            if (anyTraining) return 1000;

            return false;
        }
    });
    const models = allModels?.filter(m => (m.metrics as any)?.model_context !== "fraud");

    // Elapsed time effect — keeps running through COMPLETED for the 5-second lag
    useEffect(() => {
        if (trainingState === 'STARTING' || trainingState === 'TRAINING' || trainingState === 'COMPLETED') {
            if (!startTimeRef.current) {
                startTimeRef.current = Date.now();
            }
            timerRef.current = setInterval(() => {
                if (startTimeRef.current) {
                    const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
                    setElapsedSeconds(elapsed);
                    // Stop timer once 5-second post-completion window has passed
                    if (trainingState === 'COMPLETED' && completedAtRef.current !== null && elapsed >= completedAtRef.current + 5) {
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
            // We only transition if we see a NEW model appear
            if (hasNewModels) {
                // Determine if the new model is already done or still training
                if (hasTrainingModels) {
                    setTrainingState('TRAINING');
                } else {
                    // It finished instantly!
                    completedAtRef.current = startTimeRef.current
                        ? Math.floor((Date.now() - startTimeRef.current) / 1000)
                        : 0;
                    setTrainingState('COMPLETED');
                }
            }
        } else if (trainingState === 'TRAINING') {
            if (!hasTrainingModels) {
                // Capture elapsed at the moment of completion, then transition
                completedAtRef.current = startTimeRef.current
                    ? Math.floor((Date.now() - startTimeRef.current) / 1000)
                    : 0;
                setTrainingState('COMPLETED');
            }
        }
    }, [models, trainingState]);

    // Start Training Mutation
    const trainMutation = useMutation({
        mutationFn: async ({ datasetId, payload }: { datasetId: string, payload: any }) => {
            await api.post(`/models/${datasetId}/train`, payload);
        },
        onSuccess: () => {
            // Snapshot the current model count BEFORE invalidating or fetching new ones
            initialModelCountRef.current = models?.length || 0;

            queryClient.invalidateQueries({ queryKey: ["models"] });
            setError(null);
            setWizardStep(0); // Reset wizard
            setSelectedDataset("");

            // Start the State Machine
            setTrainingState('STARTING');
        },
        onError: (err) => {
            console.error(err);
            setError("Failed to start training. Please try again.");
            setTrainingState('IDLE');
        },
    });

    // Cancel/dismiss training UI (acknowledge it may still be running)
    const handleDismissTraining = () => {
        setTrainingState('IDLE');
        startTimeRef.current = null;
        completedAtRef.current = null;
        setElapsedSeconds(0);
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
            const msg = e?.response?.data?.detail || e?.message || "Profile analysis failed. Check that the backend endpoint is available.";
            setProfileError(msg);
        } finally {
            setProfileLoading(false);
        }
    };

    // Clear profile when column selection changes
    useEffect(() => {
        setProfileData(null);
        setProfileError(null);
    }, [configuration.targetCol, configuration.featureCols.length]);

    // Auto-select dataset if available and not selected
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
                feature_cols: configuration.featureCols
            }
        });
    };

    const currentDataset = datasets?.find(d => d.id === selectedDataset);
    const columns = (currentDataset?.metadata_info?.columns as string[]) || [];

    // Format elapsed time
    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        if (mins > 0) {
            return `${mins}m ${secs}s`;
        }
        return `${secs}s`;
    };

    // 4-stage pipeline progression driven by state + elapsed time
    // COMPLETED introduces a 5-second lag before showing step 4 (to avoid jumping instantly)
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
    // Keep blue progress card visible during the 5-second post-completion lag
    const isTrainingActive = trainingState === 'STARTING' || trainingState === 'TRAINING'
        || (trainingState === 'COMPLETED' && trainingStep < 4);
    const isCompleted = trainingState === 'COMPLETED' && trainingStep >= 4;

    return (
        <div className="page">
            {/* Header */}
            <div>
                <h1 className="page-title">Training Jobs</h1>
                <p className="page-desc">
                    Launch model training jobs on your uploaded datasets.
                </p>
            </div>

            {/* Training Progress Card - Shows during active training + 5s lag */}
            {isTrainingActive && (
                <div className="panel border-info/30 bg-info/5 animate-in fade-in slide-in-from-top-4">
                    <div className="flex items-start justify-between mb-6 p-5 pb-0">
                        <div className="flex items-center gap-4">
                            <div className="bg-info/10 p-3 rounded-full">
                                <Cpu className="h-6 w-6 text-info animate-pulse" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold">Training in Progress</h3>
                                <p className="text-info text-sm">
                                    Sentinel is training 3 models using different algorithms
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
                            { step: 1, label: "Profiling Data" },
                            { step: 2, label: "Engineering Features" },
                            { step: 3, label: "Training 3 Models" },
                            { step: 4, label: "Building Leaderboard" },
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
                            {trainingStep === 1 && "Analyzing dataset quality and class balance..."}
                            {trainingStep === 2 && "Encoding features, stratified split, imputation..."}
                            {trainingStep === 3 && trainingState !== 'COMPLETED' && "Running 5-fold CV · Fitting Logistic Regression, Random Forest, XGBoost..."}
                            {trainingStep === 3 && trainingState === 'COMPLETED' && "Finalizing results and building model leaderboard..."}
                            {trainingState === 'STARTING' && elapsedSeconds >= 30 && (
                                <span className="text-warn">Taking longer than usual — still processing...</span>
                            )}
                        </div>
                    </div>

                    {/* Helpful message for long waits */}
                    {trainingState === 'STARTING' && elapsedSeconds >= 45 && (
                        <div className="mx-5 mb-5 mt-4 p-3 bg-warn/10 border border-warn/30 rounded-lg text-sm text-warn">
                            <strong>Note:</strong> The backend is processing your request. Models will appear automatically once created.
                            You can dismiss this and check back later - training continues in the background.
                        </div>
                    )}
                </div>
            )}

            {/* Success Banner - Only show after 5-second lag completes */}
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
                                    ? `Completed in ${formatTime(completedAtRef.current)}. `
                                    : ''}
                                Your models are ready for evaluation.
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() => navigate(`/systems/${systemId}/models`)}
                        className="btn-primary flex items-center gap-2"
                    >
                        Proceed to Model Selection <ArrowRight className="h-4 w-4" />
                    </button>
                </div>
            )}

            {/* Wizard Card - Only show when idle (hide after training completes) */}
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
                                    // Fetch Preview
                                    try {
                                        const res = await api.get(`/datasets/${selectedDataset}/preview`);
                                        setPreviewData(res.data);
                                        setWizardStep(1);
                                        setError(null);
                                        setTrainingState('IDLE'); // Reset any complete state if restarting wizard
                                    } catch (e) {
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

                    {/* Step 2: Preview & Confirmation */}
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
                                                        <td key={c.name} className="px-3 py-2 whitespace-nowrap">
                                                            {row[c.name]}
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="flex justify-end pt-4">
                                    <button
                                        onClick={() => setWizardStep(2)}
                                        className="btn-primary btn-sm"
                                    >
                                        Confirm & Configure &rarr;
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
                                            Target Variable (Y)
                                            <span className="text-xs font-normal text-muted-foreground">(The outcome to predict)</span>
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
                                                            // Remove from features if selected as target
                                                            featureCols: prev.featureCols.filter(c => c !== e.target.value)
                                                        }))}
                                                        className="accent-primary"
                                                    />
                                                    {col}
                                                </label>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Features (X) */}
                                    <div className="space-y-3">
                                        <label className="text-sm font-bold flex items-center gap-2">
                                            Feature Variables (X)
                                            <span className="text-xs font-normal text-muted-foreground">(Inputs for prediction)</span>
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
                                            Click "Analyze Selection" to inspect your data before training.
                                        </div>
                                    )}
                                    {profileError && (
                                        <div className="px-4 py-3 text-xs text-down bg-down/5 border-t border-down/20">
                                            {profileError}
                                        </div>
                                    )}

                                    {profileData && (
                                        <div className="p-4 space-y-4">
                                            {/* Summary row */}
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

                                            {/* Class balance */}
                                            {profileData.class_balance != null && (
                                                <div>
                                                    <p className="text-xs font-bold uppercase text-muted-foreground tracking-wider mb-2">
                                                        Target Distribution — <span className="font-mono text-foreground">{configuration.targetCol}</span>
                                                    </p>
                                                    <div className="flex items-center gap-3">
                                                        <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden flex">
                                                            <div
                                                                className="h-full bg-down transition-all"
                                                                style={{ width: `${profileData.class_balance * 100}%` }}
                                                            />
                                                            <div
                                                                className="h-full bg-up"
                                                                style={{ width: `${(1 - profileData.class_balance) * 100}%` }}
                                                            />
                                                        </div>
                                                        <div className="text-xs whitespace-nowrap space-x-3 shrink-0">
                                                            <span className="text-down font-medium">Bad {(profileData.class_balance * 100).toFixed(1)}%</span>
                                                            <span className="text-up font-medium">Good {((1 - profileData.class_balance) * 100).toFixed(1)}%</span>
                                                        </div>
                                                    </div>
                                                    {profileData.class_balance < 0.03 && (
                                                        <p className="flex items-center gap-1 text-xs text-warn mt-1.5">
                                                            <AlertTriangle className="h-3 w-3" />
                                                            Very low positive rate — class imbalance will be handled automatically.
                                                        </p>
                                                    )}
                                                </div>
                                            )}

                                            {/* Per-column table */}
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

                            {/* Configuration Summary & Action */}
                            <div className="pt-4 border-t space-y-6">

                                {/* Algorithms & Split Info (Static) */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="p-4 bg-muted/20 rounded border">
                                        <div className="text-xs uppercase font-bold text-muted-foreground mb-2">Algorithms</div>
                                        <ul className="text-sm list-disc list-inside space-y-1">
                                            <li>Logistic Regression (Baseline)</li>
                                            <li>Random Forest (Ensemble)</li>
                                            <li>XGBoost (Gradient Boosting)</li>
                                        </ul>
                                    </div>
                                    <div className="p-4 bg-muted/20 rounded border">
                                        <div className="text-xs uppercase font-bold text-muted-foreground mb-2">Validation Split</div>
                                        <div className="flex items-center gap-2 text-sm mb-2">
                                            <div className="h-2 w-full bg-muted rounded-full overflow-hidden flex">
                                                <div className="h-full bg-info w-[80%]"></div>
                                                <div className="h-full bg-warn w-[20%]"></div>
                                            </div>
                                        </div>
                                        <div className="flex justify-between text-xs text-muted-foreground">
                                            <span>80% Training</span>
                                            <span>20% Validation</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between">
                                    <p className="text-sm text-muted-foreground">
                                        Sentinel will train multiple models and recommend the best performer based on AUC on the validation set.
                                    </p>
                                    <button
                                        onClick={handleStartTraining}
                                        disabled={trainMutation.isPending}
                                        className="btn-primary disabled:opacity-50 disabled:pointer-events-none"
                                    >
                                        {trainMutation.isPending ? (
                                            <>
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Training...
                                            </>
                                        ) : (
                                            <>
                                                <Play className="mr-2 h-4 w-4" /> Start Training
                                            </>
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

            {/* Models List (Refined to Card Layout) */}
            <div className="space-y-4">
                <div className="flex items-center justify-between border-b pb-2">
                    <h3 className="panel-title text-base">Active Jobs & Results</h3>
                </div>

                {models && models.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {(() => {
                            // Find best model by AUC
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
                                            <h4 className="font-bold text-base capitalize">{m.algorithm?.replace("_", " ")}</h4>
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
                                                <span className="text-muted-foreground">5-fold CV</span>
                                                <span className="font-medium">
                                                    {(m.metrics.cv_auc_mean * 100).toFixed(1)}%
                                                    {m.metrics.cv_auc_std != null && (
                                                        <span className="text-muted-foreground"> ±{(m.metrics.cv_auc_std * 100).toFixed(1)}%</span>
                                                    )}
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
                    // Only show "No training jobs" if we are IDLE and not actively training
                    !isTrainingActive && (
                        <div className="p-12 text-center bg-muted/20 rounded-xl border border-dashed">
                            <div className="bg-muted/30 rounded-full h-14 w-14 flex items-center justify-center mx-auto mb-4">
                                <Play className="h-7 w-7 text-muted-foreground/50" />
                            </div>
                            <h3 className="text-base font-semibold text-foreground mb-2">No Training Jobs Yet</h3>
                            <p className="text-muted-foreground text-sm max-w-md mx-auto mb-4">
                                {datasets && datasets.length > 0
                                    ? "Use the wizard above to configure and start your first training job."
                                    : "Upload a dataset first, then return here to train models."}
                            </p>
                            {(!datasets || datasets.length === 0) && (
                                <button
                                    onClick={() => navigate(`/systems/${systemId}/datasets`)}
                                    className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                                >
                                    <FileText className="h-4 w-4" />
                                    Upload Dataset First
                                </button>
                            )}
                        </div>
                    )
                )}
            </div>
        </div>
    );
}
