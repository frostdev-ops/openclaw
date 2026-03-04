#!/usr/bin/env python3
"""Build script for OpenClaw Node Client.

Usage:
  python3 build.py                        # AppImage (default)
  python3 build.py appimage               # AppImage
  python3 build.py rpm                    # RPM
  python3 build.py appimage rpm           # multiple Linux bundles
  python3 build.py windows                # Windows NSIS installer (cross-compiled)
  python3 build.py appimage --bundle-cli  # AppImage with bundled CLI code
  python3 build.py windows --bundle-cli   # Windows installer with bundled CLI code

Linux notes:
  NO_STRIP=1 is always set for Linux bundles.  The bundled `strip` inside
  linuxdeploy's AppImage is too old to handle .relr.dyn ELF sections produced
  by modern Arch Linux toolchains, causing the bundle step to fail.

Windows notes:
  Targets x86_64-pc-windows-gnu (MinGW cross-compiler).  MSVC is Windows-only.
  Signing is skipped on Linux hosts; pass a custom sign_command in tauri.conf.json
  if you need signed installers.

Bundle-cli notes:
  Builds the OpenClaw CLI from the repo root and stages the compiled JS code
  + production deps into src-tauri/resources/openclaw/ so the Tauri app can
  launch the node client with system Node.js.  Without --bundle-cli the
  placeholder .keep file is left as-is and the app uses PATH discovery to
  find a globally-installed `openclaw` binary.
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent.resolve()
REPO_ROOT = SCRIPT_DIR.parent.parent
BUNDLE_DIR = SCRIPT_DIR / "src-tauri" / "target"
RESOURCES_DIR = SCRIPT_DIR / "src-tauri" / "resources"

WINDOWS_TARGET = "x86_64-pc-windows-gnu"
WINDOWS_BUNDLE_SUFFIX = {".exe"}
LINUX_BUNDLE_SUFFIX = {".AppImage", ".rpm", ".deb"}

LINUX_BUNDLES = {"appimage", "rpm", "deb"}


def run(cmd: list, **kwargs) -> subprocess.CompletedProcess:
    print("+", " ".join(str(c) for c in cmd))
    result = subprocess.run(cmd, **kwargs)
    if result.returncode != 0:
        sys.exit(result.returncode)
    return result


def ensure_windows_target() -> None:
    result = subprocess.run(
        ["rustup", "target", "list", "--installed"],
        capture_output=True,
        text=True,
    )
    if WINDOWS_TARGET not in result.stdout:
        print(f"Installing Rust target {WINDOWS_TARGET}...")
        run(["rustup", "target", "add", WINDOWS_TARGET])


def bundle_cli(platform: str) -> None:
    """Build the CLI and stage JS code + prod deps into src-tauri/resources/."""
    print(f"\n=== Bundling CLI for {platform} ===")

    openclaw_dest = RESOURCES_DIR / "openclaw"

    # 1. Build the CLI from repo root
    print("\nBuilding CLI (pnpm build) ...")
    run(["pnpm", "build"], cwd=REPO_ROOT)

    # 2. Stage CLI files into resources/openclaw/
    print(f"\nStaging CLI files to {openclaw_dest} ...")
    openclaw_dest.mkdir(parents=True, exist_ok=True)

    to_copy = [
        ("openclaw.mjs", "openclaw.mjs"),
        ("dist", "dist"),
        ("extensions", "extensions"),
        ("skills", "skills"),
        ("assets", "assets"),
        ("package.json", "package.json"),
    ]
    for src_name, dst_name in to_copy:
        src = REPO_ROOT / src_name
        dst = openclaw_dest / dst_name
        if not src.exists():
            print(f"  Skipping {src_name} (not found)")
            continue
        if dst.exists():
            if dst.is_dir():
                shutil.rmtree(dst)
            else:
                dst.unlink()
        if src.is_dir():
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)
        print(f"  Copied {src_name}")

    # 3. Install production deps
    print("\nInstalling production deps (npm install --omit=dev) ...")
    run(["npm", "install", "--omit=dev"], cwd=openclaw_dest)

    # 4. Clean node_modules: remove build artifacts, cross-platform native
    #    binaries, and optional heavy packages not needed by the node client.
    #    linuxdeploy scans every ELF in the AppDir and fails on foreign-arch
    #    .node files or .o object files with missing deps.
    print("\nCleaning node_modules for bundling ...")
    nm = openclaw_dest / "node_modules"

    # Remove optional heavy native packages the node client doesn't need
    for pkg in ["@node-llama-cpp"]:
        pkg_dir = nm / pkg
        if pkg_dir.is_dir():
            shutil.rmtree(pkg_dir)
            print(f"  Removed optional package {pkg}")

    # Remove platform-variant optional packages (musl, non-target OS/arch).
    # npm installs all optionalDependencies variants; we only need glibc linux-x64
    # (for linux) or win-x64 (for windows).
    foreign_patterns = {
        "linux": ["musl", "darwin", "win32", "arm64", "arm-", "freebsd", "linuxmusl"],
        "windows": ["linux", "darwin", "musl", "arm64", "arm-", "freebsd"],
    }
    markers = foreign_patterns.get(platform, [])
    if markers:
        for scope_dir in [nm] + list(nm.glob("@*")):
            if not scope_dir.is_dir():
                continue
            for child in list(scope_dir.iterdir()):
                if not child.is_dir():
                    continue
                name_lower = child.name.lower()
                if any(m in name_lower for m in markers):
                    shutil.rmtree(child)
                    print(f"  Removed platform package {child.relative_to(nm)}")

    removed = 0
    for p in nm.rglob("*"):
        if not p.is_file():
            continue
        rel = str(p.relative_to(nm))
        # Remove .o object files (build-tmp leftovers from native addons)
        if p.suffix == ".o":
            p.unlink()
            removed += 1
        # Whitelist only target-platform native binaries; remove the rest.
        elif p.suffix == ".node":
            parts = rel.lower()
            platform_markers = [
                "linux", "win32", "win-", "windows", "darwin", "macos",
                "openbsd", "freebsd", "musl", "arm64", "arm-", "armhf",
                "ia32", "aarch64", "s390x", "ppc64", "riscv", "loong",
                "x64", "x86",
            ]
            if not any(m in parts for m in platform_markers):
                continue  # generic .node, keep
            if platform == "linux":
                is_target = ("linux" in parts and "x64" in parts
                             and "musl" not in parts
                             and "arm" not in parts
                             and "riscv" not in parts
                             and "loong" not in parts
                             and "ia32" not in parts)
                if "linux-x64-gnu" in parts or "linux_x64" in parts:
                    is_target = True
            elif platform == "windows":
                is_target = "win" in parts and ("x64" in parts or "x86_64" in parts)
            else:
                is_target = True
            if not is_target:
                p.unlink()
                removed += 1

    # Remove build-tmp directories (native addon build artifacts with absurdly
    # long paths that exceed Windows MAX_PATH and are never needed at runtime).
    for build_tmp in list(nm.rglob("build-tmp*")):
        if build_tmp.is_dir():
            shutil.rmtree(build_tmp)
            removed += 1

    # Remove .deps directories (gyp/cmake build leftovers with host paths baked in)
    for deps_dir in list(nm.rglob(".deps")):
        if deps_dir.is_dir():
            shutil.rmtree(deps_dir)
            removed += 1

    # Prune empty directories
    for d in sorted(nm.rglob("*"), reverse=True):
        if d.is_dir() and not any(d.iterdir()):
            d.rmdir()
    print(f"  Removed {removed} non-target files/dirs")

    (openclaw_dest / ".keep").touch()
    print("\nBundle-cli step complete.")


def build_linux(bundles: list[str]) -> None:
    env = os.environ.copy()
    env["NO_STRIP"] = "1"
    env["APPIMAGE_EXTRACT_AND_RUN"] = "1"
    run(
        ["pnpm", "tauri", "build", "--bundles", *bundles],
        env=env,
        cwd=SCRIPT_DIR,
    )


def clean_stale_resources() -> None:
    """Remove leftover node_modules from resources/openclaw if present.

    When building without --bundle-cli after a previous --bundle-cli run,
    stale Linux native modules can end up in the Windows installer and break
    it (path-too-long, wrong platform binaries, etc.).
    """
    nm = RESOURCES_DIR / "openclaw" / "node_modules"
    if nm.is_dir():
        print(f"\nCleaning stale resources at {nm} ...")
        shutil.rmtree(nm)
        print("  Removed stale node_modules")


def build_windows() -> None:
    ensure_windows_target()
    run(
        ["pnpm", "tauri", "build", "--target", WINDOWS_TARGET],
        cwd=SCRIPT_DIR,
    )


def print_artifacts(suffixes: set[str]) -> None:
    print("\nBuilt bundles:")
    found = False
    for path in sorted(BUNDLE_DIR.rglob("*")):
        if path.is_file() and path.suffix in suffixes and "bundle" in path.parts:
            size_mb = path.stat().st_size / 1_048_576
            print(f"  {path.relative_to(BUNDLE_DIR)}  ({size_mb:.1f} MB)")
            found = True
    if not found:
        print("  (none found)")


def main() -> None:
    args = sys.argv[1:]

    bundle_cli_flag = "--bundle-cli" in args
    # Accept legacy --bundle-node too
    if "--bundle-node" in args:
        bundle_cli_flag = True
    args = [a for a in args if a not in ("--bundle-cli", "--bundle-node")]

    if not args:
        args = ["appimage"]

    if "windows" in args:
        if len(args) > 1:
            print("Error: 'windows' cannot be combined with other bundle targets", file=sys.stderr)
            sys.exit(1)
        if bundle_cli_flag:
            bundle_cli("windows")
        else:
            clean_stale_resources()
        build_windows()
        print_artifacts(WINDOWS_BUNDLE_SUFFIX)
    else:
        invalid = [a for a in args if a not in LINUX_BUNDLES]
        if invalid:
            print(f"Error: unknown bundle(s): {', '.join(invalid)}", file=sys.stderr)
            print(f"Valid values: {', '.join(sorted(LINUX_BUNDLES))}, windows", file=sys.stderr)
            sys.exit(1)
        if bundle_cli_flag:
            bundle_cli("linux")
        else:
            clean_stale_resources()
        build_linux(args)
        print_artifacts(LINUX_BUNDLE_SUFFIX)


if __name__ == "__main__":
    main()
