"""
Sentinel Console — Demo Path QA Walker

Exercises the full demo flow against a deployed backend via the same HTTP
endpoints the frontend hits. Each step asserts on its expected post-condition
and writes a markdown report of failures.

Run:
    python walker.py                          # uses defaults from .env / env
    python walker.py --base-url https://...   # override
    python walker.py --skip-train             # skip the slow training step

Outputs:
    issues.md  — markdown report of every failure with detail
    walker.log — verbose latency-tagged log of every HTTP call

Designed to:
  - Be idempotent. Reuses existing systems / datasets / models when they exist.
  - Be fast. Skips training by default if a CANDIDATE model is already present.
  - Surface the exact failure mode of each step (status, latency, body).
  - Time every step so gateway-timeout risk shows up before demo day.
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

# Force UTF-8 on stdout when possible — Windows cp1252 can't encode the box-drawing
# characters we use for output. Falls back silently if reconfigure isn't available.
try:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    sys.stderr.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
except Exception:
    pass


HERE = Path(__file__).resolve().parent
ISSUES_PATH = HERE / "issues.md"
LOG_PATH = HERE / "walker.log"

# Latency budget per step (seconds). Anything close to Railway's ~30s gateway
# timeout is flagged P1 even on success — it's a demo-day timebomb.
LATENCY_WARN_SECONDS = 15.0
LATENCY_FAIL_SECONDS = 28.0


# ─── ANSI helpers ─────────────────────────────────────────────────────────────
RED, GREEN, YELLOW, CYAN, GREY, BOLD, RESET = (
    "\033[31m", "\033[32m", "\033[33m", "\033[36m", "\033[90m", "\033[1m", "\033[0m"
)
if os.name == "nt" and not os.environ.get("WT_SESSION"):
    # cmd.exe / older PowerShell — disable ANSI to avoid escape garbage
    RED = GREEN = YELLOW = CYAN = GREY = BOLD = RESET = ""


@dataclass
class Finding:
    severity: str          # P0 | P1 | P2 | INFO
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
    token: Optional[str] = None
    client_id: Optional[str] = None
    system_id: Optional[str] = None
    dataset_id: Optional[str] = None
    model_id: Optional[str] = None
    policy_id: Optional[str] = None
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


# ─── HTTP helpers ─────────────────────────────────────────────────────────────
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
    """
    Single HTTP call with timing and structured failure logging.
    Returns Response on success-class status, None on failure (after recording).
    """
    started = time.perf_counter()
    try:
        with _client(state, timeout=timeout) as c:
            res = c.request(
                method, path,
                json=json_body, data=data, files=files, params=params,
            )
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


# ─── Demo path steps ──────────────────────────────────────────────────────────
def step_health(state: State) -> bool:
    """Verify the API is reachable. Smoke test before anything else."""
    started = time.perf_counter()
    try:
        with httpx.Client(base_url=state.base_url, timeout=10.0) as c:
            res = c.get("/")
    except httpx.HTTPError as e:
        _record(state, Finding("P0", "health", f"API unreachable: {type(e).__name__}", str(e)))
        return False
    elapsed = time.perf_counter() - started
    if res.status_code >= 500:
        _record(state, Finding("P0", "health", f"API returned {res.status_code}", res.text[:200], elapsed))
        return False
    _ok(state, "health", f"API reachable at {state.base_url}", elapsed)
    return True


def step_login(state: State) -> bool:
    """OAuth2 password flow. Stores access_token + client_id."""
    started = time.perf_counter()
    try:
        with httpx.Client(base_url=state.base_url, timeout=15.0) as c:
            res = c.post(
                "/auth/login/access-token",
                data={"username": state.email, "password": state.password},
            )
    except httpx.HTTPError as e:
        _record(state, Finding("P0", "login", "request failed", str(e)))
        return False
    elapsed = time.perf_counter() - started
    if res.status_code != 200:
        _record(state, Finding("P0", "login", f"status {res.status_code}", res.text[:200], elapsed))
        return False
    body = res.json()
    state.token = body.get("access_token")
    state.client_id = body.get("client_id")
    if not state.token:
        _record(state, Finding("P0", "login", "no access_token in response", json.dumps(body)[:200], elapsed))
        return False
    _ok(state, "login", f"signed in as {state.email}", elapsed)
    return True


def step_pick_system(state: State) -> bool:
    """List existing systems and pick one (most recently created with active model)."""
    res = _call(state, "GET", "/systems/", step="systems.list")
    if res is None:
        return False
    systems = res.json()
    if not systems:
        _record(state, Finding(
            "P0", "systems.list",
            "no decision systems on this account — create one in the UI before running QA",
        ))
        return False
    # Prefer systems with an active model; fall back to first
    with_active = [s for s in systems if s.get("active_model_id")]
    chosen = with_active[0] if with_active else systems[0]
    state.system_id = chosen["id"]
    has_model = bool(chosen.get("active_model_id"))
    has_policy = bool(chosen.get("active_policy_id"))
    _ok(state, "systems.pick",
        f"{chosen['name']} (id={chosen['id'][:8]}, active_model={has_model}, active_policy={has_policy})")
    return True


def step_get_system(state: State) -> bool:
    """Fetch the system detail and check the response shape used by the frontend."""
    res = _call(state, "GET", f"/systems/{state.system_id}", step="system.get")
    if res is None:
        return False
    body = res.json()
    required = ["id", "name", "active_model_id", "active_policy_id"]
    missing = [k for k in required if k not in body]
    if missing:
        _record(state, Finding("P1", "system.get", f"response missing fields: {missing}"))
    else:
        _ok(state, "system.get", "all required fields present")
    if body.get("active_policy_id") and not body.get("active_policy_summary"):
        _record(state, Finding(
            "P1", "system.get",
            "active_policy_id set but active_policy_summary is null — frontend will show cutoff 0.000",
        ))
    return True


def step_pick_dataset(state: State) -> bool:
    res = _call(state, "GET", "/datasets/",
                params={"system_id": state.system_id}, step="datasets.list")
    if res is None:
        return False
    datasets = res.json()
    if not datasets:
        _record(state, Finding(
            "P0", "datasets.list",
            "no datasets on system — upload one before running QA",
        ))
        return False
    state.dataset_id = datasets[0]["id"]
    annotations = {
        "approved_amount_column": datasets[0].get("approved_amount_column"),
        "id_column": datasets[0].get("id_column"),
        "segmenting_dimensions": datasets[0].get("segmenting_dimensions") or [],
    }
    _ok(state, "datasets.pick",
        f"{datasets[0].get('original_filename', '?')} (annotations: {sum(bool(v) for v in annotations.values())}/3 set)")
    if not annotations["approved_amount_column"]:
        _record(state, Finding(
            "P2", "datasets.pick",
            "no approved_amount_column annotation — dollar metrics will fall back to count-only mode",
        ))
    if not annotations["segmenting_dimensions"]:
        _record(state, Finding(
            "P2", "datasets.pick",
            "no segmenting_dimensions annotation — Impact table per-segment breakouts disabled",
        ))
    return True


def step_models(state: State) -> bool:
    res = _call(state, "GET", "/models/",
                params={"system_id": state.system_id}, step="models.list")
    if res is None:
        return False
    models = res.json()
    candidates = [m for m in models if m.get("status") in ("CANDIDATE", "ACTIVE")]
    if not candidates:
        _record(state, Finding(
            "P0", "models.list",
            "no CANDIDATE or ACTIVE models on system — train one before running QA",
        ))
        return False
    # Prefer the active model; fall back to highest AUC candidate
    active = [m for m in candidates if m.get("status") == "ACTIVE"]
    if active:
        state.model_id = active[0]["id"]
        _ok(state, "models.list",
            f"{len(candidates)} candidates, ACTIVE = {active[0]['name']}")
    else:
        ranked = sorted(candidates,
                        key=lambda m: (m.get("metrics") or {}).get("auc", 0), reverse=True)
        state.model_id = ranked[0]["id"]
        _ok(state, "models.list",
            f"{len(candidates)} candidates, picking best AUC = {ranked[0]['name']}")

    # Check artifact path exists
    if not active or not active[0].get("artifact_path"):
        # not strictly fatal but worth flagging if active model has no artifact
        m = active[0] if active else ranked[0]
        if not m.get("artifact_path"):
            _record(state, Finding(
                "P1", "models.list",
                f"model {m['name']} has no artifact_path — scoring/calibration will fail",
            ))
    return True


def step_publish_policy(state: State, threshold: float = 0.5) -> bool:
    """Atomic create+activate via POST /policies/publish."""
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
        step="policy.publish",
    )
    if res is None:
        return False
    policy = res.json()
    state.policy_id = policy["id"]
    if abs(policy.get("threshold", 0) - threshold) > 1e-6:
        _record(state, Finding(
            "P0", "policy.publish",
            f"backend persisted threshold={policy.get('threshold')} but we sent {threshold}",
        ))
        return False

    # Verification — re-fetch system and assert active_policy_summary matches
    res2 = _call(state, "GET", f"/systems/{state.system_id}", step="policy.publish.verify")
    if res2 is None:
        return False
    summary = res2.json().get("active_policy_summary") or {}
    persisted = summary.get("threshold")
    if persisted is None:
        _record(state, Finding("P0", "policy.publish.verify", "active_policy_summary is null after publish"))
        return False
    if abs(persisted - threshold) > 1e-6:
        _record(state, Finding(
            "P0", "policy.publish.verify",
            f"system reports threshold={persisted} but publish sent {threshold}",
        ))
        return False
    _ok(state, "policy.publish.verify", f"verified threshold={threshold} round-trip")
    return True


def step_segments_list(state: State) -> bool:
    res = _call(state, "GET", f"/policies/{state.policy_id}/segments", step="segments.list")
    if res is None:
        return False
    segments = res.json()
    _ok(state, "segments.list", f"{len(segments)} segment(s) on active policy")
    if not segments:
        _record(state, Finding(
            "INFO", "segments.list",
            "no segments yet — Calibrate / Impact steps will be skipped",
        ))
    return True


def step_segments_calibrate(state: State) -> bool:
    """Calibrate is the slow path that's been a major source of demo-day bugs."""
    res = _call(state, "GET", f"/policies/{state.policy_id}/segments", step="segments.list.recheck")
    if res is None:
        return False
    if not res.json():
        return True  # no segments to calibrate — skip silently

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
        f"{populated}/{len(segments)} segments populated with n_samples")
    if populated == 0:
        _record(state, Finding(
            "P0", "segments.calibrate",
            "calibrate returned but no segments have n_samples — Phase 1 may have silently failed",
        ))
        return False
    return True


def step_segment_impact(state: State) -> bool:
    """3-stage impact comparison endpoint backing the Segmentation page panel."""
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
            _record(state, Finding(
                "P0", "segments.impact", f"response missing {stage} stage",
            ))
            return False
    baseline = body["baseline"]
    global_only = body["global_only"]
    segmented = body["segmented"]
    # Sanity assertions
    if baseline["approval_rate"] != 1.0:
        _record(state, Finding(
            "P1", "segments.impact",
            f"baseline approval_rate should be 1.0, got {baseline['approval_rate']}",
        ))
    if global_only["approval_rate"] > baseline["approval_rate"] + 1e-6:
        _record(state, Finding(
            "P0", "segments.impact",
            f"global_only approval ({global_only['approval_rate']:.2%}) > baseline ({baseline['approval_rate']:.2%})",
        ))
    if segmented["n_total"] != global_only["n_total"]:
        _record(state, Finding(
            "P0", "segments.impact",
            "stages computed on different population sizes — reconciliation broken",
        ))
    _ok(state, "segments.impact",
        f"baseline={baseline['approval_rate']:.1%} → global={global_only['approval_rate']:.1%} → segmented={segmented['approval_rate']:.1%}")
    return True


def step_simulate(state: State) -> bool:
    """The /simulate/portfolio endpoint backing ImpactTable + ExposureControl."""
    res = _call(
        state, "POST", "/simulate/portfolio",
        json_body={
            "dataset_id": state.dataset_id,
            "model_id": state.model_id,
            "cutoff": 0.5,
            "amount_ladder": None,
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
    _ok(state, "simulate.portfolio",
        f"baseline n={body.get('baseline', {}).get('total_applications')}")
    return True


def step_make_decision(state: State) -> bool:
    """Single decision through the production engine."""
    # We don't know the exact required feature shape — try with empty inputs
    # and observe if the backend returns a useful 422 with the expected fields.
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
        _ok(state, "decisions.make", "single decision succeeded with empty inputs")
    else:
        # 422 with a descriptive detail is acceptable — means the engine is
        # alive and validating. A 500 here would be a P0.
        body = res.json()
        detail = body.get("detail", str(body))[:200] if isinstance(body, dict) else str(body)[:200]
        _ok(state, "decisions.make", f"engine alive, validation rejected empty inputs ({detail!s:.80})")
    return True


def step_backtest_runs(state: State) -> bool:
    """List existing backtest runs (cheap — doesn't trigger a new run)."""
    res = _call(state, "GET", "/backtest",
                params={"decision_system_id": state.system_id},
                expected=(200,), step="backtest.list")
    if res is None:
        return False
    runs = res.json()
    _ok(state, "backtest.list", f"{len(runs)} historical run(s)")
    return True


# ─── Orchestrator ─────────────────────────────────────────────────────────────
DEMO_STEPS: list[tuple[str, Callable[[State], bool], bool]] = [
    # (label, fn, halt_on_failure)
    ("health",                step_health,             True),
    ("login",                 step_login,              True),
    ("pick system",           step_pick_system,        True),
    ("get system detail",     step_get_system,         False),
    ("pick dataset",          step_pick_dataset,       True),
    ("list models",           step_models,             True),
    ("publish policy",        step_publish_policy,     False),
    ("list segments",         step_segments_list,      False),
    ("calibrate segments",    step_segments_calibrate, False),
    ("segmentation impact",   step_segment_impact,     False),
    ("simulate portfolio",    step_simulate,           False),
    ("make decision",         step_make_decision,      False),
    ("backtest runs list",    step_backtest_runs,      False),
]


def write_report(state: State) -> None:
    LOG_PATH.write_text("\n".join(state.log_lines), encoding="utf-8")

    by_severity: dict[str, list[Finding]] = {"P0": [], "P1": [], "P2": [], "INFO": []}
    for f in state.findings:
        by_severity.setdefault(f.severity, []).append(f)

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    lines = [
        f"# Sentinel QA — Demo Path Walker Report",
        "",
        f"- **Run at:** `{now}`",
        f"- **Base URL:** `{state.base_url}`",
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

    if all(not v for v in by_severity.values()):
        lines.extend(["## All clear", "", "No findings on this run."])

    ISSUES_PATH.write_text("\n".join(lines), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Sentinel demo-path QA walker")
    p.add_argument("--base-url", default=os.environ.get("SENTINEL_API_URL",
                                                       "http://localhost:8000/api/v1"))
    p.add_argument("--email", default=os.environ.get("SENTINEL_EMAIL", "mishuk77@gmail.com"))
    p.add_argument("--password", default=os.environ.get("SENTINEL_PASSWORD", ""))
    p.add_argument("--policy-threshold", type=float, default=0.5)
    return p.parse_args()


def main() -> int:
    args = parse_args()
    if not args.password:
        print(
            f"{RED}ERROR{RESET}: no password provided. Set SENTINEL_PASSWORD or pass --password.",
            file=sys.stderr,
        )
        return 2

    state = State(base_url=args.base_url.rstrip("/"),
                  email=args.email,
                  password=args.password)

    _emit(state, f"{BOLD}Sentinel QA — Demo Path Walker{RESET}")
    _emit(state, f"{GREY}base_url={state.base_url}  user={state.email}{RESET}")
    _emit(state, "")

    for label, fn, halt in DEMO_STEPS:
        _emit(state, f"{BOLD}-> {label}{RESET}")
        try:
            ok = fn(state)
        except Exception as e:
            _record(state, Finding(
                "P0", label, f"walker step crashed: {type(e).__name__}", str(e),
            ))
            ok = False
        if not ok and halt:
            _emit(state, f"  {RED}halting — required step failed{RESET}")
            break
        _emit(state, "")

    write_report(state)
    p0 = sum(1 for f in state.findings if f.severity == "P0")
    p1 = sum(1 for f in state.findings if f.severity == "P1")
    summary = f"{BOLD}Done.{RESET} P0={p0} P1={p1} — see {ISSUES_PATH.name}"
    _emit(state, "")
    _emit(state, summary)

    return 1 if p0 > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
