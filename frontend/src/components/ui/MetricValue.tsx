/**
 * MetricValue — single source of truth for displaying numeric metrics.
 *
 * Spec reference: TASK-11A (Number formatting and display standards)
 *
 * Why this exists
 * ---------------
 * CFO-grade displays require uniform conventions across every page:
 *
 *   * Currency negatives use parentheses, not minus signs:
 *       ($1,243,000)  not  -$1,243,000
 *   * Compact currency uses M/K/B with one decimal: $190.6M
 *   * Full currency uses comma-separated thousands: $190,600,000
 *   * Percentages always render with one decimal: 5.9%
 *   * Differences in percentage points use the "pp" suffix to disambiguate
 *     additive deltas from relative deltas: -0.9 pp  (not -0.9%)
 *   * Counts always use comma thousands and never abbreviate: 45,231
 *   * Hovering a compact value reveals the full-precision number.
 *
 * If a number is rendered anywhere outside this component the audit will
 * find drift between pages. Use this component everywhere.
 *
 * Usage
 * -----
 *     <MetricValue type="currency" value={190634217} />        → $190.6M
 *     <MetricValue type="currency" value={190634217} format="full" /> → $190,634,217
 *     <MetricValue type="percent" value={0.0589} />            → 5.9%
 *     <MetricValue type="percent-points" value={-0.009} />     → -0.9 pp
 *     <MetricValue type="count" value={45231} />               → 45,231
 *     <MetricValue type="currency" value={-1243000} />         → ($1,243,000)
 *
 *     // Hover over any compact value reveals the full-precision number:
 *     <MetricValue type="currency" value={190634217} title="auto" />
 *         renders $190.6M with title="$190,634,217"
 *
 * Props
 * -----
 *   type        Required. One of: "currency", "percent", "percent-points",
 *               "count", "ratio".
 *   value       The number to display. null/undefined renders as the
 *               configured placeholder (default: "—").
 *   format      "compact" (default for currency >= $10k) or "full".
 *               For percent / percent-points / count this is ignored.
 *   decimals    Override the default decimal count for the chosen type.
 *   placeholder String to render when value is null/undefined. Default "—".
 *   className   Forwarded to the root <span>.
 *   title       If set to "auto" (default), the rendered tooltip shows the
 *               full-precision number when in compact format. Pass a string
 *               to override the tooltip with a custom message. Pass false to
 *               disable the tooltip entirely.
 */
import { cn } from "@/lib/utils";

export type MetricType = "currency" | "percent" | "percent-points" | "count" | "ratio";
export type MetricFormat = "compact" | "full";

interface MetricValueProps {
    type: MetricType;
    value: number | null | undefined;
    format?: MetricFormat;
    decimals?: number;
    placeholder?: string;
    className?: string;
    title?: string | "auto" | false;
}

// ────────────────────────────────────────────────────────────────────────
// Formatters
// ────────────────────────────────────────────────────────────────────────

/** Format a number as compact currency: $190.6M, $4,218, ($1.2K). */
function formatCurrencyCompact(value: number, decimals = 1): string {
    const isNeg = value < 0;
    const abs = Math.abs(value);
    let formatted: string;
    if (abs >= 1_000_000_000) {
        formatted = `$${(abs / 1_000_000_000).toFixed(decimals)}B`;
    } else if (abs >= 1_000_000) {
        formatted = `$${(abs / 1_000_000).toFixed(decimals)}M`;
    } else if (abs >= 10_000) {
        // Below $10k we render full because compact loses too much information
        formatted = `$${(abs / 1_000).toFixed(decimals)}K`;
    } else {
        formatted = `$${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    }
    return isNeg ? `(${formatted})` : formatted;
}

/** Format a number as full currency: $190,634,217 (or ($1,243,000) for negatives). */
function formatCurrencyFull(value: number): string {
    const isNeg = value < 0;
    const abs = Math.abs(value);
    const formatted = `$${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    return isNeg ? `(${formatted})` : formatted;
}

/** Format a fraction (0..1 or 0..100) as a percentage with one decimal. */
function formatPercent(value: number, decimals = 1): string {
    // Heuristic: values in [-1.5, 1.5] are treated as fractional (0.05 = 5%);
    // values outside that range are treated as already-multiplied (5.0 = 5%).
    // This handles both API conventions without surprise.
    const pct = Math.abs(value) <= 1.5 ? value * 100 : value;
    const isNeg = pct < 0;
    const formatted = `${Math.abs(pct).toFixed(decimals)}%`;
    return isNeg ? `-${formatted}` : formatted;
}

/** Format a percentage-point difference: "-0.9 pp" rather than "-0.9%". */
function formatPercentPoints(value: number, decimals = 1): string {
    const pp = Math.abs(value) <= 1.5 ? value * 100 : value;
    const sign = pp >= 0 ? "+" : "-";
    return `${sign}${Math.abs(pp).toFixed(decimals)} pp`;
}

/** Format a count: 45,231 — never abbreviated, parentheses for negative. */
function formatCount(value: number): string {
    const isNeg = value < 0;
    const abs = Math.abs(value);
    const formatted = abs.toLocaleString("en-US", { maximumFractionDigits: 0 });
    return isNeg ? `(${formatted})` : formatted;
}

/** Format a ratio (e.g., AUC = 0.847) with three decimals. */
function formatRatio(value: number, decimals = 3): string {
    return value.toFixed(decimals);
}

// ────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────

export function MetricValue({
    type,
    value,
    format,
    decimals,
    placeholder = "—",
    className,
    title = "auto",
}: MetricValueProps) {
    if (value === null || value === undefined || (typeof value === "number" && Number.isNaN(value))) {
        return <span className={className}>{placeholder}</span>;
    }

    const num = value;
    let displayed: string;
    let tooltip: string | undefined;

    switch (type) {
        case "currency": {
            // Default to compact when |value| >= 10,000; otherwise full
            const useCompact = format === "compact"
                || (format === undefined && Math.abs(num) >= 10_000);
            displayed = useCompact
                ? formatCurrencyCompact(num, decimals)
                : formatCurrencyFull(num);
            // When compact is shown, the tooltip carries the full-precision
            // value so finance users can spot-check without exporting.
            if (useCompact && title === "auto") {
                tooltip = formatCurrencyFull(num);
            }
            break;
        }
        case "percent":
            displayed = formatPercent(num, decimals ?? 1);
            break;
        case "percent-points":
            displayed = formatPercentPoints(num, decimals ?? 1);
            break;
        case "count":
            displayed = formatCount(num);
            // Tooltip is unnecessary for counts — they're never abbreviated
            break;
        case "ratio":
            displayed = formatRatio(num, decimals ?? 3);
            break;
        default:
            displayed = String(num);
    }

    // Allow callers to pass a literal title; "auto" defaults to the computed
    // tooltip; false disables the tooltip entirely.
    const finalTitle = title === false ? undefined
        : typeof title === "string" && title !== "auto" ? title
        : tooltip;

    return (
        <span
            className={cn("tabular-nums", className)}
            title={finalTitle}
        >
            {displayed}
        </span>
    );
}

/**
 * Helper: returns the same string MetricValue would render, for use in
 * exports (CSV/PDF) that aren't React components.
 */
export function formatMetric(
    type: MetricType,
    value: number | null | undefined,
    format?: MetricFormat,
    decimals?: number,
    placeholder = "—",
): string {
    if (value === null || value === undefined || (typeof value === "number" && Number.isNaN(value))) {
        return placeholder;
    }
    switch (type) {
        case "currency": {
            const useCompact = format === "compact"
                || (format === undefined && Math.abs(value) >= 10_000);
            return useCompact ? formatCurrencyCompact(value, decimals) : formatCurrencyFull(value);
        }
        case "percent":
            return formatPercent(value, decimals ?? 1);
        case "percent-points":
            return formatPercentPoints(value, decimals ?? 1);
        case "count":
            return formatCount(value);
        case "ratio":
            return formatRatio(value, decimals ?? 3);
        default:
            return String(value);
    }
}
