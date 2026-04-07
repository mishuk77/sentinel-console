"""Celery tasks for long-running ML training jobs."""

import logging
import os
import traceback
from typing import List

from app.celery_app import celery_app
from app.db.session import SessionLocal
from app.models.dataset import Dataset
from app.models.ml_model import MLModel, ModelStatus
from app.services.training import training_service
from app.services.storage import storage
from app.core.config import settings
from sqlalchemy.orm.attributes import flag_modified

logger = logging.getLogger("sentinel.training")


@celery_app.task(name="sentinel.train", bind=True, max_retries=0)
def celery_train_task(self, dataset_id: str, model_map: dict, target_col: str,
                      feature_cols: List[str], model_context: str = "credit",
                      job_id: str = None):
    """Run ML training pipeline in the Celery worker process."""
    emit = training_service.emit

    # ── Worker dispatch ──────────────────────────────────────
    training_service.clear_events(job_id)
    import platform
    emit(job_id, "worker_dispatch", "running",
         f"Task dispatched to Celery worker · PID {os.getpid()} · "
         f"Python {platform.python_version()} · {platform.machine()}")
    emit(job_id, "worker_env", "running",
         f"Storage: {storage.mode.upper()} · Redis: {'connected' if settings.REDIS_URL else 'N/A'} · "
         f"ENV: {os.getenv('ENV', 'local')}")

    logger.info(f"[CELERY] Training started for dataset={dataset_id}, job={job_id}")

    db = SessionLocal()
    try:
        # ── Load dataset record from DB ─────────────────────
        dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
        if not dataset:
            emit(job_id, "worker_error", "error",
                 f"Dataset {dataset_id} not found in database")
            logger.error(f"[CELERY] Dataset {dataset_id} not found")
            return

        emit(job_id, "worker_dataset", "done",
             f"Dataset found: s3_key={dataset.s3_key} · "
             f"filename={getattr(dataset, 'filename', 'N/A')} · "
             f"target={target_col} · features={len(feature_cols)} cols · "
             f"context={model_context}")

        try:
            # ── Run training pipeline ───────────────────────
            results = training_service.train_models(
                dataset.s3_key, target_col, feature_cols, model_context, job_id=job_id
            )
            logger.info(f"[CELERY] Training complete. {len(results)} results.")
            emit(job_id, "worker_db_update", "running",
                 f"Saving {len(results)} model results to database...")

            for res in results:
                algo_name = res["name"]
                if algo_name in model_map:
                    model_id = model_map[algo_name]
                    model = db.query(MLModel).filter(MLModel.id == model_id).first()
                    if model:
                        model.status = ModelStatus.CANDIDATE
                        model.metrics = res["metrics"]
                        flag_modified(model, "metrics")
                        model.artifact_path = res["artifact_path"]
                        model.name = f"{algo_name}_{model_id[:8]}"
                else:
                    new_model = MLModel(
                        dataset_id=dataset_id,
                        decision_system_id=dataset.decision_system_id,
                        algorithm=algo_name,
                        status=ModelStatus.CANDIDATE,
                        name=f"{algo_name}_{res['version_id'][:8]}",
                        metrics=res["metrics"],
                        artifact_path=res["artifact_path"],
                    )
                    db.add(new_model)

            db.commit()
            emit(job_id, "worker_db_update", "done",
                 f"All {len(results)} models saved · Status: CANDIDATE")
            logger.info("[CELERY] Models updated in DB.")

        except Exception as e:
            tb = traceback.format_exc()
            logger.error(f"[CELERY] Training failed: {e}")
            logger.error(tb)

            # Emit detailed error to frontend
            emit(job_id, "worker_error", "error",
                 f"Training failed: {type(e).__name__}: {e}")
            # Emit traceback lines (last 5 frames max for readability)
            tb_lines = tb.strip().split("\n")
            # Show the most useful part: last ~8 lines
            relevant_tb = "\n".join(tb_lines[-8:]) if len(tb_lines) > 8 else tb
            emit(job_id, "worker_traceback", "error",
                 f"Traceback:\n{relevant_tb}")

            for mid in model_map.values():
                model = db.query(MLModel).filter(MLModel.id == mid).first()
                if model:
                    model.status = ModelStatus.FAILED
            db.commit()
            emit(job_id, "worker_error", "error",
                 f"All {len(model_map)} models marked FAILED")

    except Exception as e:
        tb = traceback.format_exc()
        logger.error(f"[CELERY] Outer exception: {e}")
        logger.error(tb)
        emit(job_id, "worker_error", "error",
             f"Outer exception: {type(e).__name__}: {e}")
        tb_lines = tb.strip().split("\n")
        relevant_tb = "\n".join(tb_lines[-8:]) if len(tb_lines) > 8 else tb
        emit(job_id, "worker_traceback", "error",
             f"Traceback:\n{relevant_tb}")
    finally:
        db.close()
