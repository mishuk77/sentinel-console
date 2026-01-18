import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { MLModel } from "@/lib/api";
import { api } from "@/lib/api";
import { Terminal, Server, ShieldCheck, Copy, Check, Activity, Percent } from "lucide-react";
import { cn } from "@/lib/utils";
import { useParams } from "react-router-dom";
import { useSystem } from "@/lib/hooks";

export default function Deployments() {
    const { systemId } = useParams<{ systemId: string }>();
    const { system } = useSystem();
    const [copied, setCopied] = useState<string | null>(null);

    const { data: models } = useQuery<MLModel[]>({
        queryKey: ["models", systemId],
        queryFn: async () => {
            const res = await api.get("/models/", { params: { system_id: systemId } });
            return res.data;
        },
        enabled: !!systemId
    });

    const activeModel = models?.find(m => m.id === system.active_model_id);
    const activePolicy = system.active_policy_summary;
    const candidates = models?.filter(m => m.status === "CANDIDATE") || [];

    const deploymentList = [
        ...(activeModel ? [activeModel] : []),
        ...candidates
    ];

    const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
    // Default to active model if none selected
    const modelToDisplay = models?.find(m => m.id === selectedModelId) || activeModel || (models && models.length > 0 ? models[0] : undefined);

    const baseUrl = "http://localhost:8000/api/v1";

    const copyToClipboard = (text: string, key: string) => {
        navigator.clipboard.writeText(text);
        setCopied(key);
        setTimeout(() => setCopied(null), 2000);
    };



    const getCurlRaw = (modelId: string) => `curl -X POST "${baseUrl}/decisions/predict" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model_id": "${modelId}",
    "inputs": {
      "fico": 720,
      "income": 85000,
      "dti": 0.35
    }
  }'`;

    const getPythonRaw = (modelId: string) => `import requests

url = "${baseUrl}/decisions/predict"
payload = {
    "model_id": "${modelId}",
    "inputs": {
        "fico": 720,
        "income": 85000,
        "dti": 0.35
    }
}

response = requests.post(url, json=payload)
print(response.json())
# Output: {"model_id": "...", "score": 0.123, "timestamp": "..."}`;

    const getCurlDecision = () => `curl -X POST "${baseUrl}/decisions/${systemId}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "applicant_name": "John Doe",
    "inputs": {
      "fico": 720,
      "income": 85000,
      "dti": 0.35
    }
  }'`;

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-8 h-full flex flex-col">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-foreground">Integration & Deployment</h1>
                <p className="text-muted-foreground mt-2">
                    Use these code snippets to integrate your decision system into your application.
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 flex-1">
                {/* Deployment List */}
                <div className="lg:col-span-1 border rounded-xl bg-card overflow-hidden h-fit">
                    <div className="p-4 border-b bg-muted/30">
                        <h3 className="font-semibold">Available Endpoint Models</h3>
                    </div>
                    <div className="divide-y">
                        {(!models || models.length === 0) && (
                            <div className="p-8 text-center text-muted-foreground text-sm">
                                No models available. Train a model first.
                            </div>
                        )}
                        {deploymentList.map(m => (
                            <button
                                key={m.id}
                                onClick={() => setSelectedModelId(m.id)}
                                className={cn(
                                    "w-full text-left p-4 hover:bg-muted/50 transition-colors flex items-center justify-between group",
                                    (modelToDisplay?.id === m.id) ? "bg-muted/50 border-l-4 border-l-primary" : "border-l-4 border-l-transparent"
                                )}
                            >
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="font-semibold text-sm">{m.name}</span>
                                        {m.status === "ACTIVE" && (
                                            <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide">
                                                Active
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-xs text-muted-foreground mt-1 font-mono">
                                        ID: {m.id.substring(0, 8)}...
                                    </div>
                                </div>
                                <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Terminal className="h-4 w-4 text-muted-foreground" />
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Details / Integration */}
                <div className="lg:col-span-2 space-y-6">
                    {!modelToDisplay ? (
                        <div className="border rounded-xl bg-muted/10 p-12 flex flex-col items-center justify-center text-muted-foreground opacity-70">
                            <Server className="h-16 w-16 mb-4" />
                            <p>Select a model to view integration details.</p>
                        </div>
                    ) : (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                            {/* Model Header */}
                            <div className="border rounded-xl bg-card p-6 shadow-sm">
                                <div className="flex items-start justify-between">
                                    <div>
                                        <h2 className="text-2xl font-bold">{modelToDisplay.name}</h2>
                                        <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
                                            <span className="capitalize bg-secondary px-2 py-0.5 rounded text-foreground">{modelToDisplay.algorithm.replace("_", " ")}</span>
                                            <span className="font-mono">v.{modelToDisplay.id}</span>
                                        </div>
                                    </div>
                                    {modelToDisplay.status === "ACTIVE" ? (
                                        <div className="flex flex-col items-end">
                                            <div className="flex items-center gap-2 text-green-600 font-medium">
                                                <span className="relative flex h-2.5 w-2.5">
                                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                                                </span>
                                                Production Endpoint
                                            </div>
                                            <p className="text-xs text-muted-foreground mt-1">Ready for traffic</p>
                                        </div>
                                    ) : (
                                        <div className="text-muted-foreground text-sm bg-muted px-3 py-1 rounded-full">
                                            Candidate (Testing Only)
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Integration Snippets */}
                            <div className="space-y-6">
                                {/* Option 1: FULL DECISION (Primary) */}
                                {modelToDisplay.status === "ACTIVE" && (
                                    <div className="border rounded-xl bg-blue-50/20 border-blue-100 overflow-hidden shadow-sm">
                                        <div className="p-4 border-b bg-blue-50/50 flex items-center gap-2">
                                            <ShieldCheck className="h-5 w-5 text-blue-600" />
                                            <h3 className="font-semibold text-sm text-blue-900">Recommended: Full Decision API</h3>
                                        </div>
                                        <div className="p-6 space-y-4">
                                            <p className="text-sm text-muted-foreground">
                                                This endpoint automatically uses the currently <span className="font-bold text-green-700">Active Model</span> and <span className="font-bold text-green-700">Active Policy</span> for this system.
                                                <br />Use this for production integrations to ensure consistency.
                                            </p>
                                            <div className="space-y-2">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-xs font-medium uppercase text-muted-foreground">cURL</span>
                                                    <button
                                                        onClick={() => copyToClipboard(getCurlDecision(), 'decision')}
                                                        className="text-xs flex items-center gap-1 hover:text-primary transition-colors"
                                                    >
                                                        {copied === 'decision' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                                        {copied === 'decision' ? "Copied!" : "Copy"}
                                                    </button>
                                                </div>
                                                <pre className="bg-slate-950 text-slate-50 p-4 rounded-lg text-xs font-mono overflow-x-auto whitespace-pre-wrap">
                                                    {getCurlDecision()}
                                                </pre>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Option 2: RAW PREDICTION */}
                                <div className="border rounded-xl bg-card overflow-hidden shadow-sm">
                                    <div className="p-4 border-b bg-muted/30 flex items-center gap-2">
                                        <Terminal className="h-4 w-4 text-foreground" />
                                        <h3 className="font-semibold text-sm">Direct Model Access (Raw Score)</h3>
                                    </div>
                                    <div className="p-6 space-y-4">
                                        <p className="text-sm text-muted-foreground">
                                            Get a raw probability score directly from the <strong>{modelToDisplay.name}</strong> model artifact.
                                            <br />
                                            <span className="text-yellow-600 font-medium text-xs">WARNING: This ignores system policies and thresholds. Use only for testing or custom logic.</span>
                                        </p>

                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs font-medium uppercase text-muted-foreground">Python (Requests)</span>
                                                <button
                                                    onClick={() => copyToClipboard(getPythonRaw(modelToDisplay.id), 'python')}
                                                    className="text-xs flex items-center gap-1 hover:text-primary transition-colors"
                                                >
                                                    {copied === 'python' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                                    {copied === 'python' ? "Copied!" : "Copy"}
                                                </button>
                                            </div>
                                            <div className="relative group">
                                                <pre className="bg-slate-950 text-slate-50 p-4 rounded-lg text-xs font-mono overflow-x-auto">
                                                    {getPythonRaw(modelToDisplay.id)}
                                                </pre>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
