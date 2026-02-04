# Sentinel Decision Systems

A comprehensive ML-powered financial decisioning platform for credit risk assessment, fraud detection, and automated decision management.

## Project Structure

```
sentinel/
├── frontend/          # React + TypeScript console
│   ├── src/
│   │   ├── components/   # Reusable UI components
│   │   ├── pages/        # Page components
│   │   ├── lib/          # Utilities, API client, context
│   │   └── ...
│   └── package.json
│
├── backend/           # Python FastAPI server
│   ├── app/
│   │   ├── api/          # API routes
│   │   ├── core/         # Configuration
│   │   ├── db/           # Database session
│   │   ├── models/       # SQLAlchemy models
│   │   ├── schemas/      # Pydantic schemas
│   │   ├── services/     # Business logic
│   │   └── main.py       # FastAPI app
│   ├── alembic/          # Database migrations
│   ├── tests/
│   └── requirements.txt
│
└── package.json       # Root workspace config
```

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.11+
- PostgreSQL 15+

### Backend Setup

```bash
# Navigate to backend
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Copy environment config
cp .env.example .env
# Edit .env with your database credentials

# Create database
createdb sentinel

# Run migrations (or let the app create tables on startup)
# alembic upgrade head

# Start the server
uvicorn app.main:app --reload --port 8000
```

### Frontend Setup

```bash
# From root directory
npm install

# Start development server
npm run dev

# Or from frontend directory
cd frontend
npm install
npm run dev
```

### Running Both

From the root directory:

```bash
# Terminal 1: Backend
npm run api

# Terminal 2: Frontend
npm run dev
```

## Features

### Decision Systems
- Create isolated workspaces for different decision contexts
- Manage ML models, policies, and deployments per system

### Credit Risk
- Upload and validate training datasets
- Train ML models (XGBoost, LightGBM, etc.)
- Configure approval policies with decile-based thresholds
- A/B testing for policy optimization

### Fraud Management
- Real-time fraud scoring (0-1000 scale)
- Risk-based case queues with SLA targets
- Visual rule builder with simulation
- ML model training and deployment
- Signal provider integration
- Automation settings (auto-assign, auto-decision)

### Exposure Control
- Portfolio-level risk management
- Lending limits by segment
- Real-time utilization tracking

## API Documentation

When the backend is running, visit:
- Swagger UI: http://localhost:8000/api/v1/docs
- ReDoc: http://localhost:8000/api/v1/redoc

## Environment Variables

### Backend (.env)

```
DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/sentinel
SECRET_KEY=your-secret-key
CORS_ORIGINS=["http://localhost:5173"]
DEBUG=true
```

### Frontend (.env)

```
VITE_API_URL=http://localhost:8000/api/v1
```

## Development

### Backend

```bash
# Format code
black app/

# Lint
ruff check app/

# Type check
mypy app/

# Run tests
pytest
```

### Frontend

```bash
cd frontend

# Lint
npm run lint

# Build
npm run build
```

## License

MIT
