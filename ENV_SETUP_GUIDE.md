# Environment Variables Setup Guide

This guide explains how to configure environment variables for local development, Railway (backend), and Vercel (frontend).

## Key Concept

**The `.env` file is ONLY for local development.** It should NEVER be committed to git.

For production deployments:
- **Railway Backend**: Set environment variables in Railway dashboard
- **Vercel Frontend**: Set environment variables in Vercel dashboard

---

## Local Development Setup

### 1. Backend (.env file)

Location: `backend/.env`

```env
# API Settings
API_V1_STR=/api/v1
PROJECT_NAME=Sentinel Decision Systems
DEBUG=true
ENV=local

# Database (local Docker PostgreSQL)
DATABASE_URL=postgresql://sentinel:sentinel_local@localhost:5432/sentinel

# Security - Generate with: python -c "import secrets; print(secrets.token_urlsafe(32))"
SECRET_KEY=your-generated-random-key-here
ACCESS_TOKEN_EXPIRE_MINUTES=11520

# CORS - Local frontend URLs
CORS_ORIGINS=http://localhost:5173,http://localhost:3000

# Storage - Use local filesystem
STORAGE_TYPE=local
```

**Steps:**
1. Generate a SECRET_KEY:
   ```bash
   python -c "import secrets; print(secrets.token_urlsafe(32))"
   ```
2. Copy the output and paste it as your SECRET_KEY value
3. Save the file

### 2. Frontend (.env file)

Location: `frontend/.env`

```env
VITE_API_BASE_URL=http://localhost:8000/api/v1
```

This tells your frontend to call the local backend server.

---

## Railway Deployment (Backend)

### Setting Environment Variables in Railway

1. Go to your Railway project dashboard
2. Click on your backend service
3. Go to the "Variables" tab
4. Add these environment variables:

```env
# Railway automatically provides DATABASE_URL for PostgreSQL
# You don't need to set it manually if using Railway's PostgreSQL

# API Settings
API_V1_STR=/api/v1
PROJECT_NAME=Sentinel Decision Systems
DEBUG=false
ENV=production

# Security - Generate a NEW random key for production
SECRET_KEY=<generate-new-random-key-for-production>
ACCESS_TOKEN_EXPIRE_MINUTES=11520

# CORS - Your Vercel frontend URL
CORS_ORIGINS=https://your-app.vercel.app

# Storage - Choose one option below:
STORAGE_TYPE=local
# OR use Railway volumes (recommended for Railway)
# OR use S3 (requires AWS credentials below)

# OPTIONAL: If using S3 storage
# AWS_ACCESS_KEY_ID=your-key
# AWS_SECRET_ACCESS_KEY=your-secret
# AWS_REGION=us-east-1
# S3_BUCKET=sentinel-datasets
```

### Important Railway Notes:

1. **Database URL**: If you add a Railway PostgreSQL service, Railway automatically sets `DATABASE_URL` for you. It looks like:
   ```
   postgresql://user:password@host.railway.internal:5432/railway
   ```
   You don't need to manually set this.

2. **Storage Options for Railway**:
   - **Option A (Recommended)**: Use Railway's [Volume Storage](https://docs.railway.app/guides/volumes)
     - Set `STORAGE_TYPE=local`
     - Mount a volume to persist uploaded files

   - **Option B**: Use AWS S3
     - Set `STORAGE_TYPE=s3`
     - Add AWS credentials as environment variables

   - **Option C**: Use basic local storage (files lost on restart)
     - Set `STORAGE_TYPE=local`
     - No persistence across deployments

3. **CORS**: After deploying frontend to Vercel, update `CORS_ORIGINS` to include your Vercel URL

### Railway Volume Setup (Optional but Recommended)

If using local storage on Railway, set up a volume:

1. In Railway dashboard, go to your service
2. Click "Settings" → "Volumes"
3. Click "New Volume"
4. Mount path: `/app/local_storage`
5. This persists uploaded datasets and models across deployments

---

## Vercel Deployment (Frontend)

### Setting Environment Variables in Vercel

1. Go to your Vercel project dashboard
2. Go to "Settings" → "Environment Variables"
3. Add this variable:

```env
VITE_API_BASE_URL=https://your-backend.railway.app/api/v1
```

Replace `your-backend.railway.app` with your actual Railway backend URL.

### Getting Your Railway Backend URL

1. Go to your Railway project
2. Click on your backend service
3. Go to "Settings" → "Networking"
4. Copy the "Public Domain" URL (e.g., `https://sentinel-backend-production-xxxx.up.railway.app`)
5. Add `/api/v1` to the end

Example:
```
https://sentinel-backend-production-xxxx.up.railway.app/api/v1
```

### After Setting Environment Variables

1. Vercel will automatically redeploy
2. Your frontend will now call your Railway backend
3. **Important**: Go back to Railway and update `CORS_ORIGINS` to include your Vercel URL

---

## Configuration Matrix

| Variable | Local | Railway | Vercel |
|----------|-------|---------|--------|
| `DATABASE_URL` | `postgresql://sentinel:sentinel_local@localhost:5432/sentinel` | Auto-set by Railway | N/A |
| `SECRET_KEY` | Any random string | Generate new secure key | N/A |
| `DEBUG` | `true` | `false` | N/A |
| `ENV` | `local` | `production` | N/A |
| `CORS_ORIGINS` | `http://localhost:5173` | `https://your-app.vercel.app` | N/A |
| `STORAGE_TYPE` | `local` | `local` (with volume) or `s3` | N/A |
| `VITE_API_BASE_URL` | `http://localhost:8000/api/v1` | N/A | `https://your-backend.railway.app/api/v1` |

---

## Common Issues and Solutions

### Issue: Frontend can't connect to backend

**Symptoms**: CORS errors in browser console, API requests failing

**Solution**:
1. Check `VITE_API_BASE_URL` in Vercel matches your Railway backend URL
2. Check `CORS_ORIGINS` in Railway includes your Vercel frontend URL
3. Ensure Railway backend is running (check logs)
4. Test backend directly: `curl https://your-backend.railway.app/api/v1/health`

### Issue: Database connection failed on Railway

**Symptoms**: Backend crashes on startup with database connection error

**Solution**:
1. Ensure you've added a PostgreSQL database in Railway
2. Check that Railway has set the `DATABASE_URL` variable automatically
3. If you manually set `DATABASE_URL`, ensure it matches the format: `postgresql://user:pass@host:5432/db`
4. Check Railway logs for specific error messages

### Issue: Files not persisting on Railway

**Symptoms**: Uploaded datasets disappear after redeployment

**Solution**:
1. Set up a Railway Volume mounted at `/app/local_storage`
2. OR switch to S3 storage by setting `STORAGE_TYPE=s3` and adding AWS credentials

### Issue: Token/authentication errors

**Symptoms**: Login fails, "Invalid token" errors

**Solution**:
1. Ensure `SECRET_KEY` is set in Railway (not just in local .env)
2. Generate a strong random key for production
3. Don't reuse your local `SECRET_KEY` in production
4. Clear browser localStorage and try logging in again

---

## Security Checklist

Before deploying to production:

- [ ] Generate a new, secure `SECRET_KEY` for Railway (don't reuse local key)
- [ ] Set `DEBUG=false` in Railway
- [ ] Set `ENV=production` in Railway
- [ ] Update `CORS_ORIGINS` in Railway to only include your Vercel domain (no wildcards)
- [ ] Ensure `.env` files are in `.gitignore` and not committed to git
- [ ] Use strong database passwords (Railway handles this automatically)
- [ ] Enable HTTPS (Railway and Vercel do this automatically)
- [ ] Review all environment variables before going live

---

## Quick Reference Commands

### Generate SECRET_KEY
```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

### Test Railway Backend
```bash
curl https://your-backend.railway.app/api/v1/health
```

### View Railway Logs
```bash
railway logs
# Or use the Railway dashboard → Deployments → View Logs
```

### View Vercel Logs
```bash
vercel logs
# Or use the Vercel dashboard → Deployments → View Function Logs
```

---

## Additional Resources

- [Railway Docs - Environment Variables](https://docs.railway.app/guides/variables)
- [Railway Docs - Volumes](https://docs.railway.app/guides/volumes)
- [Vercel Docs - Environment Variables](https://vercel.com/docs/projects/environment-variables)
- [FastAPI CORS Documentation](https://fastapi.tiangolo.com/tutorial/cors/)
