---
title: "Windows Companion App"
summary: "System tray app for running OpenClaw node host on Windows"
---

# Windows Companion App

The OpenClaw Windows companion app is a system tray application that manages the
[node host](/cli/node) on Windows. It provides:

- Automatic startup and restart of the node host
- Native approval dialogs for exec commands requiring confirmation
- Configuration UI for gateway connection settings
- Log tailing and connection status visibility

## Installation

Download the latest release from the [OpenClaw releases page](https://github.com/openclaw/openclaw/releases).

Run the installer and launch **OpenClaw Node Client** from the Start menu or system tray.

## Configuration

The app stores its configuration at `~/.openclaw/windows-node-client.json`:

| Field            | Default     | Description                                              |
| ---------------- | ----------- | -------------------------------------------------------- |
| `host`           | `127.0.0.1` | Gateway WebSocket host                                   |
| `port`           | `18789`     | Gateway WebSocket port                                   |
| `tls`            | `false`     | Use TLS for gateway connection                           |
| `tlsFingerprint` |             | Expected TLS certificate fingerprint (sha256)            |
| `nodeId`         |             | Override node ID                                         |
| `displayName`    |             | Override node display name                               |
| `autoStartNode`  | `true`      | Start node host when app opens                           |
| `useExecHost`    | `false`     | Route exec through Windows app (native approval dialogs) |

## Node Pairing

On first connection the node host sends a pair request to the gateway. Approve it:

```bash
openclaw nodes pending
openclaw nodes approve <requestId>
```

The node host stores its identity at `~/.openclaw/node.json`.

## Exec Approvals

When **Use Windows exec host** is enabled, the app intercepts `system.run` commands
and shows a native approval dialog before execution.

Approval decisions:

- **Deny** - command is rejected
- **Allow Once** - command runs once; approval required next time
- **Allow Always** - command is added to the allowlist at `~/.openclaw/exec-approvals.json`

The exec-host socket is registered at `~/.openclaw/exec-approvals.json` under the
`socket` key. The token is regenerated each time the app starts.

See [exec approvals](/tools/exec-approvals) for full policy documentation.

## Startup on Login

Enable **Start on Windows login** in the settings panel to register the app with
the Windows startup mechanism (registry run key via Tauri autostart plugin).

## Troubleshooting

**Named pipe permission error**: Ensure no other process is using `\\.\pipe\openclaw-exec-host`.
Restart the app to regenerate the socket.

**Node host fails to start**: Check that `openclaw` is on your PATH. Install via
`npm install -g openclaw` or add the install directory to your system PATH.

**Gateway connection refused**: Verify the gateway is running and the host/port match
your configuration. Run `openclaw gateway status` on the gateway host.
