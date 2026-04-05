# Cap native thread pools BEFORE any numpy/scipy/OpenBLAS import.
# Without this, containers crash with "Resource temporarily unavailable".
import os as _os
_env = _os.getenv("ENV", "local")
if _env != "local":
    for _var in ("OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS",
                 "OMP_NUM_THREADS", "NUMEXPR_MAX_THREADS"):
        _os.environ.setdefault(_var, "4")
    _os.environ.setdefault("LOKY_START_METHOD", "spawn")
    _os.environ.setdefault("LOKY_MAX_CPU_COUNT", "8")

from app.api.router import api_router
from app.core.config import settings
import app.db.base  # Register models
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

app = FastAPI(title=settings.PROJECT_NAME, version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.API_V1_STR)

@app.on_event("startup")
def startup_event():
    # Auto-create tables if they don't exist
    from app.db.session import engine
    from app.db.base_class import Base
    # Import models to ensure they are registered
    import app.models.decision_system
    import app.models.dataset
    import app.models.ml_model
    import app.models.policy
    import app.models.policy_segment
    import app.models.decision
    import app.models.client
    import app.models.user
    import app.models.fraud
    
    print("Checking database schema...")
    from sqlalchemy import text, inspect
    
    # MANUAL MIGRATION CHECK: client_id in decision_systems
    inspector = inspect(engine)
    if "decision_systems" in inspector.get_table_names():
        columns = [c["name"] for c in inspector.get_columns("decision_systems")]
        if "client_id" not in columns:
            print("MIGRATION: Adding 'client_id' to decision_systems table...")
            with engine.connect() as conn:
                conn.execute(text("ALTER TABLE decision_systems ADD COLUMN client_id VARCHAR"))
                conn.commit()
            print("MIGRATION: 'client_id' column added.")

    # MANUAL MIGRATION CHECK: module_type in datasets
    if "datasets" in inspector.get_table_names():
        columns = [c["name"] for c in inspector.get_columns("datasets")]
        if "module_type" not in columns:
            print("MIGRATION: Adding 'module_type' to datasets table...")
            with engine.connect() as conn:
                conn.execute(text("ALTER TABLE datasets ADD COLUMN module_type VARCHAR"))
                conn.commit()
            print("MIGRATION: 'module_type' column added.")

    # MANUAL MIGRATION CHECK: decision_systems columns
    if "decision_systems" in inspector.get_table_names():
        columns = [c["name"] for c in inspector.get_columns("decision_systems")]
        ds_migrations = {
            "system_type": "VARCHAR DEFAULT 'full'",
            "active_model_id": "VARCHAR",
            "active_fraud_model_id": "VARCHAR",
            "active_policy_id": "VARCHAR",
        }
        for col_name, col_type in ds_migrations.items():
            if col_name not in columns:
                print(f"MIGRATION: Adding '{col_name}' to decision_systems table...")
                with engine.connect() as conn:
                    conn.execute(text(f"ALTER TABLE decision_systems ADD COLUMN {col_name} {col_type}"))
                    conn.commit()
                print(f"MIGRATION: '{col_name}' column added.")

    # MANUAL MIGRATION CHECK: policies columns
    if "policies" in inspector.get_table_names():
        columns = [c["name"] for c in inspector.get_columns("policies")]
        policy_migrations = {
            "model_id": "VARCHAR",
            "threshold": "FLOAT",
            "projected_approval_rate": "FLOAT",
            "projected_loss_rate": "FLOAT",
            "target_decile": "INTEGER",
            "amount_ladder": "JSON",
            "is_active": "BOOLEAN DEFAULT FALSE",
            "decision_system_id": "VARCHAR",
        }
        for col_name, col_type in policy_migrations.items():
            if col_name not in columns:
                print(f"MIGRATION: Adding '{col_name}' to policies table...")
                with engine.connect() as conn:
                    conn.execute(text(f"ALTER TABLE policies ADD COLUMN {col_name} {col_type}"))
                    conn.commit()
                print(f"MIGRATION: '{col_name}' column added.")

    # MANUAL MIGRATION CHECK: models columns
    if "models" in inspector.get_table_names():
        columns = [c["name"] for c in inspector.get_columns("models")]
        model_migrations = {
            "decision_system_id": "VARCHAR",
        }
        for col_name, col_type in model_migrations.items():
            if col_name not in columns:
                print(f"MIGRATION: Adding '{col_name}' to models table...")
                with engine.connect() as conn:
                    conn.execute(text(f"ALTER TABLE models ADD COLUMN {col_name} {col_type}"))
                    conn.commit()
                print(f"MIGRATION: '{col_name}' column added.")

    Base.metadata.create_all(bind=engine)
    print("Database schema initialized.")

    # Migration / Seeding
    from sqlalchemy.orm import Session
    db = Session(bind=engine)
    try:
        seed_data(db)
    except Exception as e:
        print(f"Migration failed: {e}")
    finally:
        db.close()

def seed_data(db: Session):
    from app.models.client import Client
    from app.models.user import User
    from app.models.decision_system import DecisionSystem
    from app.core.security import get_password_hash
    
    # 1. Ensure Demo Client exists
    demo_client = db.query(Client).filter(Client.slug == "demo").first()
    if not demo_client:
        print("Creating Demo Client...")
        demo_client = Client(name="Demo Client", slug="demo")
        db.add(demo_client)
        db.commit()
        db.refresh(demo_client)
    
    # 2. Ensure Admin User exists
    admin_email = "admin@sentineldecisions.com"
    admin_user = db.query(User).filter(User.email == admin_email).first()
    
    try:
        new_hash = get_password_hash("admin123")
    except Exception as e:
        print(f"Hash generation FAILED: {e}")
        return f"Hash failed: {e}"

    if not admin_user:
        print("Creating Admin User...")
        admin_user = User(
            email=admin_email,
            hashed_password=new_hash,
            role="admin",
            client_id=demo_client.id
        )
        db.add(admin_user)
        db.commit()
    else:
        # Force update password to ensure it matches
        admin_user.hashed_password = new_hash
        db.add(admin_user)
        db.commit()

    # 3. Migrate Orphaned Systems
    orphans = db.query(DecisionSystem).filter(DecisionSystem.client_id == None).all()
    if orphans:
        print(f"Migrating {len(orphans)} orphaned systems to Demo Client...")
        for sys in orphans:
            sys.client_id = demo_client.id
        db.commit()
    
    return "Seeding Complete"

@app.get("/")
def read_root():
    return {"message": "Sentinel Decision Systems API is running"}
