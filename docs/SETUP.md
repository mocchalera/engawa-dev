# Setup and external services

## Now
The local vertical slice needs only Node.js 22+.

```bash
npm start
npm ci
npm test
```

No framework account, LLM key or media provider is required for this stage.

## Cloud pilot
The separate `remote/worker.ts` entry implements Workers + SQLite Durable Objects with Access JWT verification. See `PILOT.md` for local setup, administrator-managed grants and the external deployment gate. Tests mock only the identity provider/JWKS and asset binding; work and transactions run in workerd SQLite. No live provider account is configured by this implementation.

Do not remove the loopback/public-host guard merely to get a public demo URL.

## Voice / screen sharing
LiveKit is the media candidate. Create a development project only when the authorization vertical slice exists. API secret stays server-side; never commit or paste it into client code.

The intended media rules are:
- default muted / not sharing
- user gesture starts microphone or selected window
- server authorizes the workbench/media scope
- leaving, focus, grant revocation or tenant switch can stop publication
- no recording/transcription/AI by default

## Not needed yet
- vector database
- custom TURN/SFU
- billing provider
- LLM API keys
- R2/object storage
- VR stack
- custom domain
