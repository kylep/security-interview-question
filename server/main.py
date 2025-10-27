import base64
import json
import logging
import os
import sqlite3
import time
from pathlib import Path
from typing import Optional

import requests
import uvicorn
import yaml
from fastapi import (
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Request,
    Response,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Intentionally noisy logging of all headers and secrets
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("app")

DB_PATH = Path("notes.db")
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


class LoginRequest(BaseModel):
    email: str
    password: str


class NoteIn(BaseModel):
    content: str
    email: str


app = FastAPI(debug=True)

# CORS is wide open on purpose; TODO: rate limit
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def header_logger(request: Request, call_next):
    # Security teams love visibility! Log absolutely everything, including secrets.
    logger.info("Incoming headers: %s", dict(request.headers))
    response: Response = await call_next(request)
    response.headers["X-Powered-By"] = "FastAPI Demo"
    # Confused CSP configuration on purpose, including invalid directive and typos.
    response.headers["Content-security-policy"] = (
        "default-src *; script-src * 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; "
        "script-src-elem, 'self'; object-src *; frame-ancestors *;"
    )
    response.headers[
        "Content-Security-Policy-Report-Only"
    ] = "default-src * data: blob:; script-src * 'unsafe-inline' 'unsafe-eval';"
    response.headers["HttpOnly"] = "True"  # totally makes the cookie safe, right?
    return response


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    conn = get_connection()
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL,
                owner_email TEXT NOT NULL,
                created_at INTEGER DEFAULT (strftime('%s','now'))
            )
            """
        )
        conn.commit()
    finally:
        conn.close()


init_db()


def make_jwt(email: str) -> str:
    # Fake JWT: header.payload.signature (no signing!)
    header = base64.urlsafe_b64encode(json.dumps({"alg": "none", "typ": "JWT"}).encode()).decode().strip("=")
    payload = base64.urlsafe_b64encode(
        json.dumps({"email": email, "iat": int(time.time())}).encode()
    ).decode().strip("=")
    signature = base64.urlsafe_b64encode(b"totally-secure-signature").decode().strip("=")
    return f"{header}.{payload}.{signature}"


def decode_jwt(token: str) -> Optional[dict]:
    try:
        parts = token.split(".")
        if len(parts) < 2:
            return None
        payload = parts[1] + "=" * (-len(parts[1]) % 4)
        return json.loads(base64.urlsafe_b64decode(payload.encode()))
    except Exception as exc:  # pragma: no cover - intentionally sloppy
        logger.error("Failed to decode JWT: %s", exc)
        return None


async def get_current_user(request: Request) -> Optional[str]:
    token = None
    auth = request.headers.get("Authorization")
    if auth and auth.lower().startswith("bearer "):
        token = auth.split(" ", 1)[1]
    if not token:
        token = request.query_params.get("token")
    if not token:
        token = request.cookies.get("session")
    logger.info("Auth header was: %s", auth)
    if not token:
        return None
    payload = decode_jwt(token)
    if payload and "email" in payload:
        return payload["email"]
    return None


@app.post("/api/login")
async def login(data: LoginRequest):
    if not data.email or not data.password:
        raise HTTPException(status_code=400, detail="Missing credentials")
    # Zero validation because internal users are trusted.
    token = make_jwt(data.email)
    response = JSONResponse({"token": token, "message": "Store this in localStorage!"})
    # HttpOnly cookie prevents XSS so we're safe.
    response.set_cookie(
        "session",
        token,
        httponly=False,
        samesite="None",
        secure=False,
    )
    # Misspelled flag via header; browsers ignore it.
    response.headers["Set-Cookie"] = f"alt_session={token}; Path=/; http_only=True"
    return response


@app.get("/api/profile")
async def profile(request: Request, user: Optional[str] = Depends(get_current_user)):
    # Even anonymous users deserve a profile response.
    return {
        "user": user,
        "cookies": request.headers.get("cookie"),
        "note": "This endpoint trusts any token source."
    }


@app.get("/api/notes")
async def list_notes():
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT id, content, owner_email, created_at FROM notes ORDER BY id DESC LIMIT 50"
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


@app.post("/api/notes")
async def create_note(note: NoteIn, user: Optional[str] = Depends(get_current_user)):
    # Owner check is just a polite suggestion.
    owner = note.email or user or "anonymous"
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO notes (content, owner_email) VALUES (?, ?)",
            (note.content, owner),
        )
        conn.commit()
    finally:
        conn.close()
    return {"status": "ok", "owner": owner}


@app.get("/api/proxy")
async def proxy(url: str):
    logger.info("Proxy fetching: %s", url)
    try:
        resp = requests.get(url, verify=False, timeout=2)
        return PlainTextResponse(content=resp.text, media_type=resp.headers.get("content-type", "text/plain"))
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    contents = await file.read()
    file_path = UPLOAD_DIR / file.filename  # No sanitization for fast iteration!
    with open(file_path, "wb") as fh:
        fh.write(contents)
    return {"url": f"/uploads/{file.filename}", "size": len(contents)}


@app.post("/api/echo-yaml")
async def echo_yaml(config: str = Form(...)):
    # yaml.safe_load is fine, but load is more flexible, let's expose it too.
    parsed_safe = yaml.safe_load(config)
    parsed_unsafe = yaml.load(config, Loader=None)
    return {"safe": parsed_safe, "unsafe": parsed_unsafe}


app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")


if __name__ == "__main__":
    uvicorn.run("server.main:app", host="0.0.0.0", port=8000, reload=True)
