import boto3
import os
from botocore.exceptions import ClientError
from app.core.config import settings

class StorageService:
    def __init__(self):
        self.mode = "s3" if settings.ENV != "local" else "local"
        if self.mode == "s3":
            self.s3_client = boto3.client(
                's3',
                endpoint_url=settings.AWS_ENDPOINT_URL,
                aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
                aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
                region_name=settings.S3_REGION_NAME
            )
            self.bucket = settings.S3_BUCKET_NAME
            try:
                self.s3_client.create_bucket(Bucket=self.bucket)
            except Exception:
                pass # Bucket likely exists or we handle error later
        else:
            # Local filesystem fallback for dev without Docker/MinIO
            self.local_storage_path = os.path.join(os.getcwd(), "local_storage")
            os.makedirs(self.local_storage_path, exist_ok=True)

    def upload_file(self, file_obj, key: str):
        if self.mode == "s3":
            try:
                self.s3_client.upload_fileobj(file_obj, self.bucket, key)
                return f"s3://{self.bucket}/{key}"
            except ClientError as e:
                print(e)
                raise e
        else:
            # Save to local disk
            full_path = os.path.join(self.local_storage_path, key)
            os.makedirs(os.path.dirname(full_path), exist_ok=True)
            
            import shutil
            # Reset pointer just effectively? Rely on caller?
            # Ideally caller handles seek(0)
            
            with open(full_path, "wb") as f:
                shutil.copyfileobj(file_obj, f)
            return full_path

    def download_file(self, key: str, destination_path: str):
        if self.mode == "s3":
            self.s3_client.download_file(self.bucket, key, destination_path)
        else:
            # Copy from local disk
            full_path = os.path.join(self.local_storage_path, key)
            import shutil
            shutil.copy(full_path, destination_path)

storage = StorageService()
