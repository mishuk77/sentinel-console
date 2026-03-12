import { useNavigate, useParams } from "react-router-dom";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Dataset } from "@/lib/api";
import { api } from "@/lib/api";
import { Loader2, FileText, Upload, AlertCircle, Trash2, Play, ChevronDown, Settings2, Database, ArrowRight, Info } from "lucide-react";
import { cn } from "@/lib/utils";

const FRAUD_LABEL_HINTS = ["is_fraud", "fraud_flag", "fraud", "fraudulent", "label"];
const FRAUD_ATTR_HINTS = ["velocity", "device", "ip_", "email_age", "phone_age", "address_age", "bureau_mismatch", "identity", "behavioral", "session", "fingerprint"];

export default function FraudData() {
    const { systemId } = useParams<{ systemId: string }>();
    const queryClient = useQueryClient();
    const navigate = useNavigate();

    const [useOriginal, setUseOriginal] = useState<boolean | null>(null);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [labelColumn, setLabelColumn] = useState<string>("");
    const [pendingFile, setPendingFile] = useState<File | null>(null);

    const { data: datasets, isLoading } = useQuery<Dataset[]>({
        queryKey: ["datasets", systemId],
        queryFn: async () => {
            const res = await api.get("/datasets/", { params: { system_id: systemId } });
            return res.data;
        },
        enabled: !!systemId
    });

    const uploadMutation = useMutation({
        mutationFn: async (file: File) => {
            if (!systemId) throw new Error("No system context");
            const formData = new FormData();
            formData.append("file", file);
            formData.append("system_id", systemId);
            if (labelColumn.trim()) formData.append("label_column", labelColumn.trim());
            await api.post("/datasets/upload", formData, { headers: { "Content-Type": "multipart/form-data" } });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["datasets"] });
            setUploadError(null);
            setPendingFile(null);
            setLabelColumn("");
            setShowAdvanced(false);
        },
        onError: (err: any) => {
            setUploadError(err?.response?.data?.detail || err?.message || "Upload failed.");
        },
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: string) => { await api.delete(`/datasets/${id}`); },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["datasets"] }),
    });

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0]) {
            const file = e.target.files[0];
            if (showAdvanced) { setPendingFile(file); } else { uploadMutation.mutate(file); }
        }
    };

    const validDatasets = datasets?.filter(d => d.status === "VALID") || [];
    const hasValidDataset = validDatasets.length > 0;

    const fraudLikelyDataset = validDatasets.find(d => {
        const cols = (d.metadata_info?.columns as string[]) || [];
        return cols.some(c => FRAUD_LABEL_HINTS.some(h => c.toLowerCase().includes(h)));
    });

    return (
        <div className="page">
            <div>
                <h1 className="page-title">Fraud Data</h1>
                <p className="page-desc">Provide labeled fraud data to train your fraud detection model.</p>
            </div>

            {/* Step 1: Source question */}
            {useOriginal === null && hasValidDataset && (
                <div className="panel p-6">
                    <h3 className="text-sm font-bold mb-1 flex items-center gap-2">
                        <Database className="h-4 w-4 text-primary" />
                        Does your original credit file include fraud labels?
                    </h3>
                    <p className="text-xs text-muted-foreground mb-5">
                        {fraudLikelyDataset
                            ? <>We detected a column that looks like a fraud label in <strong>{fraudLikelyDataset.metadata_info?.original_filename}</strong>. You may be able to reuse it.</>
                            : "If your existing credit dataset already has a fraud indicator column, you can train on that. Otherwise, upload a separate fraud-labeled dataset."}
                    </p>
                    <div className="grid grid-cols-2 gap-4 max-w-lg">
                        <button onClick={() => setUseOriginal(true)}
                            className="p-4 rounded border border-input hover:border-primary hover:bg-primary/5 text-left transition-all">
                            <p className="text-sm font-semibold mb-1">Yes — use existing file</p>
                            <p className="text-xs text-muted-foreground">Reuse the credit dataset that already has a fraud column.</p>
                        </button>
                        <button onClick={() => setUseOriginal(false)}
                            className="p-4 rounded border border-input hover:border-primary hover:bg-primary/5 text-left transition-all">
                            <p className="text-sm font-semibold mb-1">No — upload fraud dataset</p>
                            <p className="text-xs text-muted-foreground">Upload a separate file with fraud-specific labels and attributes.</p>
                        </button>
                    </div>
                </div>
            )}

            {/* Guidance banner */}
            {(useOriginal === false || !hasValidDataset) && (
                <div className="panel p-5 border-info/20">
                    <div className="flex items-start gap-3">
                        <Info className="h-4 w-4 text-info shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-semibold mb-2">What your fraud dataset needs</p>
                            <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs text-muted-foreground">
                                <div>
                                    <p className="font-medium text-foreground mb-1">Required</p>
                                    <p><span className="font-mono bg-muted px-1 rounded">fraud_label</span> — 1 = fraud, 0 = legitimate</p>
                                    <p><span className="font-mono bg-muted px-1 rounded">applicant_id</span> — to join with credit records</p>
                                </div>
                                <div>
                                    <p className="font-medium text-foreground mb-1">Useful fraud signals</p>
                                    <p>Velocity checks, device/IP attributes</p>
                                    <p>Bureau identity mismatches</p>
                                    <p>Email / phone / address age</p>
                                    <p>Behavioral or session signals</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Upload area */}
            {(useOriginal === false || (!hasValidDataset && useOriginal === null)) && (
                <div className="panel">
                    <div className="flex flex-col items-center justify-center border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 hover:bg-accent/50 transition-colors">
                        <Upload className="h-10 w-10 text-muted-foreground mb-4" />
                        <h3 className="text-lg font-semibold">Upload Fraud Dataset</h3>
                        <p className="text-sm text-muted-foreground mb-4 text-center max-w-sm">
                            CSV file with fraud labels and risk attributes. Target column is auto-detected.
                        </p>

                        <button type="button"
                            onClick={() => { setShowAdvanced(!showAdvanced); if (!showAdvanced) setPendingFile(null); }}
                            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4">
                            <Settings2 className="h-3.5 w-3.5" />
                            Advanced Options
                            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showAdvanced && "rotate-180")} />
                        </button>

                        {showAdvanced && (
                            <div className="w-full max-w-sm mb-4 p-4 bg-muted/30 rounded-lg border space-y-3 animate-in fade-in">
                                <div>
                                    <label className="text-xs font-medium block mb-1">Fraud Label Column</label>
                                    <input type="text" placeholder="e.g., is_fraud, fraud_flag"
                                        className="field-input" value={labelColumn}
                                        onChange={(e) => setLabelColumn(e.target.value)} />
                                    <p className="text-[10px] text-muted-foreground mt-1">Leave blank for auto-detection</p>
                                </div>
                                {pendingFile && (
                                    <div className="flex items-center justify-between p-2 bg-background rounded border">
                                        <div className="flex items-center gap-2 text-sm">
                                            <FileText className="h-4 w-4 text-info" />
                                            <span className="truncate max-w-[180px]">{pendingFile.name}</span>
                                        </div>
                                        <button onClick={() => uploadMutation.mutate(pendingFile!)}
                                            disabled={uploadMutation.isPending}
                                            className="text-xs bg-primary text-primary-foreground px-3 py-1 rounded">
                                            {uploadMutation.isPending ? "Uploading…" : "Upload"}
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        <label className="cursor-pointer">
                            <input type="file" accept=".csv" className="hidden" onChange={handleFileChange} disabled={uploadMutation.isPending} />
                            <span className="btn-primary">
                                {uploadMutation.isPending ? "Uploading…" : showAdvanced && pendingFile ? "Change File" : "Select File"}
                            </span>
                        </label>

                        {uploadError && (
                            <div className="mt-4 flex items-center text-destructive text-sm bg-destructive/10 p-3 rounded max-w-sm">
                                <AlertCircle className="w-4 h-4 mr-2 shrink-0" /> {uploadError}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Existing dataset selector */}
            {useOriginal === true && (
                <div className="panel p-5">
                    <h3 className="text-sm font-semibold mb-3">Select dataset with fraud labels</h3>
                    <div className="space-y-2 mb-4">
                        {validDatasets.map(ds => {
                            const cols = (ds.metadata_info?.columns as string[]) || [];
                            const fraudCol = cols.find(c => FRAUD_LABEL_HINTS.some(h => c.toLowerCase().includes(h)));
                            const fraudAttrs = cols.filter(c => FRAUD_ATTR_HINTS.some(h => c.toLowerCase().includes(h)));
                            return (
                                <div key={ds.id} className="p-4 rounded border bg-muted/10 flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium">{ds.metadata_info?.original_filename}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {ds.metadata_info?.row_count?.toLocaleString()} rows ·{" "}
                                            {fraudCol
                                                ? <span className="text-up">Fraud label: <span className="font-mono">{fraudCol}</span></span>
                                                : <span className="text-warn">No fraud label detected</span>}
                                            {fraudAttrs.length > 0 && <> · {fraudAttrs.length} fraud-relevant attrs</>}
                                        </p>
                                    </div>
                                    <button onClick={() => navigate(`/systems/${systemId}/fraud/training`)} className="btn-primary btn-sm">
                                        Train on this <ArrowRight className="h-3 w-3" />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                    <button onClick={() => setUseOriginal(null)} className="text-xs text-muted-foreground hover:text-foreground">← Go back</button>
                </div>
            )}

            {/* Proceed CTA after upload */}
            {hasValidDataset && useOriginal === false && (
                <div className="panel p-5 border-up/20 flex items-center justify-between">
                    <div>
                        <p className="text-sm font-semibold">Dataset ready</p>
                        <p className="text-xs text-muted-foreground">{validDatasets[0].metadata_info?.original_filename} · {validDatasets[0].metadata_info?.row_count?.toLocaleString()} rows</p>
                    </div>
                    <button onClick={() => navigate(`/systems/${systemId}/fraud/training`)} className="btn-primary">
                        Proceed to Training <Play className="h-4 w-4 fill-current" />
                    </button>
                </div>
            )}

            {/* Datasets table */}
            <div className="panel overflow-hidden">
                <div className="panel-head">
                    <span className="panel-title">Available Datasets</span>
                    <span className="text-xs text-muted-foreground">{datasets?.length || 0} files</span>
                </div>
                {isLoading ? (
                    <div className="p-12 text-center flex flex-col items-center text-muted-foreground">
                        <Loader2 className="h-8 w-8 animate-spin mb-4 opacity-50" /> Loading…
                    </div>
                ) : datasets?.length === 0 ? (
                    <div className="p-12 text-center">
                        <div className="bg-muted/30 rounded-full h-14 w-14 flex items-center justify-center mx-auto mb-4">
                            <FileText className="h-7 w-7 text-muted-foreground/50" />
                        </div>
                        <h3 className="text-base font-semibold mb-2">No Datasets</h3>
                        <p className="text-sm text-muted-foreground">Upload a CSV with a fraud label column (e.g., <code className="bg-muted px-1 rounded">is_fraud</code>).</p>
                    </div>
                ) : (
                    <table className="dt dt-hover">
                        <thead>
                            <tr>
                                <th>Filename</th>
                                <th>Rows</th>
                                <th>Fraud Label</th>
                                <th>Status</th>
                                <th>Uploaded</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {datasets?.map((ds) => {
                                const cols = (ds.metadata_info?.columns as string[]) || [];
                                const fraudCol = cols.find(c => FRAUD_LABEL_HINTS.some(h => c.toLowerCase().includes(h)));
                                return (
                                    <tr key={ds.id}>
                                        <td className="font-medium flex items-center gap-3">
                                            <div className="icon-box-sm bg-info/10"><FileText className="h-4 w-4 text-info" /></div>
                                            {ds.metadata_info?.original_filename || "Unknown"}
                                        </td>
                                        <td>{ds.metadata_info?.row_count?.toLocaleString() || "—"}</td>
                                        <td>{fraudCol ? <span className="font-mono text-xs text-up">{fraudCol}</span> : <span className="text-xs text-muted-foreground">Not detected</span>}</td>
                                        <td>
                                            <span className={cn("badge",
                                                ds.status === "PENDING" && "badge-amber",
                                                ds.status === "VALID" && "badge-green",
                                                (ds.status === "INVALID" || (ds.status as string) === "FAILED") && "badge-red")}>
                                                {ds.status === "VALID" ? "READY" : ds.status}
                                            </span>
                                        </td>
                                        <td className="text-xs text-muted-foreground">{new Date(ds.created_at).toLocaleDateString()}</td>
                                        <td className="text-right">
                                            <button onClick={() => { if (window.confirm("Delete this dataset?")) deleteMutation.mutate(ds.id); }}
                                                className="text-muted-foreground hover:text-down p-2 rounded-full hover:bg-down/10 transition-colors">
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
