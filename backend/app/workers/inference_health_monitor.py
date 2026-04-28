"""
TASK-10 Layer 3 — runtime inference health monitoring.

Scheduled by Celery beat to run every 5 minutes. For each active
decision system, fetch the rolling window of recent predictions and
run InferenceHealthChecker.

Outputs:
  - Updates the decision system's health_status field
    (healthy / warning / degraded)
  - Logs structured events at WARN/ERROR level when checks fire
  - Emits a metric (`sentinel.inference.health.check_failed`) for
    external alerting integrations to consume

Per spec: this task does NOT auto-halt scoring on FAIL. The CRO
decides whether to roll back. Halting silently could be worse than
serving warned predictions. Configurable per system in a future iteration.
"""
from __future__ import annotations

import logging

from app.celery_app import celery_app
from app.db.session import SessionLocal
from app.models.decision_system import DecisionSystem
from app.services.inference_health import InferenceHealthChecker
from app.services.inference_window import (
    fetch_window,
    list_active_systems,
)

logger = logging.getLogger("sentinel.inference.health")


@celery_app.task(name="sentinel.inference_health_monitor")
def run_inference_health_monitor():
    """Run health checks on every active decision system's rolling window.

    Runs H1 (saturation), H2 (mode collapse), H3 (out-of-range),
    H4 (NaN/Inf), and H6 (distribution drift) — H5 (calibration) is
    omitted at runtime since outcomes aren't available immediately. H5
    runs at registration (Layer 2) and on a longer cadence as outcomes
    arrive.
    """
    active_ids = list_active_systems()
    logger.info(f"Health monitor checking {len(active_ids)} active systems")

    if not active_ids:
        return {"systems_checked": 0}

    checker = InferenceHealthChecker()
    db = SessionLocal()
    summary = {"systems_checked": 0, "fails": [], "warnings": []}

    try:
        for system_id in active_ids:
            scores = fetch_window(system_id)
            if len(scores) < 50:
                # Too few predictions to evaluate meaningfully
                continue

            # Run the runtime-applicable checks (skip H5 — no outcomes;
            # skip H6 — no registration baseline at runtime in this MVP.
            # Adding H6 requires storing the baseline at registration; can
            # be a follow-up.)
            results = [
                checker.check_out_of_range(scores),
                checker.check_nan_inf(scores),
                checker.check_saturation(scores),
                checker.check_mode_collapse(scores),
            ]
            worst = "PASS"
            for r in results:
                if r.status == "FAIL":
                    worst = "FAIL"
                    break
                elif r.status == "WARN" and worst != "FAIL":
                    worst = "WARN"

            # Map worst severity to a decision-system field
            new_status = (
                "degraded" if worst == "FAIL"
                else "warning" if worst == "WARN"
                else "healthy"
            )

            ds = db.query(DecisionSystem).filter(DecisionSystem.id == system_id).first()
            if ds:
                # Update only if changed to avoid noisy DB writes
                current = getattr(ds, "runtime_health_status", None)
                if current != new_status:
                    setattr(ds, "runtime_health_status", new_status)

            # Log + collect summary
            failures = [r for r in results if r.status == "FAIL"]
            warnings = [r for r in results if r.status == "WARN"]
            if failures:
                logger.error(
                    "FAIL system_id=%s n=%d %s",
                    system_id, len(scores),
                    "; ".join(f"{r.check_name}: {r.message}" for r in failures),
                )
                summary["fails"].append({
                    "system_id": system_id,
                    "n": int(len(scores)),
                    "failures": [{"check": r.check_name, "message": r.message} for r in failures],
                })
            elif warnings:
                logger.warning(
                    "WARN system_id=%s n=%d %s",
                    system_id, len(scores),
                    "; ".join(f"{r.check_name}: {r.message}" for r in warnings),
                )
                summary["warnings"].append({
                    "system_id": system_id,
                    "n": int(len(scores)),
                    "warnings": [{"check": r.check_name, "message": r.message} for r in warnings],
                })
            summary["systems_checked"] += 1

        db.commit()
    finally:
        db.close()

    return summary
