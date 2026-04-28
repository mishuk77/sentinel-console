/**
 * ComparisonTable — generic 3-stage comparison table with delta column.
 *
 * Spec reference: TASK-3 (exposure control), TASK-7 (projected simulation)
 *
 * Data flow:
 *   - Caller passes rows (one per metric) + columns (the stages)
 *   - Each row's `values` array maps to columns by index
 *   - Each row declares its `type` (currency / percent / count / pp) so
 *     <MetricValue /> formats it consistently
 *   - The `delta` column auto-computes from the FIRST and LAST stage's
 *     values when `showDelta` is true and the row is comparable
 *
 * Color coding (TASK-3 spec):
 *   - row.deltaPolarity = "favorable_when_lower" → green when delta < 0
 *   - row.deltaPolarity = "favorable_when_higher" → green when delta > 0
 *   - row.deltaPolarity = "neutral" → gray (intentional reductions like
 *     approval count after policy cuts — expected, not a problem)
 */
import { cn } from "@/lib/utils";
import { MetricValue } from "./MetricValue";
import type { MetricType } from "./MetricValue";

export type DeltaPolarity = "favorable_when_lower" | "favorable_when_higher" | "neutral";

export interface ComparisonRow {
    /** Display label for the metric, e.g. "Total Approved $". */
    label: string;
    /** Type — drives <MetricValue /> formatting. */
    type: MetricType;
    /** Values per column in order. null/undefined renders as "—". */
    values: Array<number | null | undefined>;
    /** Color polarity for the delta column. Defaults to "favorable_when_lower"
     *  for loss-related metrics and "neutral" for everything else. */
    deltaPolarity?: DeltaPolarity;
    /** When true, the delta column is suppressed for this row. Useful when
     *  the metric is identical across stages (e.g., total applications). */
    suppressDelta?: boolean;
    /** Indent — used to visually nest sub-metrics. */
    indent?: boolean;
    /** Optional helper text that appears below the label as small muted text. */
    description?: string;
}

export interface ComparisonColumn {
    /** Header label, e.g. "Baseline", "After Policy Cuts". */
    label: string;
    /** Optional sub-label rendered below the main header in muted text. */
    sublabel?: string;
    /** Highlight this column (e.g., the "final" / production-equivalent column). */
    highlighted?: boolean;
}

interface ComparisonTableProps {
    columns: ComparisonColumn[];
    rows: ComparisonRow[];
    /** When true, an extra Δ column appears at the right computing
     *  final - baseline for each row. */
    showDelta?: boolean;
    /** Override delta column header. */
    deltaLabel?: string;
    className?: string;
}

export function ComparisonTable({
    columns,
    rows,
    showDelta = true,
    deltaLabel = "Δ vs Baseline",
    className,
}: ComparisonTableProps) {
    return (
        <div className={cn("overflow-x-auto", className)}>
            <table className="dt w-full">
                <thead>
                    <tr>
                        <th className="text-left">Metric</th>
                        {columns.map((col, i) => (
                            <th
                                key={i}
                                className={cn(
                                    "text-right whitespace-nowrap",
                                    col.highlighted && "text-info"
                                )}
                            >
                                <div>{col.label}</div>
                                {col.sublabel && (
                                    <div className="text-[10px] font-normal text-muted-foreground mt-0.5">
                                        {col.sublabel}
                                    </div>
                                )}
                            </th>
                        ))}
                        {showDelta && (
                            <th className="text-right whitespace-nowrap">{deltaLabel}</th>
                        )}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, ri) => {
                        const baseline = row.values[0];
                        const final = row.values[row.values.length - 1];
                        const showRowDelta = showDelta && !row.suppressDelta;
                        const polarity = row.deltaPolarity ?? "neutral";

                        return (
                            <tr key={ri}>
                                <td className={cn("font-medium", row.indent && "pl-8")}>
                                    <div>{row.label}</div>
                                    {row.description && (
                                        <div className="text-[10px] font-normal text-muted-foreground">
                                            {row.description}
                                        </div>
                                    )}
                                </td>
                                {row.values.map((v, ci) => (
                                    <td
                                        key={ci}
                                        className={cn(
                                            "text-right",
                                            columns[ci]?.highlighted && "font-semibold"
                                        )}
                                    >
                                        <MetricValue type={row.type} value={v ?? null} />
                                    </td>
                                ))}
                                {showRowDelta && (
                                    <td className="text-right">
                                        <DeltaCell
                                            baseline={baseline}
                                            final={final}
                                            type={row.type}
                                            polarity={polarity}
                                        />
                                    </td>
                                )}
                                {showDelta && row.suppressDelta && (
                                    <td className="text-right text-muted-foreground">—</td>
                                )}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

// ────────────────────────────────────────────────────────────────────────
// DeltaCell — renders absolute + relative delta with color coding
// ────────────────────────────────────────────────────────────────────────

function DeltaCell({
    baseline,
    final,
    type,
    polarity,
}: {
    baseline: number | null | undefined;
    final: number | null | undefined;
    type: MetricType;
    polarity: DeltaPolarity;
}) {
    if (baseline === null || baseline === undefined || final === null || final === undefined) {
        return <span className="text-muted-foreground">—</span>;
    }

    const delta = final - baseline;

    // Determine color class from polarity
    let colorClass = "text-muted-foreground"; // neutral default
    if (polarity === "favorable_when_lower") {
        colorClass = delta < 0 ? "text-up" : delta > 0 ? "text-down" : "text-muted-foreground";
    } else if (polarity === "favorable_when_higher") {
        colorClass = delta > 0 ? "text-up" : delta < 0 ? "text-down" : "text-muted-foreground";
    }

    // Choose how to render the delta itself
    const isPercentRow = type === "percent";
    const deltaType: MetricType = isPercentRow ? "percent-points" : type;

    // For percentage-point deltas, we want to show "(-X pp)" form
    // For currency/count, we want "($XXk) (-X.X%)" form
    const showRelative = type === "currency" || type === "count";
    const relative = baseline !== 0 ? delta / baseline : null;

    return (
        <span className={cn("tabular-nums", colorClass)}>
            <MetricValue type={deltaType} value={delta} className="font-medium" />
            {showRelative && relative !== null && (
                <span className="text-muted-foreground ml-1">
                    (<MetricValue type="percent-points" value={relative} />)
                </span>
            )}
        </span>
    );
}
