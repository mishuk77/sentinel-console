import { useNavigate, useParams } from "react-router-dom";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Dataset } from "@/lib/api";
import { api } from "@/lib/api";
import { Loader2, FileText, Upload, AlertCircle, Trash2, Play, ChevronDown, Settings2, Download, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { ColumnAnnotationEditor } from "@/components/datasets/ColumnAnnotationEditor";

export default function Datasets() {
    const { systemId } = useParams<{ systemId: string }>();
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [labelColumn, setLabelColumn] = useState<string>("");
    const [pendingFile, setPendingFile] = useState<File | null>(null);
    const [editingDataset, setEditingDataset] = useState<Dataset | null>(null);

    // Fetch Datasets
    const { data: datasets, isLoading } = useQuery<Dataset[]>({
        queryKey: ["datasets", systemId],
        queryFn: async () => {
            const res = await api.get("/datasets/", { params: { system_id: systemId } });
            return res.data;
        },
        enabled: !!systemId
    });

    // Upload Mutation
    const uploadMutation = useMutation({
        mutationFn: async (file: File) => {
            if (!systemId) throw new Error("No system context");
            const formData = new FormData();
            formData.append("file", file);
            formData.append("system_id", systemId);
            // Include label_column if specified
            if (labelColumn.trim()) {
                formData.append("label_column", labelColumn.trim());
            }
            await api.post("/datasets/upload", formData, {
                headers: { "Content-Type": "multipart/form-data" },
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["datasets"] });
            setUploadError(null);
            setPendingFile(null);
            setLabelColumn("");
            setShowAdvanced(false);
        },
        onError: (err: any) => {
            console.error(err);
            const detail = err?.response?.data?.detail;
            if (detail) {
                setUploadError(detail);
            } else if (err?.message) {
                setUploadError(`Upload failed: ${err.message}`);
            } else {
                setUploadError("Failed to upload dataset. Ensure it is a valid CSV with proper formatting.");
            }
        },
    });

    // Delete Mutation
    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            await api.delete(`/datasets/${id}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["datasets"] });
        },
        onError: (err) => {
            console.error(err);
            alert("Failed to delete dataset.");
        }
    });

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            if (showAdvanced) {
                // Store file, wait for user to configure and click upload
                setPendingFile(file);
            } else {
                // Direct upload
                uploadMutation.mutate(file);
            }
        }
    };

    const handleUploadWithOptions = () => {
        if (pendingFile) {
            uploadMutation.mutate(pendingFile);
        }
    };

    return (
        <div className="page">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="page-title">Datasets</h1>
                    <p className="page-desc">
                        Upload and manage your historical credit data for training.
                    </p>
                </div>
            </div>

            {/* Upload Area - OR - Success State */
                datasets && datasets.length > 0 && datasets[0].status === "VALID" ? (
                    <div className="panel p-8 flex flex-col items-center justify-center text-center animate-in fade-in">
                        <div className="icon-box bg-up/10 mb-4">
                            <FileText className="h-6 w-6 text-up" />
                        </div>
                        <h3 className="text-base font-bold mb-2">
                            Dataset Validated & Ready
                        </h3>
                        <p className="text-sm text-muted-foreground mb-6">
                            {datasets[0].metadata_info?.original_filename} ({datasets[0].metadata_info?.row_count?.toLocaleString()} rows)
                        </p>

                        <button
                            onClick={() => navigate(`/systems/${systemId}/training`)}
                            className="btn-primary"
                        >
                            Proceed to Training <Play className="h-5 w-5 fill-current" />
                        </button>

                        <div className="mt-6 text-xs text-muted-foreground">
                            Columns: {(datasets[0].metadata_info?.columns as string[])?.length || 0} detected
                        </div>
                    </div>
                ) : (
                    <div className="panel">
                        <div className="flex flex-col items-center justify-center border-2 border-dashed border-muted-foreground/25 rounded-lg p-5 transition-colors hover:bg-accent/50">
                            <Upload className="h-10 w-10 text-muted-foreground mb-4" />
                            <h3 className="text-lg font-semibold text-foreground">Upload CSV Dataset</h3>
                            <p className="text-sm text-muted-foreground mb-4 text-center max-w-sm">
                                Upload your historical credit data. The system will auto-detect the target column.
                            </p>

                            {/* Advanced Options Toggle */}
                            <button
                                type="button"
                                onClick={() => {
                                    setShowAdvanced(!showAdvanced);
                                    if (!showAdvanced) setPendingFile(null);
                                }}
                                className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4"
                            >
                                <Settings2 className="h-3.5 w-3.5" />
                                Advanced Options
                                <ChevronDown className={cn(
                                    "h-3.5 w-3.5 transition-transform",
                                    showAdvanced && "rotate-180"
                                )} />
                            </button>

                            {/* Advanced Options Panel */}
                            {showAdvanced && (
                                <div className="w-full max-w-sm mb-4 p-4 bg-muted/30 rounded-lg border space-y-3 animate-in fade-in slide-in-from-top-2">
                                    <div>
                                        <label className="text-xs font-medium text-foreground block mb-1">
                                            Target Column (Label)
                                        </label>
                                        <input
                                            type="text"
                                            placeholder="e.g., charged_off, default, bad_flag"
                                            className="field-input"
                                            value={labelColumn}
                                            onChange={(e) => setLabelColumn(e.target.value)}
                                        />
                                        <p className="text-[10px] text-muted-foreground mt-1">
                                            Leave blank for auto-detection
                                        </p>
                                    </div>

                                    {pendingFile && (
                                        <div className="flex items-center justify-between p-2 bg-background rounded border">
                                            <div className="flex items-center gap-2 text-sm">
                                                <FileText className="h-4 w-4 text-blue-600" />
                                                <span className="truncate max-w-[180px]">{pendingFile.name}</span>
                                            </div>
                                            <button
                                                onClick={handleUploadWithOptions}
                                                disabled={uploadMutation.isPending}
                                                className="text-xs bg-primary text-primary-foreground px-3 py-1 rounded hover:bg-primary/90 transition-colors"
                                            >
                                                {uploadMutation.isPending ? "Uploading..." : "Upload"}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            <label className="cursor-pointer">
                                <input
                                    type="file"
                                    accept=".csv"
                                    className="hidden"
                                    onChange={handleFileChange}
                                    disabled={uploadMutation.isPending}
                                />
                                <span className="btn-primary">
                                    {uploadMutation.isPending ? "Uploading..." : showAdvanced && pendingFile ? "Change File" : "Select File"}
                                </span>
                            </label>
                            {uploadError && (
                                <div className="mt-4 flex items-center text-destructive text-sm bg-destructive/10 p-3 rounded max-w-sm">
                                    <AlertCircle className="w-4 h-4 mr-2 shrink-0" />
                                    <span>{uploadError}</span>
                                </div>
                            )}
                        </div>
                    </div>
                )}

            {/* Datasets List */}
            <div className="panel overflow-hidden">
                <div className="panel-head">
                    <span className="panel-title">Historical Datasets</span>
                    <span className="text-xs font-medium text-muted-foreground">{datasets?.length || 0} files</span>
                </div>

                {isLoading ? (
                    <div className="p-12 text-center text-muted-foreground flex flex-col items-center">
                        <Loader2 className="h-8 w-8 animate-spin mb-4 opacity-50" />
                        Loading datasets...
                    </div>
                ) : datasets?.length === 0 ? (
                    <div className="p-12 text-center">
                        <div className="bg-muted/30 rounded-full h-14 w-14 flex items-center justify-center mx-auto mb-4">
                            <FileText className="h-7 w-7 text-muted-foreground/50" />
                        </div>
                        <h3 className="text-base font-semibold text-foreground mb-2">No Datasets Uploaded</h3>
                        <p className="text-muted-foreground text-sm max-w-md mx-auto mb-4">
                            Upload your historical credit data (CSV format) to begin training risk models.
                        </p>
                        <div className="text-xs text-muted-foreground bg-muted/20 inline-block px-4 py-2 rounded-lg">
                            <strong>Required:</strong> Include a target column (e.g., <code className="bg-muted px-1 rounded">charged_off</code>, <code className="bg-muted px-1 rounded">default</code>)
                        </div>
                    </div>
                ) : (
                    <table className="dt dt-hover">
                        <thead>
                            <tr>
                                <th>Context</th>
                                <th>Filename</th>
                                <th>Rows</th>
                                <th>Status</th>
                                <th>Uploaded At</th>
                                <th>Dollar metrics</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {datasets?.map((ds) => (
                                <tr key={ds.id}>
                                    <td className="font-mono text-xs text-muted-foreground truncate max-w-[100px]" title={ds.id}>
                                        {ds.id.slice(0, 8)}
                                    </td>
                                    <td className="font-medium flex items-center gap-3">
                                        <div className="icon-box-sm bg-info/10">
                                            <FileText className="h-4 w-4 text-info" />
                                        </div>
                                        {ds.metadata_info?.original_filename || "Unknown"}
                                    </td>
                                    <td className="font-medium">
                                        {ds.metadata_info?.row_count?.toLocaleString() || "Unknown"}
                                    </td>
                                    <td>
                                        <span className={cn(
                                            "badge",
                                            ds.status === "PENDING" && "badge-amber",
                                            ds.status === "VALID" && "badge-green",
                                            ds.status === "INVALID" && "badge-red",
                                            // @ts-ignore - FAILED is valid from API but missing in FE type def
                                            (ds.status as string) === "FAILED" && "badge-red",
                                        )}>
                                            {ds.status === "VALID" ? "READY" : ds.status}
                                        </span>
                                    </td>
                                    <td className="text-2xs text-muted-foreground">
                                        {new Date(ds.created_at).toLocaleDateString()} <span className="mx-1 text-muted-foreground/30">|</span> {new Date(ds.created_at).toLocaleTimeString()}
                                    </td>
                                    <td>
                                        {/* Surface how dollar metrics are computed for this dataset */}
                                        {ds.loss_amount_column ? (
                                            <span
                                                className="badge badge-blue text-xs"
                                                title={`Dollar loss = ${ds.loss_amount_column} (actual loss column). Most accurate.`}
                                            >
                                                Loss-tracked
                                            </span>
                                        ) : ds.approved_amount_column ? (
                                            <span
                                                className="badge badge-green text-xs"
                                                title={`Dollar loss = ${ds.approved_amount_column} × predicted probability (full principal at risk).`}
                                            >
                                                Principal-at-risk
                                            </span>
                                        ) : (
                                            <span
                                                className="badge badge-muted text-xs"
                                                title="No dollar metrics yet. Click the tag icon to annotate the approved-amount column."
                                            >
                                                Counts only
                                            </span>
                                        )}
                                    </td>
                                    <td className="text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            <button
                                                onClick={() => setEditingDataset(ds)}
                                                className="text-muted-foreground hover:text-info transition-colors p-2 rounded-full hover:bg-info/10"
                                                title="Tag columns to enable dollar metrics and segment breakouts"
                                            >
                                                <Tag className="h-4 w-4" />
                                            </button>
                                            <button
                                                onClick={async () => {
                                                    try {
                                                        const res = await api.get(`/datasets/${ds.id}/download`, { responseType: "blob" });
                                                        const url = window.URL.createObjectURL(new Blob([res.data]));
                                                        const a = document.createElement("a");
                                                        a.href = url;
                                                        a.download = ds.metadata_info?.original_filename || "dataset.csv";
                                                        a.click();
                                                        window.URL.revokeObjectURL(url);
                                                    } catch (e) {
                                                        console.error(e);
                                                        alert("Failed to download dataset.");
                                                    }
                                                }}
                                                className="text-muted-foreground hover:text-info transition-colors p-2 rounded-full hover:bg-info/10"
                                                title="Download Dataset"
                                            >
                                                <Download className="h-4 w-4" />
                                            </button>
                                            <button
                                                onClick={() => {
                                                    if (window.confirm("Are you sure you want to delete this dataset?")) {
                                                        deleteMutation.mutate(ds.id);
                                                    }
                                                }}
                                                className="text-muted-foreground hover:text-down transition-colors p-2 rounded-full hover:bg-down/10"
                                                title="Delete Dataset"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* TASK-6: column annotation editor modal */}
            {editingDataset && (
                <ColumnAnnotationEditor
                    dataset={editingDataset}
                    open={true}
                    onClose={() => setEditingDataset(null)}
                />
            )}
        </div >
    );
}
