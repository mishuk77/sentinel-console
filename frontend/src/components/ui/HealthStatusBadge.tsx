/**
 * HealthStatusBadge — surfaces the result of the TASK-9/TASK-10 health
 * checks as a compact colored chip.
 *
 * Used in three places:
 *   1. Models list — shows the Layer 1 (training-time) health verdict
 *      per model
 *   2. ModelDetail page — same verdict, plus a click-through to the
 *      full HealthReportPanel
 *   3. SystemOverview / Command View — surfaces the Layer 3 runtime
 *      health status (healthy / warning / degraded) so a CRO can spot
 *      drift without opening the model detail page
 *
 * Status conventions (all rolled up to a single tone):
 *   healthy / PASS   → green, "Healthy"
 *   warning / WARN   → amber, "Warning"
 *   degraded / FAIL  → red,   "Degraded" (runtime) or "Failed" (training)
 *   null / undefined → gray,  "Unknown"
 */
import { CheckCircle, AlertTriangle, ShieldAlert, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type HealthBadgeStatus =
    | "healthy" | "PASS"
    | "warning" | "WARN"
    | "degraded" | "FAIL" | "failed"
    | null
    | undefined;

interface HealthStatusBadgeProps {
    status: HealthBadgeStatus;
    /** "Layer 1" / "Runtime" / similar context that distinguishes which
     *  layer's verdict this is. Optional — improves the title tooltip. */
    layerLabel?: string;
    /** Sizing — sm fits in tables, md fits in headers, lg is for hero
     *  panels on the System Overview page. */
    size?: "xs" | "sm" | "md";
    /** When true, just show the colored dot without the text label. */
    compact?: boolean;
    className?: string;
    onClick?: () => void;
}

export function HealthStatusBadge({
    status,
    layerLabel,
    size = "sm",
    compact = false,
    className,
    onClick,
}: HealthStatusBadgeProps) {
    const tone = _toneFor(status);
    const label = _labelFor(status);
    const Icon = _iconFor(status);

    const sizeClasses = {
        xs: "text-[10px] px-1.5 py-0.5 gap-1",
        sm: "text-xs px-2 py-0.5 gap-1.5",
        md: "text-sm px-3 py-1 gap-2",
    }[size];

    const iconSize = {
        xs: "h-2.5 w-2.5",
        sm: "h-3 w-3",
        md: "h-3.5 w-3.5",
    }[size];

    const toneClasses = {
        green: "bg-up/15 border-up/40 text-up",
        amber: "bg-warn/15 border-warn/40 text-warn",
        red: "bg-down/15 border-down/40 text-down",
        gray: "bg-muted text-muted-foreground border-border",
    }[tone];

    const titleText = layerLabel
        ? `${layerLabel}: ${label}`
        : label;

    if (compact) {
        // Just a colored dot — used in dense tables
        const dotTone = {
            green: "bg-up",
            amber: "bg-warn",
            red: "bg-down",
            gray: "bg-muted-foreground/40",
        }[tone];
        return (
            <span
                className={cn("inline-block rounded-full", iconSize, dotTone, className)}
                title={titleText}
            />
        );
    }

    return (
        <span
            className={cn(
                "inline-flex items-center rounded-full border font-medium",
                sizeClasses,
                toneClasses,
                onClick && "cursor-pointer hover:bg-opacity-25 transition-colors",
                className,
            )}
            title={titleText}
            onClick={onClick}
        >
            <Icon className={iconSize} />
            {label}
        </span>
    );
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function _toneFor(status: HealthBadgeStatus): "green" | "amber" | "red" | "gray" {
    if (status === "healthy" || status === "PASS") return "green";
    if (status === "warning" || status === "WARN") return "amber";
    if (status === "degraded" || status === "FAIL" || status === "failed") return "red";
    return "gray";
}

function _labelFor(status: HealthBadgeStatus): string {
    if (status === "healthy" || status === "PASS") return "Healthy";
    if (status === "warning" || status === "WARN") return "Warning";
    if (status === "degraded") return "Degraded";
    if (status === "FAIL" || status === "failed") return "Failed";
    return "Unknown";
}

function _iconFor(status: HealthBadgeStatus): typeof CheckCircle {
    if (status === "healthy" || status === "PASS") return CheckCircle;
    if (status === "warning" || status === "WARN") return AlertTriangle;
    if (status === "degraded" || status === "FAIL" || status === "failed") return ShieldAlert;
    return HelpCircle;
}
