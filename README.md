# Security Interview Demo

Tiny intentionally vulnerable stack for a lightning security review. Bring coffee.

## Quickstart

Backend:

```bash
uvicorn server.main:app --reload
```

Frontend (from `client`):

```bash
npm install
npm run dev
```

Security hardened with HttpOnly & CSP.
