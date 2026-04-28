from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, Form
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.models.dataset import Dataset, DatasetStatus
from app.services.storage import storage
import uuid

router = APIRouter()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

from app.api import deps
from app.models.user import User
from app.models.decision_system import DecisionSystem

@router.post("/upload")
async def upload_dataset(
    system_id: str = Form(...),
    file: UploadFile = File(...),
    module_type: str = Form(None),
    label_column: str = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    # Verify System Ownership
    system = db.query(DecisionSystem).filter(
        DecisionSystem.id == system_id,
        DecisionSystem.client_id == current_user.client_id
    ).first()
    
    if not system:
        raise HTTPException(status_code=404, detail="Decision System not found")

    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="Only CSV files allowed")
        
    # Generate S3 Key
    file_id = str(uuid.uuid4())
    key = f"datasets/{file_id}_{file.filename}"
    
    # Read entire content into memory (Async safe)
    content = await file.read()
    
    # Parse Headers from bytes
    columns = []
    try:
        # Find first line
        first_line_end = content.find(b'\n')
        if first_line_end == -1:
            first_line = content # 1 line file
        else:
            first_line = content[:first_line_end]
            
        if first_line:
            header_str = first_line.decode('utf-8', errors='ignore').strip()
            columns = [c.strip().strip('"') for c in header_str.split(',')]
    except Exception as e:
        print(f"Error parsing CSV headers: {e}")
        columns = []
    
    # Store in S3/Local using BytesIO
    from io import BytesIO
    file_obj = BytesIO(content)
    location = storage.upload_file(file_obj, key)

    # Create DB Record with module_type and label_column
    metadata = {
        "original_filename": file.filename,
        "location": location,
        "columns": columns,
        "row_count": len(content.splitlines()) - 1 if columns else 0
    }
    if label_column:
        metadata["label_column"] = label_column

    # TASK-6: auto-suggest the approved-amount, loss-amount, and id columns
    # at upload time so the user has sensible defaults to confirm. The user
    # can override on the dataset detail page via PATCH /datasets/{id}.
    from app.services.loss_metadata import (
        suggest_approved_amount_column,
        suggest_loss_amount_column,
        suggest_id_column,
    )

    dataset = Dataset(
        id=file_id,
        decision_system_id=system_id,
        s3_key=key,
        status=DatasetStatus.PENDING,
        module_type=module_type,
        metadata_info=metadata,
        approved_amount_column=suggest_approved_amount_column(columns),
        loss_amount_column=suggest_loss_amount_column(columns),
        id_column=suggest_id_column(columns),
    )
    # Immediate transition to VALID since we parsed it
    dataset.status = DatasetStatus.VALID if columns else DatasetStatus.INVALID
    db.add(dataset)
    db.commit()
    db.refresh(dataset)

    return dataset


from pydantic import BaseModel
from typing import Optional, List


class DatasetMetadataUpdate(BaseModel):
    """TASK-6 / TASK-11F / TASK-11G: payload for editing dataset column
    annotations after upload. Each field is optional; only provided fields
    are updated. Use null to clear a field."""
    approved_amount_column: Optional[str] = None
    loss_amount_column: Optional[str] = None
    id_column: Optional[str] = None
    segmenting_dimensions: Optional[List[str]] = None
    # Sentinel value to explicitly clear a field — the field was provided
    # but with the literal value "__clear__"
    _clearable_fields: tuple = ()


@router.patch("/{dataset_id}/metadata")
def update_dataset_metadata(
    dataset_id: str,
    payload: DatasetMetadataUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """
    Update dataset column annotations.

    Only fields present in the request body are updated. To clear a field,
    pass an empty string. Validates that the column names actually exist in
    the dataset so we don't end up with stale references.
    """
    dataset = db.query(Dataset).join(DecisionSystem).filter(
        Dataset.id == dataset_id,
        DecisionSystem.client_id == current_user.client_id,
    ).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    available_columns = (dataset.metadata_info or {}).get("columns") or []
    available_lower = {c.lower() for c in available_columns}

    def _validate_col(name: Optional[str], field: str) -> Optional[str]:
        if name is None:
            return None
        if name == "":
            return None  # explicit clear
        if name.lower() not in available_lower:
            raise HTTPException(
                status_code=400,
                detail=f"Column '{name}' not found in dataset for field '{field}'. "
                       f"Available: {available_columns}",
            )
        # Use the original casing to match the actual column name
        return next(c for c in available_columns if c.lower() == name.lower())

    if payload.approved_amount_column is not None:
        dataset.approved_amount_column = _validate_col(
            payload.approved_amount_column, "approved_amount_column"
        )
    if payload.loss_amount_column is not None:
        dataset.loss_amount_column = _validate_col(
            payload.loss_amount_column, "loss_amount_column"
        )
    if payload.id_column is not None:
        dataset.id_column = _validate_col(payload.id_column, "id_column")
    if payload.segmenting_dimensions is not None:
        # Validate every entry in the list
        validated = []
        for col in payload.segmenting_dimensions:
            v = _validate_col(col, "segmenting_dimensions")
            if v:
                validated.append(v)
        dataset.segmenting_dimensions = validated

    db.commit()
    db.refresh(dataset)
    return dataset

@router.get("/")
def list_datasets(
    system_id: str = None,
    module_type: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    query = db.query(Dataset).join(DecisionSystem).filter(
        DecisionSystem.client_id == current_user.client_id
    )
    if system_id:
        query = query.filter(Dataset.decision_system_id == system_id)
    if module_type:
        query = query.filter(Dataset.module_type == module_type)
    datasets = query.order_by(Dataset.created_at.desc()).all()
    return datasets

@router.get("/{dataset_id}/download")
def download_dataset(
    dataset_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    dataset = db.query(Dataset).join(DecisionSystem).filter(
        Dataset.id == dataset_id,
        DecisionSystem.client_id == current_user.client_id
    ).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    import tempfile, os
    tmp_fd, temp_path = tempfile.mkstemp(suffix=".csv")
    os.close(tmp_fd)
    try:
        storage.download_file(dataset.s3_key, temp_path)
        with open(temp_path, "rb") as f:
            content = f.read()
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

    filename = dataset.metadata_info.get("original_filename", "dataset.csv") if dataset.metadata_info else "dataset.csv"
    import io
    return StreamingResponse(
        io.BytesIO(content),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )

@router.get("/{dataset_id}/preview")
def preview_dataset(
    dataset_id: str, 
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    # 1. Get Dataset with explicit ownership check
    dataset = db.query(Dataset).join(DecisionSystem).filter(
        Dataset.id == dataset_id,
        DecisionSystem.client_id == current_user.client_id
    ).first()
    
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    # 2. Download/Read first N lines
    try:
        # Use pandas for easy preview (assuming local storage allows synchronous read or we act carefully)
        # For simplicity in local dev, download to temp.
        local_path = "temp_preview.csv"
        storage.download_file(dataset.s3_key, local_path)
        
        import pandas as pd
        df = pd.read_csv(local_path, nrows=5) # Top 5 rows
        
        # Helper to get missing info
        # Actually checking missing across whole file is expensive. 
        # Check missing in sample? Or just return sample.
        # "Missing value indicators" -> maybe just in the sample view.
        
        preview = df.to_dict(orient="records")
        dtypes = df.dtypes.astype(str).to_dict()
        
        columns_info = []
        for col in df.columns:
            columns_info.append({
                "name": col,
                "type": str(df[col].dtype),
                "sample": str(df[col].iloc[0]) if not df.empty else ""
            })

        import os
        if os.path.exists(local_path):
            try:
                os.remove(local_path)
            except:
                pass
            
        return {"rows": preview, "columns": columns_info}
        
    except Exception as e:
         print(f"Preview failed: {e}")
         raise HTTPException(status_code=500, detail="Failed to load preview")

@router.get("/{dataset_id}/segment-columns")
def get_segment_columns(
    dataset_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """
    Return columns suitable for segmentation: categorical / low-cardinality (2–50 unique values),
    with their sorted unique values.  High-cardinality numeric columns are excluded.
    """
    dataset = db.query(Dataset).join(DecisionSystem).filter(
        Dataset.id == dataset_id,
        DecisionSystem.client_id == current_user.client_id
    ).first()

    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    import tempfile, os
    import pandas as pd

    tmp_fd, temp_path = tempfile.mkstemp(suffix=".csv")
    os.close(tmp_fd)
    try:
        storage.download_file(dataset.s3_key, temp_path)
        df = pd.read_csv(temp_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load dataset: {str(e)}")
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

    metadata = dataset.metadata_info or {}
    label_col = metadata.get("label_column", "charge_off")

    # Column name fragments that indicate non-segment fields
    exclude_fragments = [
        "id", "amount", "income", "score", "name", "email",
        "phone", "ssn", "date", "created", "applicant", "fico",
        "dti", "payment", "balance", "rate", "salary"
    ]

    result = []
    for col in df.columns:
        if col == label_col:
            continue
        col_lower = col.lower()
        if any(frag in col_lower for frag in exclude_fragments):
            continue
        unique_vals = df[col].dropna().unique()
        if 2 <= len(unique_vals) <= 50:
            result.append({
                "column": col,
                "values": sorted([str(v) for v in unique_vals])
            })

    return result


@router.get("/{dataset_id}/profile")
def profile_dataset(
    dataset_id: str,
    target_col: str,
    feature_cols: str = "",
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """
    Compute per-column data quality stats for the selected target + feature columns.
    feature_cols is a comma-separated string.
    """
    dataset = db.query(Dataset).join(DecisionSystem).filter(
        Dataset.id == dataset_id,
        DecisionSystem.client_id == current_user.client_id
    ).first()

    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    import tempfile, os
    import pandas as pd

    tmp_fd, temp_path = tempfile.mkstemp(suffix=".csv")
    os.close(tmp_fd)
    try:
        storage.download_file(dataset.s3_key, temp_path)
        df = pd.read_csv(temp_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load dataset: {str(e)}")
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

    if target_col not in df.columns:
        raise HTTPException(status_code=400, detail=f"Target column '{target_col}' not found")

    selected_features = [c.strip() for c in feature_cols.split(",") if c.strip()] if feature_cols else []
    total_rows = len(df)

    # Class balance for target
    class_balance = None
    try:
        class_balance = round(float(df[target_col].mean()), 4)
    except Exception:
        pass

    # Per-column profile
    columns_profile = []
    for col in selected_features:
        if col not in df.columns:
            continue
        series = df[col]
        missing_count = int(series.isnull().sum())
        missing_pct = round(missing_count / total_rows * 100, 1) if total_rows > 0 else 0.0
        unique_count = int(series.nunique())
        dtype = str(series.dtype)

        col_info: dict = {
            "name": col,
            "dtype": dtype,
            "missing_pct": missing_pct,
            "unique_count": unique_count,
        }

        if pd.api.types.is_numeric_dtype(series):
            non_null = series.dropna()
            if len(non_null) > 0:
                col_info["min"] = round(float(non_null.min()), 4)
                col_info["max"] = round(float(non_null.max()), 4)
                col_info["mean"] = round(float(non_null.mean()), 4)
                col_info["median"] = round(float(non_null.median()), 4)

        columns_profile.append(col_info)

    # Overall missing across all selected features
    overall_missing_pct = 0.0
    if selected_features:
        sel_cols = [c for c in selected_features if c in df.columns]
        if sel_cols:
            sel_df = df[sel_cols]
            if sel_df.size > 0:
                overall_missing_pct = round(float(sel_df.isnull().sum().sum() / sel_df.size * 100), 2)

    return {
        "total_rows": total_rows,
        "feature_count": len(selected_features),
        "class_balance": class_balance,
        "overall_missing_pct": overall_missing_pct,
        "columns": columns_profile,
    }


@router.delete("/{dataset_id}")
def delete_dataset(
    dataset_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    dataset = db.query(Dataset).join(DecisionSystem).filter(
        Dataset.id == dataset_id,
        DecisionSystem.client_id == current_user.client_id
    ).first()
    
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
        
    try:
        # Note: We are NOT deleting from S3 mainly to avoid 'boto3' permission complexity 
        # or errors blocking the DB delete.
        db.delete(dataset)
        db.commit()
    except Exception as e:
        print(f"Delete failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete dataset")
        
    return {"message": "Dataset deleted"}
