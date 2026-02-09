from sqlalchemy import Column, String, DateTime, Boolean
from sqlalchemy.sql import func
from app.db.session import Base
import uuid


def generate_user_uuid():
    return f"usr_{uuid.uuid4().hex[:12]}"


class User(Base):
    """User model for authentication."""

    __tablename__ = "users"

    id = Column(String(50), primary_key=True, default=generate_user_uuid)
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True)
    is_superuser = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
