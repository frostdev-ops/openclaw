# OpenClaw Node Client

A Tauri v2 desktop application that manages the OpenClaw node process with a modern React UI. Supports **Windows** (NSIS installer) and **Linux** (AppImage).

## Development

```bash
# Install dependencies
cd apps/windows
pnpm install --ignore-workspace

# Start dev server (Vite + Tauri hot-reload)
pnpm tauri:dev

# Build for production
pnpm tauri:build
# Windows output: src-tauri/target/release/bundle/nsis/*.exe
# Linux output:   src-tauri/target/release/bundle/appimage/*.AppImage

# Type check
pnpm typecheck

# Rust check
pnpm check:rust
```

## Linux Runtime Dependencies (for development builds)

```bash
# Debian/Ubuntu
sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev

# Arch Linux
sudo pacman -S webkit2gtk-4.1 libayatana-appindicator
```

## Architecture

- **Frontend**: React 19 + Vite 6 + TypeScript + Framer Motion
- **Backend**: Tauri v2 (Rust)
- **Source**: `src/` (React app), `src-tauri/` (Rust backend)
- **Output**: `dist/` (built frontend, served by Tauri)

## Features

- Dashboard: node status, uptime, gateway URL
- Approvals: exec-host command approval queue with countdown timers
- Logs: color-coded terminal log viewer
- Config: gateway connection settings
- Settings: autostart, exec-host, install location picker
