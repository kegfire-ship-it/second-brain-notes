import hmac
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from core.config import BACKEND_DIR, settings
from routers import ai as ai_router
from routers import auth as auth_router
from routers import categories as categories_router
from routers import mcp as mcp_router
from routers import notes as notes_router
from routers import share as share_router
from services import starter_notes

for name in ("APP_PASSWORD", "SECRET_KEY", "MCP_TOKEN"):
    if not getattr(settings, name):
        raise RuntimeError(f"{name} is not set. Run the installer, or fill in .env.")

FRONTEND_DIST = BACKEND_DIR.parent / "frontend" / "dist"


class MCPAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.url.path.startswith("/mcp"):
            header = request.headers.get("authorization", "")
            if not hmac.compare_digest(header.encode(), f"Bearer {settings.MCP_TOKEN}".encode()):
                # MCP clients parse the body as JSON-RPC even on auth failures.
                return JSONResponse(
                    {"jsonrpc": "2.0", "id": None, "error": {"code": -32001, "message": "Invalid token"}},
                    status_code=401,
                )
        return await call_next(request)


mcp_app = mcp_router.mcp.streamable_http_app()


@asynccontextmanager
async def lifespan(app: FastAPI):
    starter_notes.seed()
    async with mcp_app.router.lifespan_context(mcp_app):
        yield


app = FastAPI(title=settings.PROJECT_NAME, lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(MCPAuthMiddleware)

app.include_router(auth_router.router)
app.include_router(notes_router.router)
app.include_router(categories_router.router)
app.include_router(share_router.router)
app.include_router(ai_router.router)
app.mount("/mcp", mcp_app)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/{path:path}", include_in_schema=False)
def frontend(path: str):
    """Serves the built web app; unknown paths get index.html (client-side routes)."""
    if path.startswith("api/"):
        raise HTTPException(status_code=404)
    root = FRONTEND_DIST.resolve()
    file = (root / path).resolve()
    if path and file.is_file() and file.is_relative_to(root):
        cache = "public, max-age=31536000, immutable" if path.startswith("assets/") else "no-cache"
        return FileResponse(file, headers={"Cache-Control": cache})
    index = root / "index.html"
    if not index.is_file():
        raise HTTPException(status_code=503, detail="Web app is not built yet")
    return FileResponse(index, headers={"Cache-Control": "no-cache"})
