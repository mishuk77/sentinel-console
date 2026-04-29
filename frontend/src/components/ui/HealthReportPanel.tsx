/**
 * HealthReportPanel — full HealthReport rendered as a per-check table.
 *
 * Spec reference: TASK-10 strategic framing — "Sentinel automatically
 * checks every model for saturation, calibration, distribution drift,
 * and pipeline integrity before it ever serves a decision."
 *
 * This is the panel that proves we did. Surfaces all six checks with
 * status, observed value, thresholds, and the explanatory message
 * the InferenceHealthChecker writes.
 *
 * Used on the Model Detail page below the model summary.
 */
import { CheckCircle, AlertTriangle, ShieldAlert } from "lucide-react";
import type { HealthReport, HealthCheckResult } from "@/lib/api";
import { cn } from "@/lib/utils";

const CHECK_NAMES: Record<string, string> = {
    out_of_range: "Out of range",
    nan_inf: "NaN / Inf",
    saturation: "Saturation",
    mode_collapse: "Mode collapse",
    calibration: "Calibration error",
    distribution_drift: "Distribution drift",
};

const CHECK_DESCRIPTIONS: Record<string, string> = {
    out_of_range: "Predictions must lie in [0, 1].",
    nan_inf: "Predictions must be finite.",
    saturation: "Catches the LR-bug class — % of predictions pegged at 0 or 1.",
    mode_collapse: "Std of predictions; near-zero means the model predicts the same value for everything.",
    calibration: "|mean(predicted) − mean(observed)|. Catches wildly miscalibrated models.",
    distribution_drift: "KS statistic vs. registration baseline. Catches feature pipeline regressions.",
};

interface HealthReportPanelProps {
    report?: HealthReport | null;
    /** Optional title — defaults to "Model Health Guardrails" */
    title?: string;
    className?: string;
}

export function HealthReportPanel({ report, title = "Model Health Guardrails", className }: HealthReportPanelProps) {
    if (!report) {
        return (
            <div className={cn("panel p-4 text-sm text-muted-foreground", className)}>
                <p className="font-semibold mb-1">{title}</p>
                <p className="text-xs">
                    No health report available. This model was registered
                    before the Layer 1 / Layer 2 health checks were enabled
                    — re-train to populate.
                </p>
            </div>
        );
    }

    // Sort by severity (FAIL → WARN → PASS) so problems are at the top
    // and a user scanning the panel sees what needs attention first.
    const sortedResults = [...report.results].sort((a, b) => {
        const severity = (s: string) => s === "FAIL" ? 0 : s === "WARN" ? 1 : 2;
        return severity(a.status) - severity(b.status);
    });
    const failures = report.results.filter((r) => r.status === "FAIL");

    return (
        <div className={cn("panel", className)}>
            <div className="panel-head">
                <span className="panel-title">{title}</span>
                <span className="text-2xs text-muted-foreground">
                    {report.results.length} checks · overall: <span className={cn(
                        "font-semibold uppercase",
                        report.status === "PASS" && "text-up",
                        report.status === "WARN" && "text-warn",
                        report.status === "FAIL" && "text-down",
                    )}>{report.status}</span>
                </span>
            </div>
            {failures.length > 0 && (
                <div className="px-4 py-3 bg-down/5 border-b border-down/20">
                    <p className="text-xs font-semibold text-down mb-1">
                        Why this model is flagged
                    </p>
                    <ul className="text-2xs text-muted-foreground space-y-0.5 list-disc list-inside">
                        {failures.map((r) => (
                            <li key={r.check_name}>
                                <span className="font-medium text-foreground">
                                    {CHECK_NAMES[r.check_name] || r.check_name}:
                                </span>{" "}
                                {r.message}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            <table className="dt">
                <thead>
                    <tr>
                        <th>Check</th>
                        <th className="text-right">Observed</th>
                        <th className="text-right">Warn / Fail thresholds</th>
                        <th>Status</th>
                        <th>Message</th>
                    </tr>
                </thead>
                <tbody>
                    {sortedResults.map((r) => (
                        <CheckRow key={r.check_name} result={r} />
                    ))}
                </tbody>
            </table>
            <div className="px-4 py-3 border-t bg-muted/10 text-2xs text-muted-foreground">
                <p>
                    <strong>How this works.</strong> The training-time check runs
                    immediately after model fit — a FAIL prevents the artifact
                    from being saved. The registration check runs at policy
                    publish; a FAIL blocks activation. The production monitor
                    runs every 5 minutes against the rolling window of recent
                    decisions and flags the system as degraded if drift exceeds
                    threshold.
                </p>
            </div>
        </div>
    );
}

function CheckRow({ result }: { result: HealthCheckResult }) {
    const tone =
        result.status === "PASS" ? "up" :
        result.status === "WARN" ? "warn" :
        "down";
    const Icon =
        result.status === "PASS" ? CheckCircle :
        result.status === "WARN" ? AlertTriangle :
        ShieldAlert;
    const niceName = CHECK_NAMES[result.check_name] || result.check_name;
    const description = CHECK_DESCRIPTIONS[result.check_name];

    return (
        <tr>
            <td className="font-medium">
                <div>{niceName}</div>
                {description && (
                    <div className="text-2xs text-muted-foreground font-normal">{description}</div>
                )}
            </td>
            <td className="text-right font-mono text-xs">
                {_fmtVal(result.observed_value)}
            </td>
            <td className="text-right font-mono text-2xs text-muted-foreground">
                {_fmtVal(result.threshold_warn)} / {_fmtVal(result.threshold_fail)}
            </td>
            <td>
                <span className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-semibold",
                    tone === "up" && "bg-up/15 text-up",
                    tone === "warn" && "bg-warn/15 text-warn",
                    tone === "down" && "bg-down/15 text-down",
                )}>
                    <Icon className="h-2.5 w-2.5" />
                    {result.status}
                </span>
            </td>
            <td className="text-xs text-muted-foreground">{result.message}</td>
        </tr>
    );
}

function _fmtVal(v: number | null | undefined): string {
    if (v === null || v === undefined) return "—";
    if (Math.abs(v) < 0.001 && v !== 0) return v.toExponential(2);
    if (Math.abs(v) >= 1) return v.toFixed(2);
    return v.toFixed(4);
}
