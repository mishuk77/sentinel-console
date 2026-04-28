from sqlalchemy import Column, String, Float, Boolean, DateTime, ForeignKey, Integer, JSON
from sqlalchemy.orm import relationship
import uuid
import enum
from datetime import datetime
from app.db.base_class import Base


class PolicyState(str, enum.Enum):
    """TASK-11E: explicit policy lifecycle states.

        draft     — in-flight edits, not used by production decisioning
        published — active production policy (only one published per system)
        archived  — historical record of a previously-published policy

    Migration mapping (per Q7 resolution): existing rows with
    is_active=True become 'published'; is_active=False become 'archived'.
    Newly-created policies default to 'draft'.
    """

    DRAFT = "draft"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class Policy(Base):
    __tablename__ = "policies"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    model_id = Column(String, ForeignKey("models.id"), nullable=False)
    threshold = Column(Float, nullable=False)
    projected_approval_rate = Column(Float, nullable=True)
    projected_loss_rate = Column(Float, nullable=True)
    target_decile = Column(Integer, nullable=True)
    amount_ladder = Column(JSON, nullable=True)
    is_active = Column(Boolean, default=False)  # retained for backward compat
    created_at = Column(DateTime, default=datetime.utcnow)

    # TASK-11E: explicit state field. We retain is_active as a derived
    # alias (synced via service layer) so older endpoints keep working.
    state = Column(String, default=PolicyState.DRAFT.value, nullable=True)

    # TASK-11E: audit trail for publish events (TASK-11C audit metadata).
    last_published_at = Column(DateTime, nullable=True)
    published_by = Column(String, nullable=True)  # user email or system id

    # TASK-11D: snapshot of the policy at the moment it was last published.
    # Used so historical backtests/simulations can re-render with the exact
    # configuration in effect at the time, even after the policy has been
    # edited or rolled back.
    published_snapshot = Column(JSON, nullable=True)

    model = relationship("MLModel")

    decision_system_id = Column(String, ForeignKey("decision_systems.id"), nullable=True)
    decision_system = relationship("DecisionSystem", back_populates="policies")
