import csv
import io
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.dataset import Dataset, DatasetStatus

router = APIRouter(prefix="/datasets", tags=["datasets"])


class DatasetResponse(BaseModel):
    id: str
    decision_system_id: str
    filename: str
    s3_key: Optional[str]
    status: str
    row_count: Optional[int]
    column_count: Optional[int]
    columns: Optional[List[str]]
    metadata_info: Optional[dict]
    created_at: str

    class Config:
        from_attributes = True


class DatasetCreate(BaseModel):
    decision_system_id: str
    filename: str


@router.get("/", response_model=List[DatasetResponse])
async def list_datasets(
    system_id: Optional[str] = Query(None, description="Filter by decision system ID"),
    db: AsyncSession = Depends(get_db)
):
    """List all datasets, optionally filtered by system."""
    query = select(Dataset)
    if system_id:
        query = query.where(Dataset.decision_system_id == system_id)
    query = query.order_by(Dataset.created_at.desc())

    result = await db.execute(query)
    datasets = result.scalars().all()

    return [
        DatasetResponse(
            id=ds.id,
            decision_system_id=ds.decision_system_id,
            filename=ds.filename,
            s3_key=ds.s3_key,
            status=ds.status.value,
            row_count=ds.row_count,
            column_count=ds.column_count,
            columns=ds.columns,
            metadata_info=ds.metadata_info,
            created_at=ds.created_at.isoformat() if ds.created_at else None
        )
        for ds in datasets
    ]


@router.post("/upload", response_model=DatasetResponse)
async def upload_dataset(
    system_id: str = Query(..., description="Decision system ID"),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db)
):
    """Upload a CSV dataset."""
    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="Only CSV files are supported")

    # Read file content
    content = await file.read()
    try:
        # Parse CSV to get metadata
        decoded = content.decode('utf-8')
        reader = csv.reader(io.StringIO(decoded))
        rows = list(reader)

        if len(rows) < 2:
            raise HTTPException(status_code=400, detail="CSV must have at least a header and one data row")

        columns = rows[0]
        row_count = len(rows) - 1  # Exclude header

        # Create dataset record
        dataset = Dataset(
            decision_system_id=system_id,
            filename=file.filename,
            status=DatasetStatus.VALID,
            row_count=row_count,
            column_count=len(columns),
            columns=columns,
            metadata_info={
                "original_filename": file.filename,
                "content_type": file.content_type,
                "size_bytes": len(content)
            }
        )

        db.add(dataset)
        await db.commit()
        await db.refresh(dataset)

        return DatasetResponse(
            id=dataset.id,
            decision_system_id=dataset.decision_system_id,
            filename=dataset.filename,
            s3_key=dataset.s3_key,
            status=dataset.status.value,
            row_count=dataset.row_count,
            column_count=dataset.column_count,
            columns=dataset.columns,
            metadata_info=dataset.metadata_info,
            created_at=dataset.created_at.isoformat() if dataset.created_at else None
        )

    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="Could not decode CSV file. Ensure it's UTF-8 encoded.")
    except csv.Error as e:
        raise HTTPException(status_code=400, detail=f"CSV parsing error: {str(e)}")


@router.get("/{dataset_id}", response_model=DatasetResponse)
async def get_dataset(
    dataset_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get a specific dataset by ID."""
    result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    dataset = result.scalar_one_or_none()

    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    return DatasetResponse(
        id=dataset.id,
        decision_system_id=dataset.decision_system_id,
        filename=dataset.filename,
        s3_key=dataset.s3_key,
        status=dataset.status.value,
        row_count=dataset.row_count,
        column_count=dataset.column_count,
        columns=dataset.columns,
        metadata_info=dataset.metadata_info,
        created_at=dataset.created_at.isoformat() if dataset.created_at else None
    )


@router.delete("/{dataset_id}")
async def delete_dataset(
    dataset_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Delete a dataset."""
    result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    dataset = result.scalar_one_or_none()

    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    await db.delete(dataset)
    await db.commit()

    return {"message": "Dataset deleted successfully"}
