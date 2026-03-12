FROM python:3.11-slim

WORKDIR /app

# Ensure Python output is sent straight to logs (no buffering)
ENV PYTHONUNBUFFERED=1

# Install system dependencies for psycopg2 and ML packages
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create local storage directories
RUN mkdir -p /app/local_storage/datasets /app/local_storage/models

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
