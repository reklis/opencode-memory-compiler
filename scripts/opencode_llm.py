"""OpenCode CLI adapter for LLM-backed knowledge-base tasks."""

from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent


class OpenCodeRunError(RuntimeError):
    """Raised when `opencode run` fails."""


def run_opencode(
    prompt: str,
    *,
    agent: str = "build",
    title: str = "memory compiler",
    timeout: int = 1_800,
) -> str:
    """Run OpenCode with the user's configured/current model and return stdout.

    The prompt is attached as a file to avoid command-line length limits. No
    model is passed here: OpenCode resolves the model from CLI/config/last-used
    state. Permissions are skipped because memory compilation is unattended.
    """
    prompt_file: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            suffix=".md",
            prefix="opencode-memory-prompt-",
            delete=False,
        ) as handle:
            handle.write(prompt)
            prompt_file = Path(handle.name)

        env = os.environ.copy()
        env["OPENCODE_MEMORY_COMPILER"] = "1"

        cmd = [
            "opencode",
            "run",
            "--pure",
            "--dir",
            str(ROOT_DIR),
            "--agent",
            agent,
            "--title",
            title,
            "--dangerously-skip-permissions",
            "--file",
            str(prompt_file),
            "Follow the instructions in the attached prompt file exactly.",
        ]

        result = subprocess.run(
            cmd,
            cwd=str(ROOT_DIR),
            env=env,
            text=True,
            capture_output=True,
            timeout=timeout,
            check=False,
        )

        if result.returncode != 0:
            details = result.stderr.strip() or result.stdout.strip() or "unknown error"
            raise OpenCodeRunError(f"opencode run failed ({result.returncode}): {details}")

        return result.stdout.strip()
    finally:
        if prompt_file is not None:
            prompt_file.unlink(missing_ok=True)
