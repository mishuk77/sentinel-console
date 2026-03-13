from pydantic_settings import BaseSettings
from pydantic import field_validator
from functools import lru_cache
from typing import Union


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # API
    API_V1_STR: str = "/api/v1"
    PROJECT_NAME: str = "Sentinel Decision Systems"
    DEBUG: bool = False
    ENV: str = "local"  # local, dev, prod

    # Database (using synchronous SQLAlchemy with psycopg2)
    DATABASE_URL: str = "postgresql://sentinel:sentinel_local@localhost:5432/sentinel"
    DATABASE_ECHO: bool = False

    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def normalize_postgres_url(cls, v: str) -> str:
        """Normalize postgres:// to postgresql:// for consistency."""
        if v.startswith("postgres://") and not v.startswith("postgresql://"):
            return v.replace("postgres://", "postgresql://", 1)
        return v

    # Authentication
    SECRET_KEY: str = "your-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 8  # 8 days

    # CORS - comma-separated string or list
    CORS_ORIGINS: Union[str, list[str]] = "http://localhost:5173,http://localhost:3000,https://app.sentineldecisions.com,https://sentineldecisions.com"

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, v: Union[str, list[str]]) -> list[str]:
        """Parse CORS origins from comma-separated string or list."""
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v

    # S3 / Storage
    AWS_ACCESS_KEY_ID: str = "minioadmin"
    AWS_SECRET_ACCESS_KEY: str = "minioadmin"
    AWS_ENDPOINT_URL: str = "http://localhost:9000"
    AWS_S3_BUCKET_NAME: str = "sentinel-artifacts"
    AWS_DEFAULT_REGION: str = "us-east-1"
    STORAGE_TYPE: str = "local"  # local or s3

    class Config:
        env_file = ".env"
        case_sensitive = True


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
