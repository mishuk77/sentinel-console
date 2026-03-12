# Sentinel Decision Systems - Deployment Guide

This guide covers deploying the Sentinel Console monorepo (backend + frontend) to various environments.

## Table of Contents

1. [Local Development Setup](#local-development-setup)
2. [Database Migrations](#database-migrations)
3. [Environment Configuration](#environment-configuration)
4. [Docker Deployment](#docker-deployment)
5. [AWS Deployment](#aws-deployment)
6. [Railway Deployment (Backend)](#railway-deployment-backend)
7. [Vercel Deployment (Frontend)](#vercel-deployment-frontend)
8. [Troubleshooting](#troubleshooting)
9. [Security Checklist](#security-checklist)
10. [Monitoring & Backups](#monitoring--backups)

---

## Local Development Setup

### Prerequisites

- **Python 3.11+** with pip
- **Node.js 18+** with npm
- **Docker** and **Docker Compose**
- **Git**

### Step 1: Clone and Install Dependencies

```bash
# Clone the repository
cd c:\Dev\sentinel-console

# Backend setup
cd backend
python -m venv venv
venv\Scripts\activate  # On Windows
pip install -r requirements.txt

# Frontend setup
cd ..\frontend
npm install
```

### Step 2: Start Infrastructure Services

```bash
# From the root directory (c:\Dev\sentinel-console)
docker-compose up -d
```

This starts:
- PostgreSQL on port 5432
- Redis on port 6379
- pgAdmin on port 5050 (http://localhost:5050)

### Step 3: Configure Environment

```bash
# Backend
cd backend
copy .env.example .env
# Edit .env with your local settings
```

Key settings for local development:
```env
DATABASE_URL=postgresql://sentinel:sentinel_local@localhost:5432/sentinel
SECRET_KEY=your-local-secret-key-change-this
ENV=local
DEBUG=true
STORAGE_TYPE=local
```

### Step 4: Run Database Migrations

```bash
cd backend
alembic upgrade head
```

### Step 5: Start Development Servers

**Backend (Terminal 1):**
```bash
cd backend
venv\Scripts\activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

**Frontend (Terminal 2):**
```bash
cd frontend
npm run dev
```

Access the application:
- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs
- pgAdmin: http://localhost:5050

Demo credentials:
- Email: admin@sentinel.com
- Password: admin123

---

## Database Migrations

### Creating New Migrations

```bash
cd backend
alembic revision --autogenerate -m "Description of changes"
```

### Applying Migrations

```bash
# Upgrade to latest
alembic upgrade head

# Downgrade one revision
alembic downgrade -1

# View migration history
alembic history

# View current version
alembic current
```

### Migration Best Practices

- Always review auto-generated migrations before applying
- Test migrations on a copy of production data
- Create backups before running migrations in production
- Include both upgrade and downgrade logic

---

## Environment Configuration

### Backend Environment Variables

Create a `.env` file in the `backend/` directory:

```env
# API Configuration
API_V1_STR=/api/v1
PROJECT_NAME=Sentinel Decision Systems
ENV=production
DEBUG=false

# Database
DATABASE_URL=postgresql://user:password@host:5432/dbname

# Security
SECRET_KEY=your-super-secret-key-min-32-chars
ACCESS_TOKEN_EXPIRE_MINUTES=11520

# CORS
CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com

# Storage (choose local or s3)
STORAGE_TYPE=s3
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1
S3_BUCKET=sentinel-datasets
S3_ENDPOINT_URL=  # Leave empty for AWS, set for MinIO/custom S3

# Redis (optional, for future caching)
REDIS_URL=redis://localhost:6379/0
```

### Frontend Environment Variables

Create a `.env` file in the `frontend/` directory:

```env
VITE_API_BASE_URL=https://api.yourdomain.com/api/v1
```

---

## Docker Deployment

### Production Docker Compose

Create `docker-compose.prod.yml`:

```yaml
version: '3.8'

services:
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://sentinel:${DB_PASSWORD}@postgres:5432/sentinel
      - SECRET_KEY=${SECRET_KEY}
      - ENV=production
      - DEBUG=false
    depends_on:
      - postgres
      - redis
    volumes:
      - ./local_storage:/app/local_storage
    restart: unless-stopped

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
      args:
        - VITE_API_BASE_URL=${API_BASE_URL}
    ports:
      - "80:80"
    depends_on:
      - backend
    restart: unless-stopped

  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: sentinel
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: sentinel
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    restart: unless-stopped

volumes:
  postgres_data:
```

### Backend Dockerfile

Create `backend/Dockerfile`:

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create local storage directory
RUN mkdir -p /app/local_storage/datasets /app/local_storage/models

# Run migrations and start server
CMD alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### Frontend Dockerfile

Create `frontend/Dockerfile`:

```dockerfile
FROM node:18-alpine AS build

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

# Production stage with Nginx
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### Nginx Configuration

Create `frontend/nginx.conf`:

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

### Deploy with Docker Compose

```bash
# Create .env file with production secrets
cat > .env << EOF
DB_PASSWORD=your-secure-db-password
SECRET_KEY=your-super-secret-key-min-32-chars
API_BASE_URL=https://api.yourdomain.com/api/v1
EOF

# Build and start services
docker-compose -f docker-compose.prod.yml up -d --build

# View logs
docker-compose -f docker-compose.prod.yml logs -f

# Stop services
docker-compose -f docker-compose.prod.yml down
```

---

## AWS Deployment

### Architecture Overview

- **Frontend**: S3 + CloudFront or EC2
- **Backend**: ECS Fargate or EC2
- **Database**: RDS PostgreSQL
- **Storage**: S3 for datasets/models
- **Cache**: ElastiCache Redis (optional)

### Step 1: Set Up RDS PostgreSQL

```bash
# Using AWS CLI
aws rds create-db-instance \
    --db-instance-identifier sentinel-postgres \
    --db-instance-class db.t3.micro \
    --engine postgres \
    --engine-version 16.1 \
    --master-username sentinel \
    --master-user-password YourSecurePassword \
    --allocated-storage 20 \
    --vpc-security-group-ids sg-xxxxxxxx \
    --db-subnet-group-name your-subnet-group \
    --backup-retention-period 7 \
    --publicly-accessible false
```

### Step 2: Create S3 Bucket for Datasets

```bash
aws s3 mb s3://sentinel-datasets
aws s3api put-bucket-versioning \
    --bucket sentinel-datasets \
    --versioning-configuration Status=Enabled
```

### Step 3: Deploy Backend to ECS

Create `backend/task-definition.json`:

```json
{
  "family": "sentinel-backend",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "containerDefinitions": [
    {
      "name": "backend",
      "image": "your-ecr-repo/sentinel-backend:latest",
      "portMappings": [
        {
          "containerPort": 8000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {"name": "ENV", "value": "production"},
        {"name": "STORAGE_TYPE", "value": "s3"},
        {"name": "AWS_REGION", "value": "us-east-1"},
        {"name": "S3_BUCKET", "value": "sentinel-datasets"}
      ],
      "secrets": [
        {"name": "DATABASE_URL", "valueFrom": "arn:aws:secretsmanager:..."},
        {"name": "SECRET_KEY", "valueFrom": "arn:aws:secretsmanager:..."}
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/sentinel-backend",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

Deploy:

```bash
# Build and push Docker image
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin your-ecr-repo
docker build -t sentinel-backend ./backend
docker tag sentinel-backend:latest your-ecr-repo/sentinel-backend:latest
docker push your-ecr-repo/sentinel-backend:latest

# Register task definition
aws ecs register-task-definition --cli-input-json file://backend/task-definition.json

# Create or update service
aws ecs create-service \
    --cluster your-cluster \
    --service-name sentinel-backend \
    --task-definition sentinel-backend \
    --desired-count 2 \
    --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx],securityGroups=[sg-xxx],assignPublicIp=ENABLED}" \
    --load-balancers "targetGroupArn=arn:aws:elasticloadbalancing:...,containerName=backend,containerPort=8000"
```

### Step 4: Deploy Frontend to S3 + CloudFront

```bash
# Build frontend
cd frontend
VITE_API_BASE_URL=https://api.yourdomain.com/api/v1 npm run build

# Upload to S3
aws s3 sync dist/ s3://sentinel-frontend --delete

# Invalidate CloudFront cache
aws cloudfront create-invalidation \
    --distribution-id YOUR_DISTRIBUTION_ID \
    --paths "/*"
```

### Step 5: Set Up Application Load Balancer

Configure ALB to route traffic to ECS tasks:
- Listener: HTTPS:443 with SSL certificate
- Target Group: Forward to ECS tasks on port 8000
- Health Check: GET /api/v1/health (you may need to add this endpoint)

---

## Railway Deployment (Backend)

Railway provides simple PostgreSQL + Python deployments.

### Step 1: Create Railway Project

1. Go to https://railway.app
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Connect your repository

### Step 2: Configure Backend Service

Create `railway.json` in `backend/`:

```json
{
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

### Step 3: Add PostgreSQL Service

In Railway dashboard:
1. Click "New" → "Database" → "PostgreSQL"
2. Copy the DATABASE_URL variable

### Step 4: Set Environment Variables

In Railway backend service settings:

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
SECRET_KEY=your-generated-secret-key-32-chars
ENV=production
DEBUG=false
CORS_ORIGINS=https://yourfrontend.vercel.app
STORAGE_TYPE=s3
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
AWS_REGION=us-east-1
S3_BUCKET=sentinel-datasets
```

### Step 5: Deploy

Railway auto-deploys on git push. Monitor logs in the Railway dashboard.

---

## Vercel Deployment (Frontend)

### Step 1: Connect Repository

1. Go to https://vercel.com
2. Import your GitHub repository
3. Configure build settings

### Step 2: Configure Build Settings

- **Framework Preset**: Vite
- **Root Directory**: frontend
- **Build Command**: `npm run build`
- **Output Directory**: `dist`

### Step 3: Set Environment Variables

In Vercel project settings:

```
VITE_API_BASE_URL=https://your-backend.railway.app/api/v1
```

### Step 4: Deploy

Vercel auto-deploys on git push to main branch.

### Custom Domain Setup

1. Go to Project Settings → Domains
2. Add your custom domain
3. Configure DNS records as instructed
4. Update CORS_ORIGINS in backend to include your Vercel domain

---

## Troubleshooting

### Database Connection Issues

**Problem**: Backend cannot connect to PostgreSQL

**Solutions**:
- Verify DATABASE_URL format: `postgresql://user:password@host:5432/dbname`
- For local Docker: use `host.docker.internal` instead of `localhost`
- Check PostgreSQL is running: `docker ps` or `pg_isready -h localhost`
- Verify network connectivity and firewall rules

### Migration Failures

**Problem**: Alembic migrations fail

**Solutions**:
```bash
# Check current version
alembic current

# View pending migrations
alembic history

# Manually inspect migration file
# Fix any issues in alembic/versions/xxxxx.py

# Try again
alembic upgrade head

# If stuck, reset to a known good state (DANGEROUS - only in dev)
alembic downgrade base
alembic upgrade head
```

### CORS Errors

**Problem**: Frontend gets CORS errors when calling API

**Solutions**:
- Verify CORS_ORIGINS in backend .env includes frontend URL
- Ensure no trailing slashes in CORS_ORIGINS
- Check browser console for exact error message
- Verify API is accessible: `curl https://api.yourdomain.com/api/v1/health`

### File Upload Issues

**Problem**: Dataset/model uploads fail

**Solutions**:
- Check STORAGE_TYPE setting (local vs s3)
- For local storage: verify directories exist and have write permissions
- For S3: verify AWS credentials and bucket permissions
- Check file size limits in nginx/load balancer
- Review backend logs for detailed error messages

### Authentication Issues

**Problem**: Login fails or tokens are invalid

**Solutions**:
- Verify SECRET_KEY is set and consistent
- Check ACCESS_TOKEN_EXPIRE_MINUTES setting
- Clear browser localStorage and try again
- Verify user exists in database: `SELECT * FROM users WHERE email = 'admin@sentinel.com';`
- Check token format: should be JWT with correct signature

### Frontend Build Failures

**Problem**: npm run build fails

**Solutions**:
```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install

# Check for TypeScript errors
npm run type-check

# Verify environment variables are set
echo $VITE_API_BASE_URL

# Check Node version
node --version  # Should be 18+
```

---

## Security Checklist

### Pre-Deployment

- [ ] Change default SECRET_KEY to a strong random value (min 32 characters)
- [ ] Set DEBUG=false in production
- [ ] Update default admin credentials (admin@sentinel.com / admin123)
- [ ] Review CORS_ORIGINS - only include trusted domains
- [ ] Enable HTTPS/TLS for all public endpoints
- [ ] Set strong database passwords
- [ ] Rotate AWS access keys if exposed
- [ ] Review all environment variables for sensitive data
- [ ] Enable database connection encryption
- [ ] Set up database backups

### Runtime Security

- [ ] Implement rate limiting on authentication endpoints
- [ ] Add request size limits to prevent DoS
- [ ] Enable SQL injection protection (SQLAlchemy handles this)
- [ ] Implement CSRF protection for state-changing operations
- [ ] Add audit logging for sensitive operations
- [ ] Use IAM roles instead of access keys where possible (AWS)
- [ ] Enable CloudWatch/monitoring alerts for suspicious activity
- [ ] Implement IP whitelisting for admin endpoints
- [ ] Regular security updates for dependencies
- [ ] Enable automated vulnerability scanning

### Data Protection

- [ ] Encrypt sensitive data at rest (PII, financial data)
- [ ] Enable database encryption (RDS encryption)
- [ ] Use S3 bucket encryption for uploaded files
- [ ] Implement data retention policies
- [ ] Regular backup testing and restoration drills
- [ ] GDPR compliance for EU users (data export/deletion)
- [ ] Secure deletion of user data when requested

---

## Monitoring & Backups

### Application Monitoring

**Backend Health Check**:
Add this endpoint to `app/main.py`:

```python
@app.get("/health")
def health_check():
    return {"status": "healthy", "timestamp": datetime.utcnow()}
```

**Logging**:
```python
# Configure structured logging
import logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
```

**Metrics to Monitor**:
- API response times
- Error rates (4xx, 5xx)
- Database connection pool usage
- CPU and memory usage
- Disk space (for local storage)
- Request throughput

### Database Backups

**PostgreSQL Automated Backups**:

```bash
# Create backup script
cat > backup.sh << 'EOF'
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups"
mkdir -p $BACKUP_DIR

# Backup database
pg_dump -h localhost -U sentinel sentinel > $BACKUP_DIR/sentinel_$DATE.sql

# Compress
gzip $BACKUP_DIR/sentinel_$DATE.sql

# Keep only last 7 days
find $BACKUP_DIR -name "sentinel_*.sql.gz" -mtime +7 -delete

echo "Backup completed: sentinel_$DATE.sql.gz"
EOF

chmod +x backup.sh

# Add to crontab (daily at 2 AM)
crontab -e
0 2 * * * /path/to/backup.sh
```

**RDS Automated Backups**:
- Enable automatic backups (7-35 day retention)
- Configure backup window during low-traffic hours
- Test restoration process monthly

### File Storage Backups

**S3 Versioning**:
```bash
aws s3api put-bucket-versioning \
    --bucket sentinel-datasets \
    --versioning-configuration Status=Enabled
```

**S3 Lifecycle Policies**:
```json
{
  "Rules": [
    {
      "Id": "Archive old versions",
      "Status": "Enabled",
      "NoncurrentVersionTransitions": [
        {
          "NoncurrentDays": 30,
          "StorageClass": "GLACIER"
        }
      ]
    }
  ]
}
```

### Alerting

**Set up alerts for**:
- Database connection failures
- API error rate > 5%
- Disk space > 80%
- High memory usage > 90%
- Failed authentication attempts > 10/min
- Slow queries > 5s

**Tools**:
- AWS CloudWatch (AWS deployments)
- Sentry (error tracking)
- DataDog or New Relic (APM)
- PagerDuty (on-call alerts)

---

## Production Deployment Checklist

### Pre-Launch

- [ ] All environment variables configured
- [ ] Database migrations applied
- [ ] Seed data created (demo client, admin user)
- [ ] HTTPS/SSL certificates configured
- [ ] Domain DNS configured
- [ ] CORS origins set correctly
- [ ] Storage (S3 or local) configured and tested
- [ ] Monitoring and logging enabled
- [ ] Backup strategy implemented
- [ ] Security checklist completed

### Launch

- [ ] Deploy backend
- [ ] Run smoke tests on backend API
- [ ] Deploy frontend
- [ ] Test full user flow (login → create system → upload dataset → train model)
- [ ] Verify file uploads work
- [ ] Check monitoring dashboards
- [ ] Notify team of deployment

### Post-Launch

- [ ] Monitor error rates for 24 hours
- [ ] Review logs for any issues
- [ ] Test performance under load
- [ ] Gather user feedback
- [ ] Document any issues in CHANGELOG.md

---

## Additional Resources

- **FastAPI Docs**: https://fastapi.tiangolo.com
- **SQLAlchemy Docs**: https://docs.sqlalchemy.org
- **Alembic Tutorial**: https://alembic.sqlalchemy.org/en/latest/tutorial.html
- **React 19 Docs**: https://react.dev
- **Vite Docs**: https://vitejs.dev
- **Docker Compose**: https://docs.docker.com/compose/
- **AWS ECS Guide**: https://docs.aws.amazon.com/ecs/
- **Railway Docs**: https://docs.railway.app
- **Vercel Docs**: https://vercel.com/docs

---

## Support

For issues or questions:
- Check the troubleshooting section above
- Review backend logs: `docker-compose logs backend`
- Review frontend console errors in browser DevTools
- Check API documentation at http://localhost:8000/docs

**Common Commands Reference**:

```bash
# Backend
cd backend
source venv/bin/activate  # or venv\Scripts\activate on Windows
uvicorn app.main:app --reload
alembic upgrade head

# Frontend
cd frontend
npm run dev
npm run build

# Docker
docker-compose up -d
docker-compose logs -f backend
docker-compose down

# Database
docker exec -it sentinel-postgres psql -U sentinel -d sentinel
# In psql: \dt  (list tables), \d tablename (describe table)
```
