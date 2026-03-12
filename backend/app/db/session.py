from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.core.config import settings

# Handle SQLite vs Postgres
database_url = settings.DATABASE_URL

connect_args = {}
if "sqlite" in database_url:
    connect_args = {"check_same_thread": False}

engine = create_engine(
    database_url,
    pool_pre_ping=True,
    connect_args=connect_args
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
