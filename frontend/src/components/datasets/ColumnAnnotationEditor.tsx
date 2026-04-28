/**
 * ColumnAnnotationEditor — TASK-6 frontend.
 *
 * Lets the user tag dataset columns with their semantic role:
 *   - approved_amount_column: principal amount per row (drives Mode 2 dollar
 *     metrics and predicted loss math)
 *   - loss_amount_column: actual dollar lost on bad event (Mode 1, the
 *     most accurate option)
 *   - id_column: applicant identifier (used by TASK-11G "what changed" diff)
 *   - segmenting_dimensions: columns to use as breakout dimensions
 *     (TASK-11F segment breakouts toggle)
 *
 * Backend endpoint: PATCH /datasets/{id}/metadata
 *
 * Used as a modal dialog from the Datasets page.
 */
import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Check, AlertCircle, Tag, DollarSign, Hash, Layers } from "lucide-react";
import { api } from "@/lib/api";
import type { Dataset } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ColumnAnnotationEditorProps {
    dataset: Dataset;
    open: boolean;
    onClose: () => void;
}

export function ColumnAnnotationEditor({ dataset, open, onClose }: ColumnAnnotationEditorProps) {
    const queryClient = useQueryClient();
    const columns = dataset.metadata_info?.columns || [];

    const [approvedCol, setApprovedCol] = useState<string>(dataset.approved_amount_column || "");
    const [lossCol, setLossCol] = useState<string>(dataset.loss_amount_column || "");
    const [idCol, setIdCol] = useState<string>(dataset.id_column || "");
    const [segDims, setSegDims] = useState<string[]>(dataset.segmenting_dimensions || []);
    const [savedAt, setSavedAt] = useState<Date | null>(null);

    // Keep local state in sync if dataset prop changes (e.g. after save)
    useEffect(() => {
        setApprovedCol(dataset.approved_amount_column || "");
        setLossCol(dataset.loss_amount_column || "");
        setIdCol(dataset.id_column || "");
        setSegDims(dataset.segmenting_dimensions || []);
    }, [dataset]);

    const saveMutation = useMutation({
        mutationFn: async () => {
            const res = await api.patch(`/datasets/${dataset.id}/metadata`, {
                approved_amount_column: approvedCol,
                loss_amount_column: lossCol,
                id_column: idCol,
                segmenting_dimensions: segDims,
            });
            return res.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["datasets"] });
            setSavedAt(new Date());
        },
    });

    if (!open) return null;

    const error = (saveMutation.error as any)?.response?.data?.detail;

    const toggleSegDim = (col: string) => {
        setSegDims((prev) =>
            prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col],
        );
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="panel max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="panel-head sticky top-0 bg-card z-10">
                    <div>
                        <span className="panel-title">Edit dataset column annotations</span>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            {dataset.metadata_info?.original_filename}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground"
                        aria-label="Close"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="p-5 space-y-6 text-sm">
                    <p className="text-xs text-muted-foreground">
                        Tag columns by their semantic role. These tags drive how dollar
                        metrics are computed (TASK-6 Mode 1/2/3), enable applicant-level
                        traceability in backtests, and unlock segment breakouts on
                        comparison tables.
                    </p>

                    {/* Approved amount column */}
                    <Field
                        icon={<DollarSign className="h-4 w-4 text-info" />}
                        label="Approved amount column"
                        helper="Principal/loan amount per row. Required for Mode 2 dollar metrics. Predicted loss = approved_amount × probability."
                    >
                        <ColumnSelect
                            value={approvedCol}
                            onChange={setApprovedCol}
                            columns={columns}
                            placeholder="None — Mode 3 (count metrics only)"
                        />
                    </Field>

                    {/* Loss amount column */}
                    <Field
                        icon={<DollarSign className="h-4 w-4 text-down" />}
                        label="Loss amount column"
                        helper="Actual dollar amount lost when the bad event occurred. When set, takes precedence over the Mode 2 full-principal-at-risk assumption."
                    >
                        <ColumnSelect
                            value={lossCol}
                            onChange={setLossCol}
                            columns={columns}
                            placeholder="None — fall back to Mode 2 (or 3)"
                        />
                    </Field>

                    {/* ID column */}
                    <Field
                        icon={<Hash className="h-4 w-4 text-muted-foreground" />}
                        label="ID column"
                        helper="Applicant identifier. Surfaced in backtest drill-down and 'what changed' diffs. Falls back to row index when not set."
                    >
                        <ColumnSelect
                            value={idCol}
                            onChange={setIdCol}
                            columns={columns}
                            placeholder="None — use row index"
                        />
                    </Field>

                    {/* Segmenting dimensions */}
                    <Field
                        icon={<Layers className="h-4 w-4 text-info" />}
                        label="Segmenting dimensions"
                        helper="Columns available as breakout dimensions on every aggregate view (TASK-11F). Tag categorical columns like channel, product, or region."
                    >
                        <div className="flex flex-wrap gap-1.5">
                            {columns.length === 0 && (
                                <span className="text-xs text-muted-foreground italic">
                                    No columns detected on this dataset.
                                </span>
                            )}
                            {columns.map((col) => {
                                const active = segDims.includes(col);
                                return (
                                    <button
                                        key={col}
                                        onClick={() => toggleSegDim(col)}
                                        type="button"
                                        className={cn(
                                            "px-2.5 py-1 text-xs rounded-full border transition-colors flex items-center gap-1",
                                            active
                                                ? "bg-info/15 border-info/40 text-info"
                                                : "border-border text-muted-foreground hover:border-info/30",
                                        )}
                                    >
                                        <Tag className="h-2.5 w-2.5" />
                                        {col}
                                    </button>
                                );
                            })}
                        </div>
                    </Field>

                    {error && (
                        <div className="flex items-start gap-2 p-3 rounded bg-down/5 border border-down/30">
                            <AlertCircle className="h-4 w-4 text-down shrink-0 mt-0.5" />
                            <p className="text-xs text-down">{error}</p>
                        </div>
                    )}
                </div>

                <div className="panel-head sticky bottom-0 bg-card z-10 flex items-center justify-between border-t">
                    <p className="text-xs text-muted-foreground">
                        {savedAt
                            ? <>Saved {savedAt.toLocaleTimeString()}</>
                            : <>Mode {resolveMode(approvedCol, lossCol)} dollar metrics</>}
                    </p>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onClose}
                            className="btn-ghost btn-sm"
                        >
                            Close
                        </button>
                        <button
                            onClick={() => saveMutation.mutate()}
                            disabled={saveMutation.isPending}
                            className="btn-primary btn-sm flex items-center gap-1.5"
                        >
                            {saveMutation.isPending ? "Saving..." : (
                                <><Check className="h-3.5 w-3.5" /> Save annotations</>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function resolveMode(approved: string, loss: string): string {
    if (loss) return "1 — explicit loss column";
    if (approved) return "2 — full principal at risk";
    return "3 — count metrics only";
}

function Field({ icon, label, helper, children }: {
    icon: React.ReactNode;
    label: string;
    helper?: string;
    children: React.ReactNode;
}) {
    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2">
                {icon}
                <label className="text-sm font-semibold">{label}</label>
            </div>
            {helper && <p className="text-xs text-muted-foreground">{helper}</p>}
            {children}
        </div>
    );
}

function ColumnSelect({ value, onChange, columns, placeholder }: {
    value: string;
    onChange: (v: string) => void;
    columns: string[];
    placeholder: string;
}) {
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="field-input w-full"
        >
            <option value="">— {placeholder} —</option>
            {columns.map((col) => (
                <option key={col} value={col}>{col}</option>
            ))}
        </select>
    );
}
