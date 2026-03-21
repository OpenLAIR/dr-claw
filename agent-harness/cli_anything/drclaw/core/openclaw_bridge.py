"""Utilities for sending Dr. Claw notifications through OpenClaw."""

import hashlib
import json
import subprocess
import time
from typing import Optional, Tuple


def _parse_channel(channel: str) -> Tuple[Optional[str], str]:
    target = channel
    message_channel = None
    if ":" in channel:
        maybe_channel, maybe_target = channel.split(":", 1)
        if maybe_channel and maybe_target:
            message_channel = maybe_channel
            target = maybe_target
    return message_channel, target


def _build_idempotency_key(message_channel: Optional[str], target: str, message_text: str) -> str:
    now_ns = time.time_ns()
    seed = f"{message_channel or 'default'}|{target}|{message_text}|{now_ns}"
    digest = hashlib.sha1(seed.encode("utf-8")).hexdigest()[:16]
    return f"drclaw-{now_ns}-{digest}"


def _run_openclaw_command(cmd: list[str], timeout: int = 30) -> str:
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        stderr = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(stderr or f"Command failed: {' '.join(cmd)}")
    return result.stdout.strip()


def _send_via_gateway(message_text: str, message_channel: str, target: str) -> str:
    params = {
        "channel": message_channel,
        "to": target,
        "message": message_text,
        "idempotencyKey": _build_idempotency_key(message_channel, target, message_text),
    }
    return _run_openclaw_command(
        [
            "openclaw",
            "gateway",
            "call",
            "send",
            "--params",
            json.dumps(params, ensure_ascii=False),
            "--json",
        ]
    )


def _send_via_cli(message_text: str, message_channel: Optional[str], target: str) -> str:
    cmd = ["openclaw", "message", "send", "--target", target, "--message", message_text]
    if message_channel:
        cmd.extend(["--channel", message_channel])
    return _run_openclaw_command(cmd)


def _send_via_agent(prompt_text: str, message_channel: str, target: str, agent: str = "main") -> str:
    return _run_openclaw_command(
        [
            "openclaw",
            "agent",
            "--agent",
            agent,
            "--message",
            prompt_text,
            "--deliver",
            "--reply-channel",
            message_channel,
            "--reply-to",
            target,
            "--json",
        ],
        timeout=90,
    )


def send_openclaw_message(message_text: str, channel: str) -> str:
    message_channel, target = _parse_channel(channel)
    gateway_error = None

    if message_channel:
        try:
            return _send_via_gateway(message_text, message_channel, target)
        except Exception as exc:
            gateway_error = str(exc)

    try:
        return _send_via_cli(message_text, message_channel, target)
    except Exception as exc:
        if gateway_error:
            raise RuntimeError(
                f"OpenClaw gateway send failed: {gateway_error}; direct send failed: {exc}"
            ) from exc
        raise


def send_openclaw_agent_message(prompt_text: str, channel: str, agent: str = "main") -> str:
    message_channel, target = _parse_channel(channel)
    if not message_channel:
        raise ValueError("OpenClaw agent delivery requires a channel prefix such as 'feishu:<chat_id>'.")
    return _send_via_agent(prompt_text, message_channel, target, agent=agent)
