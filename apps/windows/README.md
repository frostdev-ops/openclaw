# OpenClaw Windows Node Client (Tauri v2)

Windows tray app that replaces headless `openclaw node` service management.

## Current Scope

- Tauri v2 desktop app scaffold under `apps/windows/`
- System tray controls: start, stop, restart, show, quit
- Manages `openclaw node run` process lifecycle
- Persists gateway/node config to `~/.openclaw/windows-node-client.json`
- Auto-starts node host when app launches (configurable)
- Streams process logs into the app UI

## Planned Next Scope

- Native exec approval prompt flow wired to node-host approval requests
- Rich connection telemetry (paired, connected, reconnecting states)
- Approval history and policy editing UI parity with macOS app

## Run

```bash
cd apps/windows
pnpm install
pnpm tauri:dev
```

## Build

```bash
cd apps/windows
pnpm tauri:build
```
