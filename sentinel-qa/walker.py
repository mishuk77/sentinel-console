"""
Sentinel Console — Comprehensive Demo Path QA Walker

Exercises every endpoint on the platform via the same HTTP contract the
frontend uses, asserts on each step, and writes a markdown report grouped by
severity.

Run:
    python walker.py                                 # uses defaults from env
    python walker.py --base-url https://...          # override
    python walker.py --module policies               # only one module
    python walker.py --modules systems,datasets      # several
    python walker.py --include-mutations             # also exercise mutating
                                                     #   endpoints (publish,
                                                     #   calibrate, etc.)

Outputs:
    issues.md  — markdown report grouped by severity
    walker.log — verbose log with latency for every HTTP call

Latency budget per step: > 15s = P1 warn, > 28s = P0 (close to gateway limit).

Read-only steps run by default. Mutating steps (publish policy, calibrate,
make decision, save exposure ladder) are gated behind --include-mutations
because they alter durable state on the target environment. Destructive
mutations (delete policy, delete dataset, delete model, delete fraud rule)
are NEVER run by this walker — they're destructive enough that a regression
in them is best caught manually.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

try:
    import httpx
except ImportError:
    print("ERROR: httpx not installed. Run: pip install -r requirements.txt", file=sys.stderr)
    sys.exit(1)

# Force UTF-8 on stdout when possible — Windows cp1252 can't encode some
# characters we use for output. Falls back silently if reconfigure missing.
try:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    sys.stderr.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
except Exception:
    pass


HERE = Path(__file__).resolve().parent
ISSUES_PATH = HERE / "issues.md"
LOG_PATH = HERE / "walker.log"

LATENCY_WARN_SECONDS = 15.0
LATENCY_FAIL_SECONDS = 28.0


# ─── ANSI helpers ─────────────────────────────────────────────────────────────
RED, GREEN, YELLOW, CYAN, GREY, BOLD, RESET = (
    "\033[31m", "\033[32m", "\033[33m", "\033[36m", "\033[90m", "\033[1m", "\033[0m"
)
if os.name == "nt" and not os.environ.get("WT_SESSION"):
    RED = GREEN = YELLOW = CYAN = GREY = BOLD = RESET = ""


# ─── State + Findings ─────────────────────────────────────────────────────────
@dataclass
class Finding:
    severity: str                  # P0 | P1 | P2 | INFO
    step: str
    message: str
    detail: str = ""
    duration_s: Optional[float] = None
    status_code: Optional[int] = None


@dataclass
class State:
    base_url: str
    email: str
    password: str
    include_mutations: bool = False
    token: Optional[str] = None
    client_id: Optional[str] = None
    role: Optional[str] = None

    # Resolved entities
    system_id: Optional[str] = None
    system: Optional[dict] = None
    dataset_id: Optional[str] = None
    dataset: Optional[dict] = None
    model_id: Optional[str] = None
    model: Optional[dict] = None
    policy_id: Optional[str] = None
    policy: Optional[dict] = None
    segment_ids: list[str] = field(default_factory=list)
    fraud_model_id: Optional[str] = None
    fraud_rule_id: Optional[str] = None
    backtest_run_id: Optional[str] = None
    last_decision_id: Optional[str] = None

    findings: list[Finding] = field(default_factory=list)
    log_lines: list[str] = field(default_factory=list)


# ─── Logging ──────────────────────────────────────────────────────────────────
def _emit(state: State, line: str) -> None:
    state.log_lines.append(line)
    print(line)


def _record(state: State, finding: Finding) -> None:
    state.findings.append(finding)
    color = {"P0": RED, "P1": YELLOW, "P2": GREY, "INFO": CYAN}.get(finding.severity, "")
    badge = f"{color}{BOLD}[{finding.severity}]{RESET}"
    detail_suffix = f" — {finding.detail}" if finding.detail else ""
    duration = f" ({finding.duration_s:.2f}s)" if finding.duration_s is not None else ""
    _emit(state, f"  {badge} {finding.step}: {finding.message}{detail_suffix}{duration}")


def _ok(state: State, step: str, message: str, duration_s: Optional[float] = None) -> None:
    duration = f" {GREY}({duration_s:.2f}s){RESET}" if duration_s is not None else ""
    if duration_s is not None and duration_s > LATENCY_WARN_SECONDS:
        _record(state, Finding(
            "P1", step,
            f"slow response - {duration_s:.1f}s (warn @ {LATENCY_WARN_SECONDS}s, fail @ {LATENCY_FAIL_SECONDS}s)",
            duration_s=duration_s,
        ))
    else:
        _emit(state, f"  {GREEN}OK{RESET} {step}: {message}{duration}")


def _info(state: State, step: str, message: str) -> None:
    _record(state, Finding("INFO", step, message))


# ─── HTTP helper ──────────────────────────────────────────────────────────────
def _client(state: State, timeout: float = 60.0) -> httpx.Client:
    headers = {"Authorization": f"Bearer {state.token}"} if state.token else {}
    return httpx.Client(base_url=state.base_url, headers=headers, timeout=timeout)


def _call(
    state: State,
    method: str,
    path: str,
    *,
    json_body: Optional[dict] = None,
    data: Optional[dict] = None,
    files: Optional[dict] = None,
    params: Optional[dict] = None,
    timeout: float = 60.0,
    expected: tuple[int, ...] = (200, 201),
    step: str = "",
    fail_severity: str = "P0",
) -> Optional[httpx.Response]:
    started = time.perf_counter()
    try:
        with _client(state, timeout=timeout) as c:
            res = c.request(method, path,
                            json=json_body, data=data, files=files, params=params)
    except httpx.TimeoutException as e:
        elapsed = time.perf_counter() - started
        _record(state, Finding(
            fail_severity, step or f"{method} {path}",
            f"request timed out after {elapsed:.1f}s",
            detail=str(e), duration_s=elapsed,
        ))
        return None
    except httpx.HTTPError as e:
        elapsed = time.perf_counter() - started
        _record(state, Finding(
            fail_severity, step or f"{method} {path}",
            f"HTTP error: {type(e).__name__}",
            detail=str(e), duration_s=elapsed,
        ))
        return None

    elapsed = time.perf_counter() - started
    if res.status_code not in expected:
        try:
            body = res.json()
            detail = body.get("detail") if isinstance(body, dict) else json.dumps(body)[:300]
        except Exception:
            detail = res.text[:300]
        _record(state, Finding(
            fail_severity, step or f"{method} {path}",
            f"unexpected status {res.status_code}",
            detail=str(detail), duration_s=elapsed, status_code=res.status_code,
        ))
        return None

    if elapsed > LATENCY_FAIL_SECONDS:
        _record(state, Finding(
            "P0", step or f"{method} {path}",
            f"latency {elapsed:.1f}s exceeds gateway timeout window",
            duration_s=elapsed, status_code=res.status_code,
        ))
    return res


# ════════════════════════════════════════════════════════════════════════════
# Auth & Identity
# ════════════════════════════════════════════════════════════════════════════
def step_health(state: State) -> bool:
    started = time.perf_counter()
    try:
        with httpx.Client(base_url=state.base_url, timeout=10.0) as c:
            res = c.get("/")
    except httpx.HTTPError as e:
        _record(state, Finding("P0", "health", f"API unreachable: {type(e).__name__}", str(e)))
        return False
    elapsed = time.perf_counter() - started
    if res.status_code >= 500:
        _record(state, Finding("P0", "health", f"API returned {res.status_code}",
                               res.text[:200], elapsed))
        return False
    _ok(state, "health", f"API reachable at {state.base_url}", elapsed)
    return True


def step_login(state: State) -> bool:
    started = time.perf_counter()
    try:
        with httpx.Client(base_url=state.base_url, timeout=15.0) as c:
            res = c.post("/auth/login/access-token",
                         data={"username": state.email, "password": state.password})
    except httpx.HTTPError as e:
        _record(state, Finding("P0", "auth.login", "request failed", str(e)))
        return False
    elapsed = time.perf_counter() - started
    if res.status_code != 200:
        _record(state, Finding("P0", "auth.login", f"status {res.status_code}",
                               res.text[:200], elapsed))
        return False
    body = res.json()
    state.token = body.get("access_token")
    state.client_id = body.get("client_id")
    state.role = body.get("role")
    if not state.token:
        _record(state, Finding("P0", "auth.login", "no access_token in response",
                               json.dumps(body)[:200], elapsed))
        return False
    _ok(state, "auth.login", f"signed in as {state.email} (role={state.role})", elapsed)
    return True


# ════════════════════════════════════════════════════════════════════════════
# Systems
# ════════════════════════════════════════════════════════════════════════════
def step_systems_list(state: State) -> bool:
    res = _call(state, "GET", "/systems/", step="systems.list")
    if res is None:
        return False
    systems = res.json()
    if not systems:
        _record(state, Finding("P0", "systems.list",
                               "no decision systems on this account"))
        return False
    with_active = [s for s in systems if s.get("active_model_id")]
    chosen = with_active[0] if with_active else systems[0]
    state.system_id = chosen["id"]
    state.system = chosen
    _ok(state, "systems.list",
        f"{len(systems)} system(s); picked {chosen.get('name', '?')[:40]}")
    return True


def step_systems_get(state: State) -> bool:
    res = _call(state, "GET", f"/systems/{state.system_id}", step="systems.get")
    if res is None:
        return False
    body = res.json()
    state.system = body
    required = ["id", "name", "active_model_id", "active_policy_id"]
    missing = [k for k in required if k not in body]
    if missing:
        _record(state, Finding("P1", "systems.get", f"missing fields: {missing}"))
    if body.get("active_policy_id") and not body.get("active_policy_summary"):
        _record(state, Finding(
            "P1", "systems.get",
            "active_policy_id set but active_policy_summary is null - frontend will show cutoff 0.000",
        ))
    _ok(state, "systems.get",
        f"system_type={body.get('system_type')}, has_active_model={bool(body.get('active_model_id'))}")
    return True


# ════════════════════════════════════════════════════════════════════════════
# Datasets
# ════════════════════════════════════════════════════════════════════════════
def step_datasets_list(state: State) -> bool:
    res = _call(state, "GET", "/datasets/",
                params={"system_id": state.system_id}, step="datasets.list")
    if res is None:
        return False
    ds = res.json()
    if not ds:
        _record(state, Finding("P0", "datasets.list", "no datasets on this system"))
        return False
    state.dataset_id = ds[0]["id"]
    state.dataset = ds[0]
    n_ann = sum(bool(ds[0].get(k)) for k in
                ("approved_amount_column", "id_column", "segmenting_dimensions"))
    _ok(state, "datasets.list",
        f"{len(ds)} dataset(s); picked {ds[0].get('original_filename', '?')} ({n_ann}/3 annotations)")
    if not ds[0].get("approved_amount_column"):
        _record(state, Finding(
            "P2", "datasets.list",
            "no approved_amount_column - dollar metrics fall back to count-only",
        ))
    if not ds[0].get("segmenting_dimensions"):
        _record(state, Finding(
            "P2", "datasets.list",
            "no segmenting_dimensions - per-segment breakouts disabled",
        ))
    return True


def step_dataset_preview(state: State) -> bool:
    res = _call(state, "GET", f"/datasets/{state.dataset_id}/preview",
                step="datasets.preview")
    if res is None:
        return False
    body = res.json()
    rows = body.get("rows") or body.get("preview") or []
    cols = body.get("columns") or []
    if not rows:
        _record(state, Finding("P1", "datasets.preview", "preview returned 0 rows"))
    _ok(state, "datasets.preview", f"{len(rows)} row(s), {len(cols)} column(s)")
    return True


def step_dataset_profile(state: State) -> bool:
    res = _call(state, "GET", f"/datasets/{state.dataset_id}/profile",
                step="datasets.profile", expected=(200, 404))
    if res is None:
        return False
    if res.status_code == 404:
        _info(state, "datasets.profile", "no profile yet (404) - generate from UI")
        return True
    body = res.json()
    n_features = len(body.get("columns") or body.get("features") or [])
    _ok(state, "datasets.profile", f"profile has {n_features} feature stats")
    return True


def step_dataset_segment_columns(state: State) -> bool:
    res = _call(state, "GET", f"/datasets/{state.dataset_id}/segment-columns",
                step="datasets.segment_columns", expected=(200, 404))
    if res is None:
        return False
    if res.status_code == 404:
        _info(state, "datasets.segment_columns", "endpoint returned 404 - dataset may need annotation")
        return True
    body = res.json()
    cols = body if isinstance(body, list) else body.get("columns", [])
    _ok(state, "datasets.segment_columns", f"{len(cols)} candidate segment column(s)")
    return True


# ════════════════════════════════════════════════════════════════════════════
# Models
# ════════════════════════════════════════════════════════════════════════════
def step_models_list(state: State) -> bool:
    res = _call(state, "GET", "/models/",
                params={"system_id": state.system_id}, step="models.list")
    if res is None:
        return False
    models = res.json()
    candidates = [m for m in models
                  if m.get("status") in ("CANDIDATE", "ACTIVE")
                  and (m.get("metrics") or {}).get("model_context") != "fraud"]
    if not candidates:
        _record(state, Finding("P0", "models.list",
                               "no CANDIDATE/ACTIVE risk models"))
        return False
    active = [m for m in candidates if m.get("status") == "ACTIVE"]
    if active:
        chosen = active[0]
    else:
        chosen = max(candidates, key=lambda m: (m.get("metrics") or {}).get("auc", 0))
    state.model_id = chosen["id"]
    state.model = chosen
    _ok(state, "models.list",
        f"{len(candidates)} candidate(s); using {chosen.get('algorithm')} (AUC {(chosen.get('metrics') or {}).get('auc', 0):.3f})")
    if not chosen.get("artifact_path"):
        _record(state, Finding("P1", "models.list",
                               "chosen model has no artifact_path - scoring will fail"))
    return True


def step_model_get(state: State) -> bool:
    res = _call(state, "GET", f"/models/{state.model_id}", step="models.get")
    if res is None:
        return False
    body = res.json()
    metrics = body.get("metrics") or {}
    has_calibration = bool(metrics.get("calibration"))
    has_feature_stats = bool(metrics.get("feature_stats"))
    _ok(state, "models.get",
        f"calibration={has_calibration}, feature_stats={has_feature_stats}, "
        f"target={body.get('target_column')}")
    if not has_calibration:
        _record(state, Finding("P1", "models.get",
                               "no calibration on model - Policy slider will be empty"))
    return True


def step_model_risk_amount_matrix(state: State) -> bool:
    amt_col = (state.dataset or {}).get("approved_amount_column")
    if not amt_col:
        _info(state, "models.risk_amount_matrix",
              "skipped - dataset has no approved_amount_column")
        return True
    res = _call(state, "GET", f"/models/{state.model_id}/risk-amount-matrix",
                params={"amount_col": amt_col},
                step="models.risk_amount_matrix",
                expected=(200, 404))
    if res is None:
        return False
    if res.status_code == 404:
        _info(state, "models.risk_amount_matrix",
              "404 - model trained before scored-data persistence; retrain to enable")
        return True
    body = res.json()
    rows = body.get("rows", [])
    _ok(state, "models.risk_amount_matrix", f"{len(rows)} matrix cell(s)")
    return True


def step_model_documentation(state: State) -> bool:
    """Hit the docx endpoint with HEAD-equivalent (just check content-type)."""
    res = _call(state, "GET", f"/models/{state.model_id}/documentation",
                step="models.documentation",
                expected=(200, 404, 422),
                timeout=30.0)
    if res is None:
        return False
    if res.status_code == 200:
        ct = res.headers.get("content-type", "")
        if "wordprocessing" not in ct:
            _record(state, Finding("P2", "models.documentation",
                                   f"unexpected content-type: {ct}"))
        _ok(state, "models.documentation", f"docx generated ({len(res.content)} bytes)")
    else:
        _info(state, "models.documentation",
              f"endpoint returned {res.status_code} - may not be available for this model")
    return True


# ════════════════════════════════════════════════════════════════════════════
# Policies
# ════════════════════════════════════════════════════════════════════════════
def step_policies_list(state: State) -> bool:
    res = _call(state, "GET", "/policies/",
                params={"system_id": state.system_id}, step="policies.list")
    if res is None:
        return False
    policies = res.json()
    active = [p for p in policies if p.get("is_active")]
    if active:
        state.policy_id = active[0]["id"]
        state.policy = active[0]
    elif policies:
        state.policy_id = policies[0]["id"]
        state.policy = policies[0]
    _ok(state, "policies.list",
        f"{len(policies)} policies, {len(active)} active")
    if len(active) > 1:
        _record(state, Finding(
            "P0", "policies.list",
            f"more than one active policy ({len(active)}) - violates singleton-active invariant",
        ))
    return True


def step_policies_publish(state: State) -> bool:
    if not state.include_mutations:
        _info(state, "policies.publish",
              "skipped - mutating step (use --include-mutations to enable)")
        return True
    threshold = (state.policy or {}).get("threshold") or 0.5
    res = _call(
        state, "POST", "/policies/publish",
        json_body={
            "model_id": state.model_id,
            "decision_system_id": state.system_id,
            "threshold": threshold,
            "projected_approval_rate": 0.5,
            "projected_loss_rate": 0.1,
            "target_decile": 5,
        },
        timeout=45.0,
        step="policies.publish",
    )
    if res is None:
        return False
    new_policy = res.json()
    state.policy_id = new_policy["id"]
    state.policy = new_policy
    if abs(new_policy.get("threshold", 0) - threshold) > 1e-6:
        _record(state, Finding(
            "P0", "policies.publish",
            f"persisted threshold {new_policy.get('threshold')} != sent {threshold}",
        ))
        return False

    # Verify via system endpoint (catches active-pointer race conditions)
    res2 = _call(state, "GET", f"/systems/{state.system_id}",
                 step="policies.publish.verify")
    if res2 is None:
        return False
    summary = res2.json().get("active_policy_summary") or {}
    persisted = summary.get("threshold")
    if persisted is None:
        _record(state, Finding("P0", "policies.publish.verify",
                               "active_policy_summary null after publish"))
        return False
    if abs(persisted - threshold) > 1e-6:
        _record(state, Finding(
            "P0", "policies.publish.verify",
            f"system reports {persisted} but sent {threshold}",
        ))
        return False
    _ok(state, "policies.publish",
        f"verified threshold={threshold:.4f} round-trip; new policy_id={state.policy_id[:8]}")
    return True


def step_policies_recommend_amounts(state: State) -> bool:
    if not state.policy_id:
        _info(state, "policies.recommend_amounts", "skipped - no policy")
        return True
    threshold = (state.policy or {}).get("threshold") or 0.5
    res = _call(
        state, "POST", "/policies/recommend-amounts",
        json_body={
            "dataset_id": state.dataset_id,
            "model_id": state.model_id,
            "threshold": threshold,
        },
        timeout=30.0,
        step="policies.recommend_amounts",
        expected=(200, 400, 422),
    )
    if res is None:
        return False
    if res.status_code in (400, 422):
        _info(state, "policies.recommend_amounts",
              f"endpoint returned {res.status_code} - may need ladder columns annotated")
        return True
    body = res.json()
    ladder = body if isinstance(body, dict) else {}
    _ok(state, "policies.recommend_amounts",
        f"{len(ladder.get('amount_ladder') or {})} ladder rung(s)")
    return True


# ════════════════════════════════════════════════════════════════════════════
# Segments
# ════════════════════════════════════════════════════════════════════════════
def step_segments_list(state: State) -> bool:
    if not state.policy_id:
        return True
    res = _call(state, "GET", f"/policies/{state.policy_id}/segments",
                step="segments.list")
    if res is None:
        return False
    segments = res.json()
    state.segment_ids = [s["id"] for s in segments]
    populated = sum(1 for s in segments if s.get("n_samples") is not None)
    _ok(state, "segments.list",
        f"{len(segments)} segments, {populated} with sample counts")
    return True


def step_segments_calibrate(state: State) -> bool:
    if not state.include_mutations:
        _info(state, "segments.calibrate",
              "skipped - mutating step (use --include-mutations)")
        return True
    if not state.policy_id or not state.segment_ids:
        _info(state, "segments.calibrate", "skipped - no segments")
        return True
    res = _call(
        state, "POST", f"/policies/{state.policy_id}/segments/calibrate",
        json_body={},
        timeout=60.0,
        step="segments.calibrate",
    )
    if res is None:
        return False
    segments = res.json()
    populated = sum(1 for s in segments if s.get("n_samples") is not None)
    _ok(state, "segments.calibrate",
        f"{populated}/{len(segments)} segments populated")
    if populated == 0:
        _record(state, Finding(
            "P0", "segments.calibrate",
            "no segments populated - Phase 1 may have silently failed",
        ))
    return True


def step_segments_calibration_detail(state: State) -> bool:
    if not state.policy_id or not state.segment_ids:
        return True
    seg_id = state.segment_ids[0]
    res = _call(
        state, "GET", f"/policies/{state.policy_id}/segments/{seg_id}/calibration",
        step="segments.calibration",
        expected=(200, 400, 404),
    )
    if res is None:
        return False
    if res.status_code in (400, 404):
        _info(state, "segments.calibration",
              f"{res.status_code} - segment may need calibrate first")
        return True
    body = res.json()
    bins = body.get("calibration") or []
    _ok(state, "segments.calibration",
        f"segment {seg_id[:8]}: n={body.get('n_samples')} {len(bins)} bins")
    return True


def step_segments_impact(state: State) -> bool:
    if not state.policy_id:
        return True
    res = _call(
        state, "GET", f"/policies/{state.policy_id}/segments/impact",
        timeout=60.0,
        step="segments.impact",
    )
    if res is None:
        return False
    body = res.json()
    for stage in ("baseline", "global_only", "segmented"):
        if stage not in body:
            _record(state, Finding("P0", "segments.impact",
                                   f"missing {stage} stage"))
            return False
    baseline = body["baseline"]
    global_only = body["global_only"]
    segmented = body["segmented"]
    if baseline["approval_rate"] != 1.0:
        _record(state, Finding(
            "P1", "segments.impact",
            f"baseline approval should be 1.0, got {baseline['approval_rate']}",
        ))
    if segmented["n_total"] != global_only["n_total"]:
        _record(state, Finding(
            "P0", "segments.impact",
            "stages have different population sizes",
        ))
    _ok(state, "segments.impact",
        f"{baseline['approval_rate']:.1%} -> {global_only['approval_rate']:.1%} -> {segmented['approval_rate']:.1%}")
    return True


# ════════════════════════════════════════════════════════════════════════════
# Simulation
# ════════════════════════════════════════════════════════════════════════════
def step_simulate_portfolio(state: State) -> bool:
    threshold = (state.policy or {}).get("threshold") or 0.5
    res = _call(
        state, "POST", "/simulate/portfolio",
        json_body={
            "dataset_id": state.dataset_id,
            "model_id": state.model_id,
            "cutoff": threshold,
            "amount_ladder": (state.policy or {}).get("amount_ladder"),
        },
        timeout=60.0,
        step="simulate.portfolio",
    )
    if res is None:
        return False
    body = res.json()
    for k in ("baseline", "policy_cuts", "policy_cuts_ladder", "meta"):
        if k not in body:
            _record(state, Finding("P1", "simulate.portfolio", f"missing key {k}"))
    n = body.get("baseline", {}).get("total_applications")
    _ok(state, "simulate.portfolio", f"baseline n={n}, has_dollar={body.get('has_dollar_metrics')}")
    return True


def step_simulate_breakout(state: State) -> bool:
    seg_dims = (state.dataset or {}).get("segmenting_dimensions") or []
    if not seg_dims:
        _info(state, "simulate.breakout",
              "skipped - no segmenting_dimensions on dataset")
        return True
    threshold = (state.policy or {}).get("threshold") or 0.5
    res = _call(
        state, "POST", "/simulate/breakout",
        json_body={
            "dataset_id": state.dataset_id,
            "model_id": state.model_id,
            "cutoff": threshold,
            "amount_ladder": (state.policy or {}).get("amount_ladder"),
            "dimension": seg_dims[0],
        },
        timeout=60.0,
        step="simulate.breakout",
    )
    if res is None:
        return False
    body = res.json()
    segs = body.get("segments") or []
    _ok(state, "simulate.breakout",
        f"dimension={body.get('dimension')}, {len(segs)} segments")
    return True


def step_simulate_diff(state: State) -> bool:
    threshold_a = (state.policy or {}).get("threshold") or 0.5
    threshold_b = max(0.0, min(1.0, threshold_a + 0.05))  # slightly different
    res = _call(
        state, "POST", "/simulate/diff",
        json_body={
            "dataset_id": state.dataset_id,
            "model_id": state.model_id,
            "policy_a": {"cutoff": threshold_a, "amount_ladder": None},
            "policy_b": {"cutoff": threshold_b, "amount_ladder": None},
        },
        timeout=60.0,
        step="simulate.diff",
        expected=(200, 422),
    )
    if res is None:
        return False
    if res.status_code == 422:
        _info(state, "simulate.diff", "422 - may require specific input shape")
        return True
    body = res.json()
    _ok(state, "simulate.diff",
        f"diff_a-b approval delta = {body.get('approval_delta', '?')}")
    return True


# ════════════════════════════════════════════════════════════════════════════
# Decisions
# ════════════════════════════════════════════════════════════════════════════
def step_decisions_list(state: State) -> bool:
    res = _call(state, "GET", "/decisions/",
                params={"system_id": state.system_id, "limit": 5},
                step="decisions.list")
    if res is None:
        return False
    body = res.json()
    items = body if isinstance(body, list) else body.get("items", [])
    _ok(state, "decisions.list", f"{len(items)} recent decisions")
    if items:
        state.last_decision_id = items[0].get("id")
    return True


def step_decisions_stats(state: State) -> bool:
    res = _call(state, "GET", "/decisions/stats/overview",
                params={"system_id": state.system_id},
                step="decisions.stats",
                expected=(200, 404, 422))
    if res is None:
        return False
    if res.status_code != 200:
        _info(state, "decisions.stats",
              f"{res.status_code} - may be empty for new system")
        return True
    body = res.json()
    _ok(state, "decisions.stats",
        f"total={body.get('total_decisions', body.get('total', '?'))}")
    return True


def step_decisions_make(state: State) -> bool:
    if not state.include_mutations:
        _info(state, "decisions.make",
              "skipped - mutating step (use --include-mutations)")
        return True
    res = _call(
        state, "POST", f"/decisions/{state.system_id}",
        json_body={"applicant_name": "QA Walker", "inputs": {}},
        timeout=30.0,
        expected=(200, 201, 422),
        step="decisions.make",
    )
    if res is None:
        return False
    if res.status_code in (200, 201):
        body = res.json()
        state.last_decision_id = body.get("id") or body.get("decision_id")
        _ok(state, "decisions.make",
            f"decision created: {body.get('decision', body.get('action', '?'))}")
    else:
        body = res.json() if res.headers.get("content-type", "").startswith("application/json") else {}
        detail = body.get("detail", "")[:120] if isinstance(body, dict) else ""
        _ok(state, "decisions.make", f"engine alive, validation rejected ({detail})")
    return True


def step_decisions_get(state: State) -> bool:
    if not state.last_decision_id:
        _info(state, "decisions.get", "skipped - no recent decision id")
        return True
    res = _call(state, "GET", f"/decisions/{state.last_decision_id}",
                step="decisions.get",
                expected=(200, 404))
    if res is None:
        return False
    if res.status_code == 404:
        _info(state, "decisions.get", "decision not retrievable - persistence issue?")
        return True
    body = res.json()
    _ok(state, "decisions.get",
        f"decision {state.last_decision_id[:8]} action={body.get('action')}")
    return True


# ════════════════════════════════════════════════════════════════════════════
# Backtest
# ════════════════════════════════════════════════════════════════════════════
def step_backtest_list(state: State) -> bool:
    res = _call(state, "GET", "/backtest",
                params={"decision_system_id": state.system_id},
                step="backtest.list")
    if res is None:
        return False
    runs = res.json()
    if runs:
        state.backtest_run_id = runs[0].get("id")
    _ok(state, "backtest.list", f"{len(runs)} historical run(s)")
    return True


def step_backtest_get(state: State) -> bool:
    if not state.backtest_run_id:
        _info(state, "backtest.get", "skipped - no historical runs")
        return True
    res = _call(state, "GET", f"/backtest/{state.backtest_run_id}",
                step="backtest.get",
                expected=(200, 404))
    if res is None:
        return False
    if res.status_code == 404:
        _record(state, Finding("P1", "backtest.get",
                               f"run {state.backtest_run_id[:8]} not retrievable"))
        return False
    body = res.json()
    _ok(state, "backtest.get",
        f"run {state.backtest_run_id[:8]} status={body.get('status')}, n={body.get('n_decisions')}")
    return True


def step_backtest_rows(state: State) -> bool:
    if not state.backtest_run_id:
        return True
    res = _call(state, "GET", f"/backtest/{state.backtest_run_id}/rows",
                params={"limit": 5},
                step="backtest.rows",
                expected=(200, 404, 422))
    if res is None:
        return False
    if res.status_code != 200:
        _info(state, "backtest.rows", f"{res.status_code} - may not be available")
        return True
    body = res.json()
    items = body if isinstance(body, list) else body.get("rows", [])
    _ok(state, "backtest.rows", f"{len(items)} row(s) returned")
    return True


# ════════════════════════════════════════════════════════════════════════════
# Dashboard
# ════════════════════════════════════════════════════════════════════════════
def step_dashboard_stats(state: State) -> bool:
    res = _call(state, "GET", "/dashboard/stats",
                step="dashboard.stats",
                expected=(200, 404))
    if res is None:
        return False
    if res.status_code != 200:
        _info(state, "dashboard.stats", f"{res.status_code}")
        return True
    body = res.json()
    _ok(state, "dashboard.stats",
        f"keys={list(body.keys())[:6]}")
    return True


def step_dashboard_volume(state: State) -> bool:
    res = _call(state, "GET", "/dashboard/volume",
                step="dashboard.volume",
                expected=(200, 404))
    if res is None:
        return False
    if res.status_code != 200:
        _info(state, "dashboard.volume", f"{res.status_code}")
        return True
    body = res.json()
    points = body if isinstance(body, list) else body.get("points", body.get("data", []))
    _ok(state, "dashboard.volume", f"{len(points)} data point(s)")
    return True


def step_dashboard_deployment_status(state: State) -> bool:
    res = _call(state, "GET", "/dashboard/deployment-status",
                step="dashboard.deployment_status",
                expected=(200, 404))
    if res is None:
        return False
    if res.status_code != 200:
        _info(state, "dashboard.deployment_status", f"{res.status_code}")
        return True
    body = res.json()
    items = body if isinstance(body, list) else body.get("systems", [])
    _ok(state, "dashboard.deployment_status", f"{len(items)} system(s)")
    return True


def step_dashboard_daily_breakdown(state: State) -> bool:
    res = _call(state, "GET", "/dashboard/daily-breakdown",
                step="dashboard.daily_breakdown",
                expected=(200, 404))
    if res is None:
        return False
    if res.status_code != 200:
        _info(state, "dashboard.daily_breakdown", f"{res.status_code}")
        return True
    _ok(state, "dashboard.daily_breakdown", "OK")
    return True


# ════════════════════════════════════════════════════════════════════════════
# Fraud — read-only sweeps. Mutating fraud endpoints (rules, cases, models)
# are gated behind --include-mutations and are still defensive (no deletes).
# ════════════════════════════════════════════════════════════════════════════
def step_fraud_settings(state: State) -> bool:
    res = _call(state, "GET", f"/systems/{state.system_id}/fraud/settings",
                step="fraud.settings",
                expected=(200, 404))
    if res is None:
        return False
    if res.status_code == 404:
        _info(state, "fraud.settings", "404 - fraud module not configured on this system")
        return True
    body = res.json()
    _ok(state, "fraud.settings",
        f"enabled={body.get('enabled', '?')}, threshold={body.get('decision_threshold', '?')}")
    return True


def step_fraud_models_list(state: State) -> bool:
    res = _call(state, "GET", f"/systems/{state.system_id}/fraud/models",
                step="fraud.models.list",
                expected=(200, 404))
    if res is None:
        return False
    if res.status_code == 404:
        _info(state, "fraud.models.list", "404 - fraud not enabled")
        return True
    models = res.json()
    if models:
        state.fraud_model_id = models[0].get("id")
    _ok(state, "fraud.models.list", f"{len(models)} fraud model(s)")
    return True


def step_fraud_models_features(state: State) -> bool:
    res = _call(state, "GET", f"/systems/{state.system_id}/fraud/models/features",
                step="fraud.models.features",
                expected=(200, 404))
    if res is None:
        return False
    if res.status_code == 404:
        _info(state, "fraud.models.features", "404 - fraud not enabled")
        return True
    feats = res.json()
    items = feats if isinstance(feats, list) else feats.get("features", [])
    _ok(state, "fraud.models.features", f"{len(items)} feature(s) available")
    return True


def step_fraud_rules_list(state: State) -> bool:
    res = _call(state, "GET", f"/systems/{state.system_id}/fraud/rules",
                step="fraud.rules.list",
                expected=(200, 404))
    if res is None:
        return False
    if res.status_code == 404:
        _info(state, "fraud.rules.list", "404")
        return True
    rules = res.json()
    if rules:
        state.fraud_rule_id = rules[0].get("id")
    active = sum(1 for r in rules if r.get("is_active"))
    _ok(state, "fraud.rules.list", f"{len(rules)} rules, {active} active")
    return True


def step_fraud_rules_fields(state: State) -> bool:
    res = _call(state, "GET", f"/systems/{state.system_id}/fraud/rules/fields",
                step="fraud.rules.fields",
                expected=(200, 404))
    if res is None:
        return False
    if res.status_code == 404:
        _info(state, "fraud.rules.fields", "404")
        return True
    body = res.json()
    items = body if isinstance(body, list) else body.get("fields", [])
    _ok(state, "fraud.rules.fields", f"{len(items)} field(s) available")
    return True


def step_fraud_cases_list(state: State) -> bool:
    res = _call(state, "GET", f"/systems/{state.system_id}/fraud/cases",
                params={"limit": 5},
                step="fraud.cases.list",
                expected=(200, 404))
    if res is None:
        return False
    if res.status_code == 404:
        _info(state, "fraud.cases.list", "404")
        return True
    body = res.json()
    items = body if isinstance(body, list) else body.get("items", [])
    _ok(state, "fraud.cases.list", f"{len(items)} case(s)")
    return True


def step_fraud_signals_providers(state: State) -> bool:
    res = _call(state, "GET", f"/systems/{state.system_id}/fraud/signals/providers",
                step="fraud.signals.providers",
                expected=(200, 404))
    if res is None:
        return False
    if res.status_code == 404:
        _info(state, "fraud.signals.providers", "404")
        return True
    providers = res.json()
    items = providers if isinstance(providers, list) else providers.get("providers", [])
    _ok(state, "fraud.signals.providers", f"{len(items)} provider(s)")
    return True


def step_fraud_analytics(state: State) -> bool:
    """Hit each analytics endpoint that backs the fraud dashboard."""
    sub_paths = [
        "analytics",
        "analytics/queue-depth",
        "analytics/trend",
        "analytics/signals",
        "analytics/analysts",
    ]
    failures = 0
    for sub in sub_paths:
        path = f"/systems/{state.system_id}/fraud/{sub}"
        res = _call(state, "GET", path,
                    step=f"fraud.{sub.replace('/', '.')}",
                    expected=(200, 404),
                    fail_severity="P1")
        if res is None:
            failures += 1
            continue
        if res.status_code == 404:
            _info(state, f"fraud.{sub.replace('/', '.')}", "404 - fraud not configured")
        else:
            _ok(state, f"fraud.{sub.replace('/', '.')}", "OK")
    return failures == 0


def step_fraud_tiers_global(state: State) -> bool:
    """Global fraud tier config (separate from /systems/{id}/fraud/...)."""
    res = _call(state, "GET", "/fraud/tiers",
                step="fraud.tiers",
                expected=(200, 404))
    if res is None:
        return False
    if res.status_code == 404:
        _info(state, "fraud.tiers", "404")
        return True
    body = res.json()
    items = body if isinstance(body, list) else body.get("tiers", [])
    _ok(state, "fraud.tiers", f"{len(items)} tier(s) configured")
    return True


# ════════════════════════════════════════════════════════════════════════════
# Composite lifecycle assertions — multi-step invariants
# ════════════════════════════════════════════════════════════════════════════
def step_lifecycle_segment_persistence(state: State) -> bool:
    """
    Verify the architectural invariant: segments belong to the decision system
    and persist across global-policy edits. Workflow:
      1. Capture current segments + active policy_id
      2. (If --include-mutations) Re-publish a policy with the same threshold
      3. Re-list segments under the new active policy_id
      4. Assert segment count is unchanged
    """
    if not state.include_mutations:
        _info(state, "lifecycle.segment_persistence",
              "skipped - mutating step (use --include-mutations)")
        return True
    if not state.policy_id:
        _info(state, "lifecycle.segment_persistence", "skipped - no policy")
        return True

    # Snapshot before
    res_before = _call(state, "GET", f"/policies/{state.policy_id}/segments",
                       step="lifecycle.snapshot.before")
    if res_before is None:
        return False
    n_before = len(res_before.json())

    # Trigger a fresh publish at the same threshold
    threshold = (state.policy or {}).get("threshold") or 0.5
    res_pub = _call(
        state, "POST", "/policies/publish",
        json_body={
            "model_id": state.model_id,
            "decision_system_id": state.system_id,
            "threshold": threshold,
            "projected_approval_rate": (state.policy or {}).get("projected_approval_rate") or 0.5,
            "projected_loss_rate": (state.policy or {}).get("projected_loss_rate") or 0.1,
            "target_decile": (state.policy or {}).get("target_decile") or 5,
        },
        timeout=45.0,
        step="lifecycle.republish",
    )
    if res_pub is None:
        return False
    new_policy_id = res_pub.json()["id"]

    # Snapshot after
    res_after = _call(state, "GET", f"/policies/{new_policy_id}/segments",
                      step="lifecycle.snapshot.after")
    if res_after is None:
        return False
    n_after = len(res_after.json())

    if n_after != n_before:
        _record(state, Finding(
            "P0", "lifecycle.segment_persistence",
            f"segments lost on publish: {n_before} before, {n_after} after",
        ))
        return False
    state.policy_id = new_policy_id
    state.policy = res_pub.json()
    _ok(state, "lifecycle.segment_persistence",
        f"verified {n_before} segment(s) survived republish")
    return True


# ════════════════════════════════════════════════════════════════════════════
# Module registry
# ════════════════════════════════════════════════════════════════════════════
# (label, fn, halt_on_failure, module_name)
ALL_STEPS: list[tuple[str, Callable[[State], bool], bool, str]] = [
    # Auth & Identity
    ("health",                    step_health,                    True,  "auth"),
    ("login",                     step_login,                     True,  "auth"),

    # Systems
    ("systems.list",              step_systems_list,              True,  "systems"),
    ("systems.get",                step_systems_get,               False, "systems"),

    # Datasets
    ("datasets.list",             step_datasets_list,             True,  "datasets"),
    ("datasets.preview",          step_dataset_preview,           False, "datasets"),
    ("datasets.profile",          step_dataset_profile,           False, "datasets"),
    ("datasets.segment_columns",  step_dataset_segment_columns,   False, "datasets"),

    # Models
    ("models.list",               step_models_list,               True,  "models"),
    ("models.get",                 step_model_get,                 False, "models"),
    ("models.risk_amount_matrix",  step_model_risk_amount_matrix,  False, "models"),
    ("models.documentation",       step_model_documentation,       False, "models"),

    # Policies
    ("policies.list",              step_policies_list,             False, "policies"),
    ("policies.publish",           step_policies_publish,          False, "policies"),
    ("policies.recommend_amounts", step_policies_recommend_amounts, False, "policies"),

    # Segments
    ("segments.list",              step_segments_list,             False, "segments"),
    ("segments.calibrate",         step_segments_calibrate,        False, "segments"),
    ("segments.calibration",       step_segments_calibration_detail, False, "segments"),
    ("segments.impact",            step_segments_impact,           False, "segments"),

    # Simulation
    ("simulate.portfolio",         step_simulate_portfolio,        False, "simulation"),
    ("simulate.breakout",          step_simulate_breakout,         False, "simulation"),
    ("simulate.diff",              step_simulate_diff,             False, "simulation"),

    # Decisions
    ("decisions.list",             step_decisions_list,            False, "decisions"),
    ("decisions.stats",            step_decisions_stats,           False, "decisions"),
    ("decisions.make",             step_decisions_make,            False, "decisions"),
    ("decisions.get",              step_decisions_get,             False, "decisions"),

    # Backtest
    ("backtest.list",              step_backtest_list,             False, "backtest"),
    ("backtest.get",               step_backtest_get,              False, "backtest"),
    ("backtest.rows",              step_backtest_rows,             False, "backtest"),

    # Dashboard
    ("dashboard.stats",            step_dashboard_stats,           False, "dashboard"),
    ("dashboard.volume",           step_dashboard_volume,          False, "dashboard"),
    ("dashboard.deployment",       step_dashboard_deployment_status, False, "dashboard"),
    ("dashboard.daily",            step_dashboard_daily_breakdown,  False, "dashboard"),

    # Fraud
    ("fraud.settings",             step_fraud_settings,            False, "fraud"),
    ("fraud.tiers",                step_fraud_tiers_global,        False, "fraud"),
    ("fraud.models.list",          step_fraud_models_list,         False, "fraud"),
    ("fraud.models.features",      step_fraud_models_features,     False, "fraud"),
    ("fraud.rules.list",           step_fraud_rules_list,          False, "fraud"),
    ("fraud.rules.fields",         step_fraud_rules_fields,        False, "fraud"),
    ("fraud.cases.list",           step_fraud_cases_list,          False, "fraud"),
    ("fraud.signals.providers",    step_fraud_signals_providers,   False, "fraud"),
    ("fraud.analytics",            step_fraud_analytics,           False, "fraud"),

    # Composite lifecycle invariants — must run AFTER segments + policies
    ("lifecycle.segment_persistence", step_lifecycle_segment_persistence, False, "lifecycle"),
]


# ─── Report ───────────────────────────────────────────────────────────────────
def write_report(state: State) -> None:
    LOG_PATH.write_text("\n".join(state.log_lines), encoding="utf-8")

    by_severity: dict[str, list[Finding]] = {"P0": [], "P1": [], "P2": [], "INFO": []}
    for f in state.findings:
        by_severity.setdefault(f.severity, []).append(f)

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    lines = [
        f"# Sentinel QA — Comprehensive Walker Report",
        "",
        f"- **Run at:** `{now}`",
        f"- **Base URL:** `{state.base_url}`",
        f"- **Mutations:** `{state.include_mutations}`",
        f"- **System:** `{state.system_id or '(none)'}`",
        f"- **Dataset:** `{state.dataset_id or '(none)'}`",
        f"- **Model:** `{state.model_id or '(none)'}`",
        f"- **Policy:** `{state.policy_id or '(none)'}`",
        "",
        "## Summary",
        "",
        f"- P0 (demo-blocking): **{len(by_severity['P0'])}**",
        f"- P1 (likely to surface): **{len(by_severity['P1'])}**",
        f"- P2 (edge case): **{len(by_severity['P2'])}**",
        f"- INFO: **{len(by_severity['INFO'])}**",
        "",
    ]

    for sev in ("P0", "P1", "P2", "INFO"):
        items = by_severity[sev]
        if not items:
            continue
        lines.append(f"## {sev}")
        lines.append("")
        for f in items:
            head = f"**{f.step}** — {f.message}"
            if f.duration_s is not None:
                head += f" _(t={f.duration_s:.2f}s"
                if f.status_code is not None:
                    head += f", status={f.status_code}"
                head += ")_"
            lines.append(f"- {head}")
            if f.detail:
                detail = f.detail.replace("\n", " ").strip()
                if len(detail) > 500:
                    detail = detail[:500] + "…"
                lines.append(f"  - `{detail}`")
        lines.append("")

    if not any(by_severity[k] for k in ("P0", "P1", "P2")):
        lines.extend(["## All clear", "", "No issues on this run."])

    ISSUES_PATH.write_text("\n".join(lines), encoding="utf-8")


# ─── CLI ──────────────────────────────────────────────────────────────────────
def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Sentinel comprehensive demo-path QA walker")
    p.add_argument("--base-url",
                   default=os.environ.get("SENTINEL_API_URL",
                                          "http://localhost:8000/api/v1"))
    p.add_argument("--email",
                   default=os.environ.get("SENTINEL_EMAIL", "mishuk77@gmail.com"))
    p.add_argument("--password",
                   default=os.environ.get("SENTINEL_PASSWORD", ""))
    p.add_argument("--module",
                   help="Run only one module (auth, systems, datasets, models, policies, "
                        "segments, simulation, decisions, backtest, dashboard, fraud, lifecycle)")
    p.add_argument("--modules",
                   help="Run a comma-separated list of modules")
    p.add_argument("--include-mutations", action="store_true",
                   help="Include mutating endpoints (publish, calibrate, make decision, etc.)")
    p.add_argument("--list-steps", action="store_true",
                   help="Print step inventory grouped by module and exit")
    return p.parse_args()


def main() -> int:
    args = parse_args()

    if args.list_steps:
        # Simple inventory printer — no auth required
        modules: dict[str, list[str]] = {}
        for label, _, _, mod in ALL_STEPS:
            modules.setdefault(mod, []).append(label)
        for mod in sorted(modules):
            print(f"{BOLD}{mod}{RESET}")
            for label in modules[mod]:
                print(f"  - {label}")
        return 0

    if not args.password:
        print(f"{RED}ERROR{RESET}: no password. "
              f"Set SENTINEL_PASSWORD or pass --password.", file=sys.stderr)
        return 2

    state = State(
        base_url=args.base_url.rstrip("/"),
        email=args.email,
        password=args.password,
        include_mutations=args.include_mutations,
    )

    selected_modules: Optional[set[str]] = None
    if args.module:
        selected_modules = {args.module}
    elif args.modules:
        selected_modules = {m.strip() for m in args.modules.split(",") if m.strip()}
    if selected_modules is not None:
        # auth is always required (login/health)
        selected_modules.update({"auth", "systems"})

    _emit(state, f"{BOLD}Sentinel QA — Comprehensive Walker{RESET}")
    _emit(state, f"{GREY}base_url={state.base_url}  user={state.email}  "
                 f"mutations={state.include_mutations}{RESET}")
    if selected_modules:
        _emit(state, f"{GREY}modules: {', '.join(sorted(selected_modules))}{RESET}")
    _emit(state, "")

    last_module: Optional[str] = None
    for label, fn, halt, module in ALL_STEPS:
        if selected_modules and module not in selected_modules:
            continue
        if module != last_module:
            _emit(state, f"{CYAN}{BOLD}== {module} =={RESET}")
            last_module = module
        _emit(state, f"  {GREY}-> {label}{RESET}")
        try:
            ok = fn(state)
        except Exception as e:
            _record(state, Finding(
                "P0", label,
                f"walker step crashed: {type(e).__name__}",
                str(e),
            ))
            ok = False
        if not ok and halt:
            _emit(state, f"  {RED}halting - required step failed{RESET}")
            break

    write_report(state)
    p0 = sum(1 for f in state.findings if f.severity == "P0")
    p1 = sum(1 for f in state.findings if f.severity == "P1")
    p2 = sum(1 for f in state.findings if f.severity == "P2")
    _emit(state, "")
    _emit(state, f"{BOLD}Done.{RESET} P0={p0} P1={p1} P2={p2} - see {ISSUES_PATH.name}")

    return 1 if p0 > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
