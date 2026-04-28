/**
 * AuditInfo — collapsible "where did these numbers come from?" panel.
 *
 * Spec reference: TASK-11C (audit trail and traceability)
 *
 * Required fields per spec:
 *   1. Dataset version: filename, content hash, row count
 *   2. Model version: name, algorithm, version_id (artifact path)
 *   3. Policy version: cutoff + ladder presence + snapshot timestamp
 *   4. Computation timestamp: when these numbers were computed
 *   5. Computed by: user email or system
 *
 * Renders in the top-right of every metric-bearing page. Collapsed by
 * default — click to expand and see all five fields.
 */
import { useState } from "react";
import { Info, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AuditMeta {
    dataset_id?: string;
    dataset_filename?: string | null;
    dataset_row_count?: number | null;
    dataset_content_hash?: string | null;

    model_id?: string;
    model_name?: string | null;
    model_algorithm?: string | null;
    model_artifact_path?: string | null;

    policy_cutoff?: number;
    policy_has_ladder?: boolean;
    policy_version_id?: string | null;
    policy_published_at?: string | null;

    loss_mode?: string;
    loss_mode_footnote?: string;
    target_column?: string | null;
    approved_amount_column?: string | null;

    computed_at?: string;
    computed_by?: string | null;

    engine_version?: string;
    elapsed_ms?: number;
}

interface AuditInfoProps {
    meta: AuditMeta | null | undefined;
    /** Show the panel collapsed (default) or expanded by default. */
    defaultOpen?: boolean;
    /** Inline (within page flow) vs absolute-positioned (top-right corner). */
    layout?: "inline" | "corner";
    className?: string;
}

export function AuditInfo({
    meta,
    defaultOpen = false,
    layout = "inline",
    className,
}: AuditInfoProps) {
    const [open, setOpen] = useState(defaultOpen);

    if (!meta) return null;

    return (
        <div
            className={cn(
                "panel border-info/20 bg-info/[0.02]",
                layout === "corner" && "absolute top-4 right-4 z-10",
                className,
            )}
        >
            <button
                onClick={() => setOpen((o) => !o)}
                className="w-full px-4 py-2.5 flex items-center justify-between gap-2 hover:bg-info/[0.04] transition-colors text-left"
            >
                <div className="flex items-center gap-2">
                    <Info className="h-3.5 w-3.5 text-info" />
                    <span className="text-xs font-semibold text-foreground">Audit info</span>
                    {meta.computed_at && (
                        <span className="text-[10px] text-muted-foreground font-mono">
                            · {formatTimestamp(meta.computed_at)}
                        </span>
                    )}
                </div>
                {open ? (
                    <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                )}
            </button>
            {open && (
                <div className="px-4 pb-4 pt-1 space-y-3 text-xs">
                    <Section title="Dataset">
                        <KV k="File">{meta.dataset_filename || "—"}</KV>
                        <KV k="Rows">
                            {meta.dataset_row_count?.toLocaleString() || "—"}
                        </KV>
                        <KV k="Hash" mono>
                            {meta.dataset_content_hash || "—"}
                        </KV>
                    </Section>
                    <Section title="Model">
                        <KV k="Name">{meta.model_name || "—"}</KV>
                        <KV k="Algorithm">{meta.model_algorithm || "—"}</KV>
                        <KV k="Artifact" mono>
                            {meta.model_artifact_path || "—"}
                        </KV>
                    </Section>
                    <Section title="Policy">
                        <KV k="Cutoff">
                            {meta.policy_cutoff !== undefined
                                ? meta.policy_cutoff.toFixed(3)
                                : "—"}
                        </KV>
                        <KV k="Ladder">{meta.policy_has_ladder ? "Yes" : "No"}</KV>
                        {meta.policy_version_id && (
                            <KV k="Version" mono>
                                {meta.policy_version_id}
                            </KV>
                        )}
                        {meta.policy_published_at && (
                            <KV k="Published">{formatTimestamp(meta.policy_published_at)}</KV>
                        )}
                    </Section>
                    <Section title="Loss handling">
                        <KV k="Mode">
                            {meta.loss_mode === "mode_1"
                                ? "Mode 1 — explicit loss column"
                                : meta.loss_mode === "mode_2"
                                ? "Mode 2 — full principal at risk"
                                : meta.loss_mode === "mode_3"
                                ? "Mode 3 — count metrics only"
                                : "—"}
                        </KV>
                        {meta.target_column && <KV k="Target">{meta.target_column}</KV>}
                        {meta.approved_amount_column && (
                            <KV k="Amount col">{meta.approved_amount_column}</KV>
                        )}
                        {meta.loss_mode_footnote && (
                            <p className="text-[10px] text-muted-foreground italic mt-1.5">
                                {meta.loss_mode_footnote}
                            </p>
                        )}
                    </Section>
                    <Section title="Computation">
                        {meta.computed_at && (
                            <KV k="At">{formatTimestamp(meta.computed_at)}</KV>
                        )}
                        {meta.computed_by && <KV k="By">{meta.computed_by}</KV>}
                        {meta.engine_version && (
                            <KV k="Engine">v{meta.engine_version}</KV>
                        )}
                        {meta.elapsed_ms !== undefined && (
                            <KV k="Elapsed">{meta.elapsed_ms} ms</KV>
                        )}
                    </Section>
                </div>
            )}
        </div>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div>
            <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1">
                {title}
            </p>
            <div className="space-y-1 pl-2">{children}</div>
        </div>
    );
}

function KV({
    k,
    children,
    mono,
}: {
    k: string;
    children: React.ReactNode;
    mono?: boolean;
}) {
    return (
        <div className="flex items-baseline gap-2">
            <span className="text-muted-foreground w-24 shrink-0">{k}</span>
            <span
                className={cn(
                    "text-foreground",
                    mono && "font-mono text-[10px] truncate"
                )}
            >
                {children}
            </span>
        </div>
    );
}

function formatTimestamp(iso: string): string {
    try {
        const d = new Date(iso);
        return d.toLocaleString(undefined, {
            year: "numeric",
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        });
    } catch {
        return iso;
    }
}
