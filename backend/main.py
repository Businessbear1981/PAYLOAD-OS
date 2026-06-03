"""FastAPI service skeleton — deploys to Railway out of the box.

Patterns this template follows:
- CORS configured for the Vercel frontend (set FRONTEND_URL env var)
- Supabase JWT verification for protected routes
- LangSmith tracing on agent endpoints (only if LANGSMITH_API_KEY set)
- Health check at GET / (Railway uses this)
"""
import os
from typing import Any

from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="api", version="0.1.0")

# --- CORS --------------------------------------------------------------------
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Health ------------------------------------------------------------------
@app.get("/")
def root() -> dict[str, Any]:
    return {"ok": True, "service": "api"}


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "healthy"}


# --- Supabase JWT auth (minimal) --------------------------------------------
def require_user(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """Verify a Supabase JWT and return the claims. Wire this as a FastAPI
    Depends() on protected routes.

    For full verification fetch the JWKS from
    {SUPABASE_URL}/auth/v1/jwks and verify with PyJWT. This stub assumes
    the token is present; replace with real verification before prod.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    # TODO: verify with PyJWT against Supabase JWKS
    return {"sub": "stub-user"}


# --- Example protected route ------------------------------------------------
@app.get("/me")
def me(user: dict[str, Any] = None) -> dict[str, Any]:  # type: ignore[assignment]
    return {"user": user or {"sub": "anonymous"}}
