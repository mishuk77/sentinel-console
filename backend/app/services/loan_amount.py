import pandas as pd
import numpy as np
from sqlalchemy.orm import Session
from app.models.dataset import Dataset
from app.models.ml_model import MLModel
from app.services.storage import storage
import joblib
import os
import io

class LoanAmountService:
    def __init__(self):
        pass

    def _get_bucket_range(self, amount: float, step: int = 100):
        """
        Returns (min_val, max_val) for the bucket.
        e.g. 150 -> (100, 199) or (100, 200)? 
        User spec: "0-99, 100-199".
        So floor(amount / 100) * 100.
        """
        if pd.isna(amount):
            return None
        lower = int(amount // step) * step
        upper = lower + step - 1
        return (lower, upper)

    async def generate_ladder(self, db: Session, model_id: str, dataset_id: str, threshold: float, amount_col: str = None, target_col: str = None):
        """
        Generates the Max Loan Amount Ladder based on Out-of-Sample performance.

        TASK-6: instead of hardcoding 'charge_off' / 'loan_amount' as defaults,
        we resolve the columns from the model and dataset metadata. The caller
        may still override (legacy code paths), but new callers should leave
        these None so the metadata-driven values flow through.
        """
        # 1. Load Model & Dataset
        model = db.query(MLModel).filter(MLModel.id == model_id).first()
        dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()

        if not model or not dataset:
            raise ValueError("Model or Dataset not found")

        # Resolve the target/amount columns from metadata when not overridden.
        # If a caller passes "charge_off" explicitly that still works (legacy),
        # but newly-trained models carry their target_column on the record.
        if target_col is None:
            target_col = getattr(model, "target_column", None) or "charge_off"
        if amount_col is None:
            amount_col = getattr(dataset, "approved_amount_column", None) or "loan_amount"

        # 2. Load Data
        print(f"Loading data from {dataset.s3_key}")
        local_csv_path = f"temp_ladder_{dataset_id}.csv"
        try:
            storage.download_file(dataset.s3_key, local_csv_path)
            df = pd.read_csv(local_csv_path)
            
            # Validation
            if amount_col not in df.columns:
                raise ValueError(f"Loan amount column '{amount_col}' not found in dataset. Cannot generate ladder.")
            if target_col not in df.columns:
                 raise ValueError(f"Target column '{target_col}' not found.")

            # 3. Re-run Out-of-Sample Split
            # MUST match training split exactly.
            # Assuming training used train_test_split(test_size=0.2, random_state=42)
            from sklearn.model_selection import train_test_split
            
            # We need to replicate the exact Feature selection used in Training?
            # Or just split the whole DF and then select features.
            # Ideally split indices.
            # For MVP, we split the DF.
            
            train_df, test_df = train_test_split(df, test_size=0.2, random_state=42)
            
            # Filter test_df to rows with valid amounts
            test_df = test_df[test_df[amount_col] > 0].copy()
            
            # 4. Score the Test Set
            # Load Model Artifact (handles Schema v2 dict and legacy formats)
            local_model_path = f"temp_model_{model_id}.pkl"
            storage.download_file(model.artifact_path, local_model_path)
            artifact = joblib.load(local_model_path)
            os.remove(local_model_path)

            # Build raw feature DataFrame (drop target + amount + id-ish columns).
            # Schema v2 artifacts run their own preprocessor on raw columns,
            # so we must NOT pre-encode here.
            exclude = {target_col.lower(), amount_col.lower(), "id", "customer_id",
                       "created_at", "applicant_id", "uuid", "name", "email", "phone"}
            feature_cols = [
                c for c in test_df.columns
                if c.lower() not in exclude and not c.lower().endswith("id")
            ]
            X_raw = test_df[feature_cols]

            # Schema dispatch — same pattern as decision_service / simulation.
            # Without this dispatch, Schema v2 artifacts (dict with embedded
            # InferencePreprocessor) raise AttributeError on .predict_proba.
            if isinstance(artifact, dict) and artifact.get("schema_version") == 2 \
                    and "preprocessor" in artifact:
                clf = artifact["model"]
                preprocessor = artifact["preprocessor"]
                scaler = artifact.get("scaler")
                use_scaled = artifact.get("use_scaled", False)
                X_processed = preprocessor.transform(X_raw)
                if use_scaled and scaler is not None:
                    X_test = pd.DataFrame(
                        scaler.transform(X_processed),
                        columns=X_processed.columns,
                        index=X_processed.index,
                    )
                else:
                    X_test = X_processed
                preds = clf.predict_proba(X_test)[:, 1]
            elif isinstance(artifact, dict) and "model" in artifact:
                # Legacy v1 individual-model wrapper
                clf = artifact["model"]
                columns = artifact.get("columns")
                scaler = artifact.get("scaler")
                X_test = pd.get_dummies(X_raw, dummy_na=True).fillna(0)
                if columns:
                    X_test = X_test.reindex(columns=columns, fill_value=0)
                if scaler is not None:
                    X_test = pd.DataFrame(scaler.transform(X_test),
                                          columns=getattr(scaler, "feature_names_in_", columns),
                                          index=X_test.index)
                preds = clf.predict_proba(X_test)[:, 1]
            elif hasattr(artifact, "predict_proba"):
                # Raw sklearn model
                if hasattr(artifact, "feature_names_in_"):
                    X_test = X_raw.reindex(columns=artifact.feature_names_in_, fill_value=0)
                else:
                    X_test = pd.get_dummies(X_raw, dummy_na=True).fillna(0)
                preds = artifact.predict_proba(X_test)[:, 1]
            else:
                raise ValueError(
                    f"Unsupported artifact type for ladder generation: {type(artifact)} "
                    f"keys={list(artifact.keys()) if isinstance(artifact, dict) else 'n/a'}"
                )

            test_df["score"] = preds
            
            # 5. Compute Deciles
            # Decile 1 = Lowest Risk (Lowest Score)
            # Decile 10 = Highest Risk
            test_df["decile"] = pd.qcut(test_df["score"], 10, labels=False, duplicates='drop') + 1
            
            # Store Decile Boundaries for Runtime
            # Min/Max score per decile
            decile_stats = test_df.groupby("decile")["score"].agg(["min", "max"]).to_dict('index')
            
            # 6. Bucket Analysis
            # Group by Decile + Amount Bucket
            test_df["bucket_lower"] = (test_df[amount_col] // 100 * 100).astype(int)
            
            # Pivot: Index=Decile, Columns=Bucket, Value=BadRate
            # We need to find MAX bucket where BadRate <= Threshold
            
            ladder = {} # decile -> max_amount
            performance_grid = {} # for audit/UI
            
            unique_deciles = sorted(test_df["decile"].unique())
            
            for d in unique_deciles:
                decile_data = test_df[test_df["decile"] == d]
                
                # Sort by bucket
                buckets = sorted(decile_data["bucket_lower"].unique())
                
                max_allowed = 0
                
                grid_row = []
                
                for b_low in buckets:
                    b_data = decile_data[decile_data["bucket_lower"] == b_low]
                    count = len(b_data)
                    if count < 5: 
                         # Low confidence skip? Or just be conservative?
                         # For now, simplistic: if low sample, we don't trust it as a "safe" anchor unless previous was safe.
                         bad_rate = b_data[target_col].mean() if count > 0 else 1.0 # Penalize empty
                    else:
                        bad_rate = b_data[target_col].mean()
                        
                    grid_row.append({
                        "bucket": f"{b_low}-{b_low+99}",
                        "min": int(b_low),
                        "count": int(count),
                        "bad_rate": float(bad_rate)
                    })
                    
                    if bad_rate <= threshold:
                        # This bucket is safe.
                        # Recommended max is the UPPER bound of this bucket.
                        max_allowed = b_low + 99
                    else:
                        # Unsafe. Stop? 
                        # Or continue? 
                        # Usually risk increases with amount. If we hit a bad bucket, we usually cap there.
                        # Aggressive Stop:
                        break
                
                ladder[int(d)] = int(max_allowed)
                performance_grid[int(d)] = grid_row
                
            # 7. Monotonicity Enforcement
            # Rule: Better Risk (Lower Decile) should NOT have Lower Max Amount.
            # i.e., Decile 1 Limit >= Decile 2 Limit >= ... >= Decile 10 Limit.
            # Current Loop: 1..10.
            # We want: Limit(1) >= Limit(2) ...
            # Wait, if data says Decile 1 (Safe) can handle $10k, but Decile 2 (Risky) can handle $20k (noise?), 
            # we should cap Decile 2 at Decile 1? No, logic is usually:
            # You shouldn't be penalized for being BETTER.
            # So Limit(Decile N) >= Limit(Decile N+1).
            # We iterate from Worst (10) to Best (1).
            # Limit(9) = max(Limit(9), Limit(10)). 
            # Limit(8) = max(Limit(8), Limit(9)).
            # ...
            # Limit(1) = max(Limit(1), Limit(2)).
            
            # Let's verify Decile 1 is Best. `score` is charge-off prob. So Low Score = Low Risk = Best.
            # `decile` 1 is Low Score. So Decile 1 is Best.
            
            # Monotonicity: Limit(1) >= Limit(2) ... >= Limit(10).
            
            sorted_deciles = sorted(ladder.keys(), reverse=True) # 10, 9, 8...
            
            running_max = 0
            # Wait, going from 10 to 1 requires "smoothing up"?
            # If 10 allows $0, 9 allows $1000. 10 is restricted.
            # If 10 allows $5000 (noise) and 9 allows $1000.
            # Should 10 be capped at 9? Or 9 boosted to 10?
            # It's safer to Cap Down.
            # Better risk (lower decile) gets HIGHER limits.
            # Worse risk (higher decile) gets LOWER limits.
            # So Limit(N) <= Limit(N-1).
            
            # Algorithm:
            # Pass 1 (Smoothing from Best to Worst? or Worst to Best?)
            # Usually: Limit(Decile K) cannot exceed Limit(Decile K-1).
            # Because K is riskier.
            # So limit is min(observed_limit(K), final_limit(K-1)).
            # Base case: Decile 1 is observed_limit(1).
            
            final_ladder = {}
            prev_limit = float('inf')
            
            for d in sorted(ladder.keys()): # 1, 2, 3...
                obs = ladder[d]
                final = min(obs, prev_limit)
                final_ladder[d] = final
                prev_limit = final
                
            return {
                "ladder": final_ladder,
                "decile_stats": decile_stats,
                "performance_grid": performance_grid,
                "threshold_used": threshold
            }
            
        except Exception as e:
            print(f"Error generating ladder: {e}")
            if os.path.exists(local_csv_path):
                os.remove(local_csv_path)
            raise e
        finally:
            if os.path.exists(local_csv_path):
                os.remove(local_csv_path)

    def apply_ladder(self, amount_ladder: dict, score: float, requested_amount: float = None, calibration: list = None):
        """
        Runtime application of the ladder.
        """
        if not amount_ladder:
            return None

        # Handle both formats: {"1": 50000, ...} or {"ladder": {...}, "decile_stats": {...}}
        if "ladder" in amount_ladder:
            ladder = amount_ladder.get("ladder", {})
            decile_stats = amount_ladder.get("decile_stats", {})
        else:
            # Simple format: amount_ladder IS the ladder
            ladder = amount_ladder
            decile_stats = {}

        # 1. Determine Decile
        assigned_decile = 10 # Default to worst

        if decile_stats:
            # Use stored decile stats
            for d_str, stats in sorted(decile_stats.items(), key=lambda x: int(x[0])):
                d = int(d_str)
                if stats["min"] <= score <= stats["max"]:
                    assigned_decile = d
                    break
        elif calibration:
            # Use calibration data from model training
            # Calibration is a list of dicts: [{"decile": 1, "min_score": 0.0, "max_score": 0.15, ...}, ...]
            for cal in calibration:
                d = cal.get("decile")
                min_score = cal.get("min_score", 0)
                max_score = cal.get("max_score", 1)
                if min_score <= score <= max_score:
                    assigned_decile = d
                    break

        # 2. Lookup Limit
        allowed = ladder.get(str(assigned_decile)) or ladder.get(assigned_decile) or 0

        # 3. Approve
        if requested_amount is not None:
            approved = min(requested_amount, allowed)
        else:
            approved = allowed

        return {
            "decile": assigned_decile,
            "allowed_amount": allowed,
            "approved_amount": approved
        }

loan_amount_service = LoanAmountService()
