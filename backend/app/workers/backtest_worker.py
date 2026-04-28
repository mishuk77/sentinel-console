"""
TASK-8 follow-up: async backtest execution.

Wraps the existing _execute_backtest() in a Celery task so the HTTP
endpoint returns immediately with run_id + status='running'. The
frontend polls GET /backtest/{run_id} for status updates.
"""
from __future__ import annotations

import logging
import traceback
from datetime import datetime

from app.celery_app import celery_app
from app.db.session import SessionLocal
from app.models.backtest import BacktestRun
from app.models.dataset import Dataset
from app.models.ml_model import MLModel
from app.models.policy import Policy

logger = logging.getLogger("sentinel.backtest")


@celery_app.task(name="sentinel.run_backtest", max_retries=0)
def run_backtest_task(run_id: str):
    """Execute a backtest in a worker. Updates run.status as it
    progresses: pending → running → completed | failed."""
    from app.api.routes.backtest import _execute_backtest

    db = SessionLocal()
    try:
        run = db.query(BacktestRun).filter(BacktestRun.id == run_id).first()
        if not run:
            logger.error(f"Backtest run {run_id} not found")
            return

        dataset = db.query(Dataset).filter(Dataset.id == run.dataset_id).first()
        model = db.query(MLModel).filter(MLModel.id == run.model_id).first()
        policy = db.query(Policy).filter(Policy.id == run.policy_id).first()

        if not dataset or not model or not policy:
            run.status = "failed"
            run.completed_at = datetime.utcnow()
            run.error_message = (
                "Backtest references a deleted dataset/model/policy. "
                "(TASK-11D should have prevented this — investigate.)"
            )
            db.commit()
            return

        run.status = "running"
        db.commit()

        try:
            _execute_backtest(db, run, dataset, model, policy)
            run.status = "completed"
            run.completed_at = datetime.utcnow()
            db.commit()
            logger.info(f"Backtest {run_id} completed in {run.avg_latency_ms}ms/row")
        except Exception as e:
            tb = traceback.format_exc()
            run.status = "failed"
            run.completed_at = datetime.utcnow()
            run.error_message = f"{type(e).__name__}: {e}\n{tb[:1000]}"
            db.commit()
            logger.error(f"Backtest {run_id} failed: {e}\n{tb}")
    finally:
        db.close()
