# Cap native thread pools BEFORE any numpy/scipy/OpenBLAS import.
# The Celery worker does NOT go through main.py, so we must set these here.
import os

_env = os.getenv("ENV", "local")
if _env != "local":
    for _var in ("OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS",
                 "OMP_NUM_THREADS", "NUMEXPR_MAX_THREADS"):
        os.environ.setdefault(_var, "1")

from celery import Celery
from app.core.config import settings

celery_app = Celery(
    "sentinel",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    worker_max_tasks_per_child=1,
    task_track_started=True,
    task_time_limit=3600,
    task_soft_time_limit=3000,
)

# TASK-10 Layer 3: Celery beat schedule. Runs the inference health
# monitor every 5 minutes against the rolling window of recent
# predictions per active decision system.
from celery.schedules import crontab as _crontab  # noqa: E402

celery_app.conf.beat_schedule = {
    "inference-health-monitor": {
        "task": "sentinel.inference_health_monitor",
        "schedule": 300.0,  # every 5 minutes
    },
}

# Auto-discover tasks in app.tasks AND app.workers (TASK-10 Layer 3)
celery_app.autodiscover_tasks(["app", "app.workers"])
