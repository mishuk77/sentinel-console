import { useNavigate, useParams } from "react-router-dom";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Dataset } from "@/lib/api";
import { api } from "@/lib/api";
import { Loader2, FileText, Upload, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Datasets() {
    const { systemId } = useParams<{ systemId: string }>();
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const [uploadError, setUploadError] = useState<string | null>(null);

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
            await api.post("/datasets/upload", formData, {
                headers: { "Content-Type": "multipart/form-data" },
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["datasets"] });
            setUploadError(null);
        },
        onError: (err) => {
            console.error(err);
            setUploadError("Failed to upload dataset. Ensure it is a valid CSV.");
        },
    });

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            uploadMutation.mutate(e.target.files[0]);
        }
    };

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-8">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground">Datasets</h1>
                    <p className="text-muted-foreground mt-2">
                        Upload and manage your historical credit data for training.
                    </p>
                </div>
            </div>

            {/* Upload Area */}
            <div className="bg-card border rounded-xl p-8 shadow-sm">
                <div className="flex flex-col items-center justify-center border-2 border-dashed border-muted-foreground/25 rounded-lg p-12 transition-colors hover:bg-accent/50">
                    <Upload className="h-10 w-10 text-muted-foreground mb-4" />
                    <h3 className="text-lg font-semibold text-foreground">Upload CSV Dataset</h3>
                    <p className="text-sm text-muted-foreground mb-6 text-center max-w-sm">
                        Drag and drop your file here, or click to browse. Expected columns: <code>loan_amnt</code>, <code>fico</code>, <code>income</code>, <code>charge_off</code>.
                    </p>
                    <label className="cursor-pointer">
                        <input
                            type="file"
                            accept=".csv"
                            className="hidden"
                            onChange={handleFileChange}
                            disabled={uploadMutation.isPending}
                        />
                        <span className={cn(
                            "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
                            "bg-primary text-primary-foreground shadow hover:bg-primary/90",
                            "h-10 px-8 py-2"
                        )}>
                            {uploadMutation.isPending ? "Uploading..." : "Select File"}
                        </span>
                    </label>
                    {uploadError && (
                        <div className="mt-4 flex items-center text-destructive text-sm bg-destructive/10 p-2 rounded">
                            <AlertCircle className="w-4 h-4 mr-2" />
                            {uploadError}
                        </div>
                    )}
                </div>
            </div>

            {/* Validation Feedback (Last Upload) */}
            {datasets && datasets.length > 0 && new Date(datasets[0].created_at).getTime() > Date.now() - 60000 && (
                <div className="bg-green-50 border border-green-100 rounded-xl p-6 flex items-start justify-between animate-in fade-in slide-in-from-top-4">
                    <div>
                        <h3 className="text-lg font-semibold text-green-900 flex items-center gap-2">
                            <FileText className="h-5 w-5" />
                            Dataset Validated & Ready
                        </h3>
                        <div className="mt-4 grid grid-cols-3 gap-8">
                            <div>
                                <p className="text-xs uppercase font-bold text-green-700">Filename</p>
                                <p className="text-sm font-medium">{datasets[0].metadata_info?.original_filename}</p>
                            </div>
                            <div>
                                <p className="text-xs uppercase font-bold text-green-700">Row Count</p>
                                <p className="text-sm font-medium">{datasets[0].metadata_info?.row_count?.toLocaleString() || "N/A"} rows</p>
                            </div>
                            <div>
                                <p className="text-xs uppercase font-bold text-green-700">Columns Detected</p>
                                <p className="text-sm font-medium">{(datasets[0].metadata_info?.columns as string[])?.length || 0} cols</p>
                            </div>
                        </div>
                        <div className="mt-4">
                            <span className="text-xs text-green-700 font-medium bg-green-200/50 px-2 py-1 rounded">Target candidate: Charge_Off, Loan_Status (Auto-detected)</span>
                        </div>
                    </div>
                    <button
                        onClick={() => navigate(`/systems/${systemId}/training`)}
                        className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors shadow-sm"
                    >
                        Proceed to Training &rarr;
                    </button>
                </div>
            )}

            {/* Datasets List */}
            <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b flex justify-between items-center bg-gray-50/50">
                    <h3 className="font-semibold text-lg text-gray-900">Historical Datasets</h3>
                    <span className="text-xs font-medium text-muted-foreground">{datasets?.length || 0} files</span>
                </div>

                {isLoading ? (
                    <div className="p-12 text-center text-muted-foreground flex flex-col items-center">
                        <Loader2 className="h-8 w-8 animate-spin mb-4 opacity-50" />
                        Loading datasets...
                    </div>
                ) : datasets?.length === 0 ? (
                    <div className="p-12 text-center text-muted-foreground">
                        <div className="bg-muted/50 rounded-full h-12 w-12 flex items-center justify-center mx-auto mb-4">
                            <FileText className="h-6 w-6 opacity-50" />
                        </div>
                        No datasets found. Upload one above to get started.
                    </div>
                ) : (
                    <table className="w-full text-sm text-left">
                        <thead className="bg-muted/30 text-muted-foreground uppercase font-semibold text-xs tracking-wider">
                            <tr>
                                <th className="px-6 py-4">Context</th>
                                <th className="px-6 py-4">Filename</th>
                                <th className="px-6 py-4">Rows</th>
                                <th className="px-6 py-4">Status</th>
                                <th className="px-6 py-4">Uploaded At</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {datasets?.map((ds) => (
                                <tr key={ds.id} className="hover:bg-gray-50/80 transition-colors">
                                    <td className="px-6 py-4 font-mono text-xs text-muted-foreground truncate max-w-[100px]" title={ds.id}>
                                        {ds.id.slice(0, 8)}
                                    </td>
                                    <td className="px-6 py-4 font-medium text-gray-900 flex items-center gap-3">
                                        <div className="bg-blue-50 border border-blue-100 p-2 rounded">
                                            <FileText className="h-4 w-4 text-blue-600" />
                                        </div>
                                        {ds.metadata_info?.original_filename || "Unknown"}
                                    </td>
                                    <td className="px-6 py-4 text-gray-700 font-medium">
                                        {ds.metadata_info?.row_count?.toLocaleString() || "Unknown"}
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={cn(
                                            "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset",
                                            ds.status === "PENDING" && "bg-yellow-50 text-yellow-800 ring-yellow-600/20",
                                            // Map VALID to Green style (Ready)
                                            ds.status === "VALID" && "bg-green-50 text-green-800 ring-green-600/20",
                                            ds.status === "INVALID" && "bg-red-50 text-red-800 ring-red-600/20",
                                            // @ts-ignore - FAILED is valid from API but missing in FE type def
                                            (ds.status as string) === "FAILED" && "bg-red-50 text-red-800 ring-red-600/20",
                                        )}>
                                            {ds.status === "VALID" ? "READY" : ds.status}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-muted-foreground text-xs">
                                        {new Date(ds.created_at).toLocaleDateString()} <span className="text-gray-300">|</span> {new Date(ds.created_at).toLocaleTimeString()}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div >
    );
}
