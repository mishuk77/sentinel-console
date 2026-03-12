import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { MLModel } from "@/lib/api";
import { api, API_BASE_URL } from "@/lib/api";
import { Terminal, ShieldCheck, Copy, Check, Globe, CreditCard, ShieldAlert, Zap, Play, Loader2, Calculator, X, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useParams } from "react-router-dom";
import { useSystem } from "@/lib/hooks";

type CommandType = "curl" | "powershell" | "python";

export default function Deployments() {
    const { systemId } = useParams<{ systemId: string }>();
    const { system } = useSystem();
    const queryClient = useQueryClient();
    const [copied, setCopied] = useState<string | null>(null);
    const [commandType, setCommandType] = useState<CommandType>("curl");

    // Sandbox state
    const [sandboxBody, setSandboxBody] = useState<string>("");
    const [sandboxEndpoint, setSandboxEndpoint] = useState<"full" | "credit" | "fraud">("full");
    const [sandboxResponse, setSandboxResponse] = useState<string>("");

    // Manual test form state
    const [manualForm, setManualForm] = useState({
        applicant_name: "John Doe",
    });
    const [manualResponse, setManualResponse] = useState<any>(null);

    const { data: allModels } = useQuery<MLModel[]>({
        queryKey: ["models", systemId],
        queryFn: async () => {
            const res = await api.get("/models/", { params: { system_id: systemId } });
            return res.data;
        },
        enabled: !!systemId
    });

    const creditModels = allModels?.filter(m => (m.metrics as any)?.model_context !== "fraud") || [];
    const fraudModels = allModels?.filter(m => (m.metrics as any)?.model_context === "fraud") || [];

    const activeCreditModel = creditModels.find(m => m.status === "ACTIVE");
    const activeFraudModel = fraudModels.find(m => m.status === "ACTIVE");

    const baseUrl = API_BASE_URL;

    // Extract real feature columns from model metrics
    const getFeatureColumns = (model: MLModel | undefined): string[] => {
        if (!model?.metrics) return [];
        const fi = (model.metrics as any)?.feature_importance;
        if (Array.isArray(fi)) return fi.map((f: any) => f.feature || f.name).filter(Boolean);
        if (fi && typeof fi === "object") return Object.keys(fi);
        return [];
    };

    const creditFeatures = useMemo(() => getFeatureColumns(activeCreditModel), [activeCreditModel]);
    const fraudFeatures = useMemo(() => getFeatureColumns(activeFraudModel), [activeFraudModel]);

    // Build sample input values
    const buildSampleInputs = (features: string[]): Record<string, any> => {
        const samples: Record<string, any> = {};
        for (const f of features) {
            const fl = f.toLowerCase();
            if (fl.includes("fico") || fl.includes("score")) samples[f] = 720;
            else if (fl.includes("income") || fl.includes("annual")) samples[f] = 85000;
            else if (fl.includes("dti")) samples[f] = 0.35;
            else if (fl.includes("amount") || fl.includes("loan_amount")) samples[f] = 25000;
            else if (fl.includes("employment") || fl.includes("length")) samples[f] = 5;
            else if (fl.includes("grade")) samples[f] = 0;
            else if (fl.includes("utilization") || fl.includes("revolving")) samples[f] = 0.45;
            else if (fl.includes("inquiries") || fl.includes("inq")) samples[f] = 1;
            else if (fl.includes("derogatory") || fl.includes("derog")) samples[f] = 0;
            else if (fl.includes("distance")) samples[f] = 12.5;
            else if (fl.includes("time") || fl.includes("since")) samples[f] = 24;
            else if (fl.includes("merchant") || fl.includes("category")) samples[f] = 5411;
            else if (fl.includes("transaction")) samples[f] = 150.0;
            else samples[f] = 1;
        }
        return samples;
    };

    const creditSampleInputs = useMemo(() => buildSampleInputs(creditFeatures), [creditFeatures]);
    const fraudSampleInputs = useMemo(() => buildSampleInputs(fraudFeatures), [fraudFeatures]);

    // Merge all inputs for the full decision endpoint
    const fullSampleInputs = useMemo(() => ({
        ...creditSampleInputs,
        ...fraudSampleInputs,
    }), [creditSampleInputs, fraudSampleInputs]);

    const copyToClipboard = (text: string, key: string) => {
        navigator.clipboard.writeText(text);
        setCopied(key);
        setTimeout(() => setCopied(null), 2000);
    };

    const formatJson = (obj: any, indent = 6) => {
        const pad = " ".repeat(indent);
        return Object.entries(obj).map(([k, v]) =>
            `${pad}"${k}": ${typeof v === "string" ? `"${v}"` : v}`
        ).join(",\n");
    };

    // ── Full Decision Endpoint ──────────────────────────────────
    const fullDecisionCurl = () => `curl -X POST "${baseUrl}/decisions/${systemId}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "applicant_name": "John Doe",
    "inputs": {
${formatJson(fullSampleInputs)}
    }
  }'`;

    const fullDecisionPowershell = () => {
        const psInputs = Object.entries(fullSampleInputs).map(([k, v]) =>
            `        ${k} = ${typeof v === "string" ? `"${v}"` : v}`
        ).join("\n");
        return `$body = @{
    applicant_name = "John Doe"
    inputs = @{
${psInputs}
    }
} | ConvertTo-Json -Depth 3

Invoke-RestMethod \`
  -Uri "${baseUrl}/decisions/${systemId}" \`
  -Method POST \`
  -ContentType "application/json" \`
  -Body $body`;
    };

    const fullDecisionPython = () => `import requests

response = requests.post(
    "${baseUrl}/decisions/${systemId}",
    json={
        "applicant_name": "John Doe",
        "inputs": {
${Object.entries(fullSampleInputs).map(([k, v]) =>
    `            "${k}": ${typeof v === "string" ? `"${v}"` : v}`
).join(",\n")}
        }
    }
)
result = response.json()
print(result)
# Bureau-style response:
#   inquiry_id                          - Unique decision record ID
#   credit_risk_assessment.probability_of_default  - Credit risk score
#   credit_risk_assessment.decision     - APPROVE / DECLINE
#   adverse_action_notice.factors[]     - SHAP-based adverse action attributes
#   fraud_risk_assessment.fraud_probability - Fraud model score
#   fraud_risk_assessment.risk_tier     - LOW / MEDIUM / HIGH / CRITICAL
#   fraud_risk_assessment.recommended_action - Disposition CTA
#   exposure_control.approved_amount    - Exposure-adjusted amount`;

    // ── Credit Raw Score ────────────────────────────────────────
    const creditRawCurl = (modelId: string) => `curl -X POST "${baseUrl}/decisions/predict" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model_id": "${modelId}",
    "inputs": {
${formatJson(creditSampleInputs)}
    }
  }'`;

    const creditRawPowershell = (modelId: string) => {
        const psInputs = Object.entries(creditSampleInputs).map(([k, v]) =>
            `        ${k} = ${typeof v === "string" ? `"${v}"` : v}`
        ).join("\n");
        return `$body = @{
    model_id = "${modelId}"
    inputs = @{
${psInputs}
    }
} | ConvertTo-Json -Depth 3

Invoke-RestMethod \`
  -Uri "${baseUrl}/decisions/predict" \`
  -Method POST \`
  -ContentType "application/json" \`
  -Body $body`;
    };

    const creditRawPython = (modelId: string) => `import requests

response = requests.post(
    "${baseUrl}/decisions/predict",
    json={
        "model_id": "${modelId}",
        "inputs": {
${Object.entries(creditSampleInputs).map(([k, v]) =>
    `            "${k}": ${typeof v === "string" ? `"${v}"` : v}`
).join(",\n")}
        }
    }
)
print(response.json())
# Output: {"model_id": "...", "score": 0.123, "timestamp": "..."}`;

    // ── Fraud Raw Score ─────────────────────────────────────────
    const fraudRawCurl = (modelId: string) => `curl -X POST "${baseUrl}/decisions/predict" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model_id": "${modelId}",
    "inputs": {
${formatJson(fraudSampleInputs)}
    }
  }'`;

    const fraudRawPowershell = (modelId: string) => {
        const psInputs = Object.entries(fraudSampleInputs).map(([k, v]) =>
            `        ${k} = ${typeof v === "string" ? `"${v}"` : v}`
        ).join("\n");
        return `$body = @{
    model_id = "${modelId}"
    inputs = @{
${psInputs}
    }
} | ConvertTo-Json -Depth 3

Invoke-RestMethod \`
  -Uri "${baseUrl}/decisions/predict" \`
  -Method POST \`
  -ContentType "application/json" \`
  -Body $body`;
    };

    const fraudRawPython = (modelId: string) => `import requests

response = requests.post(
    "${baseUrl}/decisions/predict",
    json={
        "model_id": "${modelId}",
        "inputs": {
${Object.entries(fraudSampleInputs).map(([k, v]) =>
    `            "${k}": ${typeof v === "string" ? `"${v}"` : v}`
).join(",\n")}
        }
    }
)
print(response.json())
# Output: {"model_id": "...", "score": 0.087, "timestamp": "..."}`;

    const getSnippet = (type: CommandType, endpoint: "full" | "credit" | "fraud") => {
        if (endpoint === "full") {
            return type === "curl" ? fullDecisionCurl()
                : type === "powershell" ? fullDecisionPowershell()
                : fullDecisionPython();
        }
        if (endpoint === "credit" && activeCreditModel) {
            return type === "curl" ? creditRawCurl(activeCreditModel.id)
                : type === "powershell" ? creditRawPowershell(activeCreditModel.id)
                : creditRawPython(activeCreditModel.id);
        }
        if (endpoint === "fraud" && activeFraudModel) {
            return type === "curl" ? fraudRawCurl(activeFraudModel.id)
                : type === "powershell" ? fraudRawPowershell(activeFraudModel.id)
                : fraudRawPython(activeFraudModel.id);
        }
        return "";
    };

    // ── Sandbox ─────────────────────────────────────────────────
    const sandboxMutation = useMutation({
        mutationFn: async () => {
            const parsed = JSON.parse(sandboxBody);
            if (sandboxEndpoint === "full") {
                const res = await api.post(`/decisions/${systemId}`, parsed);
                return res.data;
            } else {
                const res = await api.post("/decisions/predict", parsed);
                return res.data;
            }
        },
        onSuccess: (data) => {
            setSandboxResponse(JSON.stringify(data, null, 2));
        },
        onError: (err: any) => {
            const detail = err.response?.data?.detail || err.message || "Request failed";
            setSandboxResponse(JSON.stringify({ error: detail }, null, 2));
        }
    });

    // Pre-fill sandbox body when endpoint changes
    const getSandboxDefault = (endpoint: "full" | "credit" | "fraud"): string => {
        if (endpoint === "full") {
            return JSON.stringify({
                applicant_name: "John Doe",
                inputs: fullSampleInputs
            }, null, 2);
        }
        if (endpoint === "credit" && activeCreditModel) {
            return JSON.stringify({
                model_id: activeCreditModel.id,
                inputs: creditSampleInputs
            }, null, 2);
        }
        if (endpoint === "fraud" && activeFraudModel) {
            return JSON.stringify({
                model_id: activeFraudModel.id,
                inputs: fraudSampleInputs
            }, null, 2);
        }
        return "{}";
    };

    const handleSandboxEndpointChange = (ep: "full" | "credit" | "fraud") => {
        setSandboxEndpoint(ep);
        setSandboxBody(getSandboxDefault(ep));
        setSandboxResponse("");
    };

    // Initialize sandbox body on first render
    if (!sandboxBody && Object.keys(fullSampleInputs).length > 0) {
        setSandboxBody(getSandboxDefault("full"));
    }

    const CommandTabs = ({ active, onChange }: { active: CommandType, onChange: (t: CommandType) => void }) => (
        <div className="flex gap-1 border-b">
            {(["curl", "powershell", "python"] as CommandType[]).map(t => (
                <button key={t} onClick={() => onChange(t)}
                    className={cn(
                        "px-3 py-1.5 text-xs font-medium transition-colors border-b-2 -mb-[1px]",
                        active === t
                            ? "border-primary text-primary"
                            : "border-transparent text-muted-foreground hover:text-foreground"
                    )}>
                    {t === "curl" ? "cURL" : t === "powershell" ? "PowerShell" : "Python"}
                </button>
            ))}
        </div>
    );

    const CodeBlock = ({ code, copyKey }: { code: string, copyKey: string }) => (
        <div className="space-y-2">
            <div className="flex items-center justify-end">
                <button onClick={() => copyToClipboard(code, copyKey)}
                    className="text-xs flex items-center gap-1 hover:text-primary transition-colors">
                    {copied === copyKey ? <Check className="h-3 w-3 text-up" /> : <Copy className="h-3 w-3" />}
                    {copied === copyKey ? "Copied!" : "Copy"}
                </button>
            </div>
            <pre className="bg-slate-950 text-slate-50 p-4 rounded-lg text-xs font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed">
                {code}
            </pre>
        </div>
    );

    return (
        <div className="page">
            <div>
                <h1 className="page-title flex items-center gap-3">
                    <Globe className="h-6 w-6 text-info" />
                    Integration
                </h1>
                <p className="page-desc">
                    API endpoints for scoring, decisions, and fraud detection. Use these to integrate Sentinel into your application.
                </p>
            </div>

            {/* Status Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="kpi">
                    <div className="kpi-label">System ID</div>
                    <div className="text-xs font-mono text-foreground break-all">{systemId}</div>
                </div>
                <div className="kpi">
                    <div className="kpi-label">Active Credit Model</div>
                    <div className="kpi-value text-sm">
                        {activeCreditModel ? (
                            <span className="flex items-center gap-2">
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-up opacity-75" />
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-up" />
                                </span>
                                {activeCreditModel.algorithm?.replace("_", " ")}
                            </span>
                        ) : (
                            <span className="text-muted-foreground">None</span>
                        )}
                    </div>
                    {activeCreditModel && (
                        <div className="text-[10px] font-mono text-muted-foreground mt-1">{activeCreditModel.id}</div>
                    )}
                </div>
                <div className="kpi">
                    <div className="kpi-label">Active Fraud Model</div>
                    <div className="kpi-value text-sm">
                        {activeFraudModel ? (
                            <span className="flex items-center gap-2">
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-up opacity-75" />
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-up" />
                                </span>
                                {activeFraudModel.algorithm?.replace("_", " ")}
                            </span>
                        ) : (
                            <span className="text-muted-foreground">None</span>
                        )}
                    </div>
                    {activeFraudModel && (
                        <div className="text-[10px] font-mono text-muted-foreground mt-1">{activeFraudModel.id}</div>
                    )}
                </div>
            </div>

            {/* Endpoint 1: Full Decision */}
            <div className="panel border-info/20 overflow-hidden">
                <div className="panel-head">
                    <div className="flex items-center gap-3">
                        <div className="icon-box bg-info/10">
                            <Zap className="h-4 w-4 text-info" />
                        </div>
                        <div>
                            <h3 className="panel-title">Full Decision Endpoint</h3>
                            <p className="text-2xs text-muted-foreground mt-0.5">
                                POST <span className="font-mono text-foreground">/decisions/{"{system_id}"}</span>
                            </p>
                        </div>
                    </div>
                    <span className="badge badge-green">Recommended</span>
                </div>
                <div className="p-5 space-y-4">
                    <p className="text-sm text-muted-foreground">
                        Returns the complete pipeline result: credit score, fraud score, approval decision (from policy),
                        approved loan amount (from exposure control), fraud risk tier, and reason codes.
                    </p>

                    {/* Response shape preview */}
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
                        {[
                            { label: "Credit Score", example: "0.018", color: "text-info" },
                            { label: "Decision", example: "APPROVE", color: "text-up" },
                            { label: "Approved Amt", example: "$4,900", color: "text-foreground" },
                            { label: "Adverse Action", example: "4 factors", color: "text-warn" },
                            { label: "Fraud Score", example: "0.087", color: "text-down" },
                            { label: "Fraud Tier", example: "LOW", color: "text-up" },
                            { label: "Fraud CTA", example: "PROCEED", color: "text-muted-foreground" },
                        ].map(f => (
                            <div key={f.label} className="bg-muted/20 rounded p-2.5 text-center">
                                <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">{f.label}</div>
                                <div className={cn("text-sm font-mono font-semibold mt-0.5", f.color)}>{f.example}</div>
                            </div>
                        ))}
                    </div>

                    {/* Feature list */}
                    {(creditFeatures.length > 0 || fraudFeatures.length > 0) && (
                        <div className="flex flex-wrap gap-1.5">
                            <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mr-1 self-center">Required Inputs:</span>
                            {[...new Set([...creditFeatures, ...fraudFeatures])].map(f => (
                                <span key={f} className="px-1.5 py-0.5 bg-muted/30 rounded text-[10px] font-mono text-muted-foreground">{f}</span>
                            ))}
                        </div>
                    )}

                    <CommandTabs active={commandType} onChange={setCommandType} />
                    <CodeBlock code={getSnippet(commandType, "full")} copyKey="full-decision" />

                    {!activeCreditModel && (
                        <div className="p-3 bg-warn/10 border border-warn/20 rounded-lg text-xs text-warn">
                            No active credit model. Activate a model first for decisions to work.
                        </div>
                    )}
                </div>
            </div>

            {/* Endpoint 2 + 3: Raw Score Endpoints */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Credit Raw Score */}
                <div className="panel overflow-hidden">
                    <div className="panel-head">
                        <div className="flex items-center gap-3">
                            <div className="icon-box-sm bg-primary/10">
                                <CreditCard className="h-3.5 w-3.5 text-primary" />
                            </div>
                            <div>
                                <h3 className="panel-title">Credit Score (Raw)</h3>
                                <p className="text-2xs text-muted-foreground mt-0.5">
                                    POST <span className="font-mono text-foreground">/decisions/predict</span>
                                </p>
                            </div>
                        </div>
                    </div>
                    <div className="p-5 space-y-4">
                        <p className="text-xs text-muted-foreground">
                            Returns the raw probability score from the active credit model.
                            No policy or exposure rules applied.
                        </p>
                        {activeCreditModel ? (
                            <>
                                <div className="flex items-center gap-2 text-xs">
                                    <span className="relative flex h-2 w-2">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-up opacity-75" />
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-up" />
                                    </span>
                                    <span className="font-medium">{activeCreditModel.name}</span>
                                    <span className="text-muted-foreground">({activeCreditModel.algorithm?.replace("_", " ")})</span>
                                </div>
                                {creditFeatures.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                        {creditFeatures.map(f => (
                                            <span key={f} className="px-1.5 py-0.5 bg-muted/30 rounded text-[10px] font-mono text-muted-foreground">{f}</span>
                                        ))}
                                    </div>
                                )}
                                <CommandTabs active={commandType} onChange={setCommandType} />
                                <CodeBlock code={getSnippet(commandType, "credit")} copyKey="credit-raw" />
                                <div className="flex items-start gap-2 p-2.5 rounded bg-warn/5 border border-warn/15">
                                    <Terminal className="h-3.5 w-3.5 text-warn shrink-0 mt-0.5" />
                                    <p className="text-[11px] text-muted-foreground">
                                        <span className="font-semibold text-warn">Testing only.</span> This bypasses policy and exposure control. Use the Full Decision endpoint for production.
                                    </p>
                                </div>
                            </>
                        ) : (
                            <div className="p-6 text-center text-muted-foreground text-xs">
                                No active credit model. Train and activate a model first.
                            </div>
                        )}
                    </div>
                </div>

                {/* Fraud Raw Score */}
                <div className="panel overflow-hidden">
                    <div className="panel-head">
                        <div className="flex items-center gap-3">
                            <div className="icon-box-sm bg-down/10">
                                <ShieldAlert className="h-3.5 w-3.5 text-down" />
                            </div>
                            <div>
                                <h3 className="panel-title">Fraud Score (Raw)</h3>
                                <p className="text-2xs text-muted-foreground mt-0.5">
                                    POST <span className="font-mono text-foreground">/decisions/predict</span>
                                </p>
                            </div>
                        </div>
                    </div>
                    <div className="p-5 space-y-4">
                        <p className="text-xs text-muted-foreground">
                            Returns the raw fraud probability from the active fraud model.
                            No tier routing or disposition applied.
                        </p>
                        {activeFraudModel ? (
                            <>
                                <div className="flex items-center gap-2 text-xs">
                                    <span className="relative flex h-2 w-2">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-up opacity-75" />
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-up" />
                                    </span>
                                    <span className="font-medium">{activeFraudModel.name}</span>
                                    <span className="text-muted-foreground">({activeFraudModel.algorithm?.replace("_", " ")})</span>
                                </div>
                                {fraudFeatures.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                        {fraudFeatures.map(f => (
                                            <span key={f} className="px-1.5 py-0.5 bg-muted/30 rounded text-[10px] font-mono text-muted-foreground">{f}</span>
                                        ))}
                                    </div>
                                )}
                                <CommandTabs active={commandType} onChange={setCommandType} />
                                <CodeBlock code={getSnippet(commandType, "fraud")} copyKey="fraud-raw" />
                                <div className="flex items-start gap-2 p-2.5 rounded bg-warn/5 border border-warn/15">
                                    <Terminal className="h-3.5 w-3.5 text-warn shrink-0 mt-0.5" />
                                    <p className="text-[11px] text-muted-foreground">
                                        <span className="font-semibold text-warn">Testing only.</span> This bypasses fraud tier routing. Use the Full Decision endpoint for production.
                                    </p>
                                </div>
                            </>
                        ) : (
                            <div className="p-6 text-center text-muted-foreground text-xs">
                                No active fraud model. Train and activate a fraud model first.
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Sandbox */}
            <div className="panel overflow-hidden border-primary/20">
                <div className="panel-head">
                    <div className="flex items-center gap-3">
                        <div className="icon-box bg-primary/10">
                            <Play className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                            <h3 className="panel-title">API Sandbox</h3>
                            <p className="text-2xs text-muted-foreground mt-0.5">
                                Send a live request and inspect the response
                            </p>
                        </div>
                    </div>
                </div>
                <div className="p-5 space-y-4">
                    {/* Endpoint selector */}
                    <div className="flex gap-2">
                        {([
                            { key: "full" as const, label: "Full Decision", icon: Zap },
                            { key: "credit" as const, label: "Credit Raw", icon: CreditCard },
                            { key: "fraud" as const, label: "Fraud Raw", icon: ShieldAlert },
                        ]).map(ep => (
                            <button key={ep.key}
                                onClick={() => handleSandboxEndpointChange(ep.key)}
                                className={cn(
                                    "flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors",
                                    sandboxEndpoint === ep.key
                                        ? "bg-primary text-primary-foreground"
                                        : "bg-muted/30 text-muted-foreground hover:text-foreground"
                                )}>
                                <ep.icon className="h-3 w-3" />
                                {ep.label}
                            </button>
                        ))}
                    </div>

                    <div className="text-[10px] font-mono text-muted-foreground">
                        {sandboxEndpoint === "full"
                            ? `POST ${baseUrl}/decisions/${systemId}`
                            : `POST ${baseUrl}/decisions/predict`}
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* Request */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold">Request Body</span>
                                <button
                                    onClick={() => {
                                        setSandboxBody(getSandboxDefault(sandboxEndpoint));
                                        setSandboxResponse("");
                                    }}
                                    className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                                    Reset
                                </button>
                            </div>
                            <textarea
                                value={sandboxBody}
                                onChange={e => setSandboxBody(e.target.value)}
                                className="w-full h-64 bg-slate-950 text-slate-50 p-4 rounded-lg text-xs font-mono resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                                spellCheck={false}
                            />
                            <button
                                onClick={() => sandboxMutation.mutate()}
                                disabled={sandboxMutation.isPending || !sandboxBody.trim()}
                                className="btn-primary btn-sm w-full flex items-center justify-center gap-2">
                                {sandboxMutation.isPending ? (
                                    <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending...</>
                                ) : (
                                    <><Play className="h-3.5 w-3.5" /> Send Request</>
                                )}
                            </button>
                        </div>

                        {/* Response */}
                        <div className="space-y-2">
                            <span className="text-xs font-semibold">Response</span>
                            <pre className={cn(
                                "w-full h-64 bg-slate-950 p-4 rounded-lg text-xs font-mono overflow-auto whitespace-pre-wrap",
                                sandboxResponse.includes('"error"') ? "text-red-400" : "text-emerald-400"
                            )}>
                                {sandboxResponse || "// Response will appear here after sending a request"}
                            </pre>
                            {sandboxResponse && (
                                <button
                                    onClick={() => copyToClipboard(sandboxResponse, "sandbox-response")}
                                    className="btn-ghost btn-xs flex items-center gap-1">
                                    {copied === "sandbox-response" ? <Check className="h-3 w-3 text-up" /> : <Copy className="h-3 w-3" />}
                                    {copied === "sandbox-response" ? "Copied!" : "Copy Response"}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Manual Test Widget */}
            <div className="panel overflow-hidden">
                <div className="panel-head">
                    <div className="flex items-center gap-3">
                        <div className="icon-box bg-warn/10">
                            <Calculator className="h-4 w-4 text-warn" />
                        </div>
                        <div>
                            <h3 className="panel-title">Quick Test</h3>
                            <p className="text-2xs text-muted-foreground mt-0.5">
                                Run a full decision with form inputs — results saved to the decision ledger
                            </p>
                        </div>
                    </div>
                </div>
                <div className="p-5">
                    <ManualTestForm
                        systemId={systemId!}
                        creditFeatures={creditFeatures}
                        fraudFeatures={fraudFeatures}
                        applicantName={manualForm.applicant_name}
                        onNameChange={(name) => setManualForm({ ...manualForm, applicant_name: name })}
                        onResult={(data) => {
                            setManualResponse(data);
                            queryClient.invalidateQueries({ queryKey: ["decisions"] });
                        }}
                    />

                    {manualResponse && (
                        <div className={cn(
                            "mt-4 panel p-4 animate-in fade-in slide-in-from-top-2",
                            manualResponse.credit_risk_assessment?.decision === "APPROVE" ? "border-up/30" : "border-down/30"
                        )}>
                            <div className="flex justify-between items-center mb-3">
                                <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">Result</span>
                                <div className="flex items-center gap-2">
                                    <span className={manualResponse.credit_risk_assessment?.decision === "APPROVE" ? "badge badge-green" : "badge badge-red"}>
                                        {manualResponse.credit_risk_assessment?.decision === "APPROVE" ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                                        {manualResponse.credit_risk_assessment?.decision}
                                    </span>
                                    <button onClick={() => setManualResponse(null)} className="p-1 hover:bg-accent rounded">
                                        <X className="h-3 w-3 text-muted-foreground" />
                                    </button>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 text-center">
                                <div className="kpi">
                                    <p className="kpi-label">Credit PD</p>
                                    <p className="kpi-value font-mono text-sm">{((manualResponse.credit_risk_assessment?.probability_of_default || 0) * 100).toFixed(2)}%</p>
                                </div>
                                <div className="kpi">
                                    <p className="kpi-label">Risk Decile</p>
                                    <p className="kpi-value font-mono text-sm">{manualResponse.exposure_control?.risk_decile ?? "—"}</p>
                                </div>
                                <div className="kpi">
                                    <p className="kpi-label">Approved</p>
                                    <p className="kpi-value font-mono text-sm text-up">{manualResponse.exposure_control?.approved_amount != null ? `$${manualResponse.exposure_control.approved_amount.toLocaleString()}` : "—"}</p>
                                </div>
                                <div className="kpi">
                                    <p className="kpi-label">Fraud Score</p>
                                    <p className="kpi-value font-mono text-sm">{manualResponse.fraud_risk_assessment?.fraud_probability != null ? `${(manualResponse.fraud_risk_assessment.fraud_probability * 100).toFixed(2)}%` : "—"}</p>
                                </div>
                                <div className="kpi">
                                    <p className="kpi-label">Fraud Tier</p>
                                    <p className="kpi-value text-sm">{manualResponse.fraud_risk_assessment?.risk_tier || "—"}</p>
                                </div>
                                <div className="kpi">
                                    <p className="kpi-label">Fraud CTA</p>
                                    <p className="kpi-value text-xs">{manualResponse.fraud_risk_assessment?.recommended_action || "—"}</p>
                                </div>
                            </div>
                            {manualResponse.adverse_action_notice?.factors?.length > 0 && (
                                <div className="mt-3 border-t pt-3">
                                    <p className="kpi-label mb-1.5">Adverse Action Factors</p>
                                    <div className="flex flex-wrap gap-2">
                                        {manualResponse.adverse_action_notice.factors.map((f: any, i: number) => (
                                            <span key={i} className="px-2 py-1 bg-muted/30 rounded text-xs font-mono">
                                                {f.factor?.replace(/_/g, " ")} <span className="text-down">+{(f.impact * 100).toFixed(1)}%</span>
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Base URL Reference */}
            <div className="panel p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                    <div>
                        <p className="text-xs font-semibold">Base URL</p>
                        <p className="text-xs font-mono text-muted-foreground">{baseUrl}</p>
                    </div>
                </div>
                <button onClick={() => copyToClipboard(baseUrl, "base-url")}
                    className="text-xs flex items-center gap-1 hover:text-primary transition-colors">
                    {copied === "base-url" ? <Check className="h-3 w-3 text-up" /> : <Copy className="h-3 w-3" />}
                    {copied === "base-url" ? "Copied!" : "Copy"}
                </button>
            </div>
        </div>
    );
}

// ── Manual Test Form Component ──────────────────────────────
function ManualTestForm({
    systemId, creditFeatures, fraudFeatures, applicantName, onNameChange, onResult
}: {
    systemId: string;
    creditFeatures: string[];
    fraudFeatures: string[];
    applicantName: string;
    onNameChange: (name: string) => void;
    onResult: (data: any) => void;
}) {
    const allFeatures = useMemo(() => [...new Set([...creditFeatures, ...fraudFeatures])], [creditFeatures, fraudFeatures]);

    // Build initial values
    const buildDefaults = () => {
        const vals: Record<string, string> = {};
        for (const f of allFeatures) {
            const fl = f.toLowerCase();
            if (fl.includes("fico") || fl.includes("score")) vals[f] = "720";
            else if (fl.includes("income") || fl.includes("annual")) vals[f] = "85000";
            else if (fl.includes("dti")) vals[f] = "0.35";
            else if (fl.includes("amount") || fl.includes("loan_amount")) vals[f] = "25000";
            else if (fl.includes("employment") || fl.includes("length")) vals[f] = "5";
            else if (fl.includes("grade")) vals[f] = "0";
            else if (fl.includes("utilization") || fl.includes("revolving")) vals[f] = "0.45";
            else if (fl.includes("inquiries") || fl.includes("inq")) vals[f] = "1";
            else if (fl.includes("derogatory") || fl.includes("derog")) vals[f] = "0";
            else vals[f] = "0";
        }
        return vals;
    };

    const [fieldValues, setFieldValues] = useState<Record<string, string>>(buildDefaults);

    const mutation = useMutation({
        mutationFn: async () => {
            const inputs: Record<string, number> = {};
            for (const [k, v] of Object.entries(fieldValues)) {
                inputs[k] = parseFloat(v) || 0;
            }
            const res = await api.post(`/decisions/${systemId}`, {
                applicant_name: applicantName,
                inputs,
            });
            return res.data;
        },
        onSuccess: (data) => onResult(data),
    });

    const formatLabel = (f: string) => f.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                <div className="col-span-2 md:col-span-1">
                    <label className="field-label">Applicant Name</label>
                    <input className="field-input" value={applicantName} onChange={e => onNameChange(e.target.value)} />
                </div>
                {allFeatures.map(f => (
                    <div key={f}>
                        <label className="field-label">{formatLabel(f)}</label>
                        <input
                            type="number"
                            step="any"
                            className="field-input font-mono"
                            value={fieldValues[f] || "0"}
                            onChange={e => setFieldValues({ ...fieldValues, [f]: e.target.value })}
                        />
                    </div>
                ))}
            </div>

            <button
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending}
                className="btn-primary btn-sm flex items-center gap-2"
            >
                {mutation.isPending ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Running...</>
                ) : (
                    <><Play className="h-3.5 w-3.5" /> Run Full Decision</>
                )}
            </button>

            {mutation.isError && (
                <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                    <p className="text-xs text-destructive">
                        {(mutation.error as any)?.response?.data?.detail || (mutation.error as Error)?.message || "Decision failed"}
                    </p>
                </div>
            )}
        </div>
    );
}
