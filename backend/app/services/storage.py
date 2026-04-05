import boto3
from boto3.s3.transfer import TransferConfig
from botocore.config import Config as BotoConfig
import os
from botocore.exceptions import ClientError
from app.core.config import settings

class StorageService:
    def __init__(self):
        self.mode = settings.STORAGE_TYPE  # "local" or "s3"
        print(f"Storage mode: {self.mode}")
        if self.mode == "s3":
            # Use path-style for S3-compatible providers (Railway, MinIO)
            self.s3_client = boto3.client(
                's3',
                endpoint_url=settings.AWS_ENDPOINT_URL,
                aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
                aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
                region_name=settings.AWS_DEFAULT_REGION or "us-east-1",
                config=BotoConfig(s3={"addressing_style": "path"}, signature_version="s3v4"),
            )
            self.bucket = settings.AWS_S3_BUCKET_NAME
            # Single-threaded transfers to avoid spawning thread pools in containers
            self._transfer_config = TransferConfig(use_threads=False)
            # Verify bucket is accessible (don't try to create — Railway manages it)
            try:
                self.s3_client.head_bucket(Bucket=self.bucket)
                print(f"S3 bucket '{self.bucket}' accessible.")
            except Exception as e:
                print(f"Warning: S3 bucket check failed: {e}")
        else:
            # Local filesystem fallback for dev without Docker/MinIO
            self.local_storage_path = os.path.join(os.getcwd(), "local_storage")
            os.makedirs(self.local_storage_path, exist_ok=True)

    def upload_file(self, file_obj, key: str):
        if self.mode == "s3":
            try:
                self.s3_client.upload_fileobj(file_obj, self.bucket, key,
                                             Config=self._transfer_config)
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
