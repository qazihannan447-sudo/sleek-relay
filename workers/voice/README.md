# Voice Worker Foundation

This worker is intentionally minimal. It exposes only a local HTTP health endpoint and does not yet include:

- Pipecat orchestration
- Browser audio transport
- Provider integrations
- tenant-aware runtime logic
- persistence or tool execution

Start it locally from this directory:

```powershell
python3.11 -m app.server
```

Health check:

```text
http://127.0.0.1:8000/health
```
