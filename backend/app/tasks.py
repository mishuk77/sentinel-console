"""Celery tasks for long-running ML training jobs."""

import logging
from typing import List

from app.celery_app import celery_app
from app.db.session import SessionLocal
from app.models.dataset import Dataset
from app.models.ml_model import MLModel, ModelStatus
from app.services.training import training_service
from sqlalchemy.orm.attributes import flag_modified

logger = logging.getLogger("sentinel.training")


@celery_app.task(name="sentinel.train", bind=True, max_retries=0)
def celery_train_task(self, dataset_id: str, model_map: dict, target_col: str,
                      feature_cols: List[str], model_context: str = "credit",
                      job_id: str = None):
    """Run ML training pipeline in the Celery worker process.

    This is the same logic as train_task() in models.py, but runs in an
    isolated worker where n_jobs=-1 and multiprocessing are safe.
    """
    logger.info(f"[CELERY] Training started for dataset={dataset_id}, job={job_id}")
    db = SessionLocal()
    try:
        dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
        if not dataset:
            logger.error(f"[CELERY] Dataset {dataset_id} not found")
            return

        try:
            results = training_service.train_models(
                dataset.s3_key, target_col, feature_cols, model_context, job_id=job_id
            )
            logger.info(f"[CELERY] Training complete. {len(results)} results.")

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
                    # New model not in pre-created map (e.g. ensemble, lightgbm)
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
            logger.info("[CELERY] Models updated in DB.")

        except Exception as e:
            import traceback
            logger.error(f"[CELERY] Training failed: {e}")
            logger.error(traceback.format_exc())
            for mid in model_map.values():
                model = db.query(MLModel).filter(MLModel.id == mid).first()
                if model:
                    model.status = ModelStatus.FAILED
            db.commit()

    except Exception as e:
        import traceback
        logger.error(f"[CELERY] Outer exception: {e}")
        logger.error(traceback.format_exc())
    finally:
        db.close()
