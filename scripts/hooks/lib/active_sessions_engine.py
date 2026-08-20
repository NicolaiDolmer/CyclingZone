#!/usr/bin/env python3
"""Shared engine for the SessionStart/Stop "active sessions" hooks (#3712).

Problem this solves: docs/NOW.md's "Aktiv styring" section has a bolded
line starting with the robot emoji (historically "Working agent", currently
"Aktive sessioner") that is supposed to let one Claude Code session see that
another is already working on this repo (the #559 multi-AI gate). Nothing
ever *set* it at session start -- only a manual close-out step reset it --
so the field read "Ingen aktiv session" all day even with two sessions
running (see issue #3712 for three separate incidents).

Data source: this machine's local Claude Code session registry,
`~/.claude/sessions/<pid>.json`, one file per top-level `claude` process,
written by the harness itself (pid, sessionId, cwd, startedAt, name). This
is a same-machine, best-effort signal -- NOT the full picture
`mcp__ccd_session_mgmt__list_sessions` can see (that tool only exists at the
agent/LLM tool-calling layer; a hook is a plain subprocess with no MCP
access, so it cannot call it). It is still strictly better than the status
quo of a field nobody ever set, and it needs no network/MCP round-trip.

Design choices that matter:

1. The gate (the STOP-and-ask warning) is decoupled from writing the file.
   Detection always runs and always warns when other repo-associated,
   still-alive sessions are found -- that is the actual #559 fix. Writing
   docs/NOW.md is a separate, best-effort, NON-destructive convenience on
   top: it is applied only when the field currently holds either nothing,
   a recognized reset sentinel ("Ingen aktiv session"...), or our own
   previous auto-marker. Anything else is assumed to be curated
   human/orchestrator prose (the field has evolved into a richer status
   note in practice) and is left byte-for-byte untouched -- we must not let
   an automated hook silently clobber it.
2. Our own writes are tagged with `[auto #3712]` so a later `stop` call can
   tell "safe to recompute/clear" apart from "someone else's prose, leave
   it".
3. Parallel sessions are legitimate and common here (night-wave/worktree
   workflows) -- the warning is informational ("here is who else is
   running, confirm this is intended"), not a hard block.
4. Exits 0 always. Any failure degrades to "say nothing, touch nothing".
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import re
import subprocess
import sys
from datetime import datetime

AUTO_TAG = "[auto #3712]"
RESET_SENTINELS = (
    "ingen aktiv session",
    "ingen aktiv bølge-session",
    "ingen aktiv boelge-session",
    "",
)

# NB: no trailing `$` -- `[^\r\n]*` already stops at the first \r or \n it
# meets, which is a strictly tighter bound than `$` (which in MULTILINE
# mode anchors only right before a bare \n or at end-of-string). On a CRLF
# file -- which is exactly what docs/NOW.md is -- the char class hits the
# \r one position before `$`'s required position, so the two combined
# NEVER match a real line and update_now_md() silently no-ops on every
# call. Confirmed empirically against the real docs/NOW.md while fixing
# #3712. Dropping `$` removes the redundant (and here actively harmful)
# anchor; `[^\r\n]*` alone already can't run past the line end.
FIELD_LINE_RE = re.compile(r"^> \*\*\U0001F916[^\r\n]*:\*\*[^\r\n]*", re.MULTILINE)


def home_dir() -> str:
    return os.environ.get("USERPROFILE") or os.environ.get("HOME") or os.path.expanduser("~")


def norm_path(p: str) -> str:
    if not p:
        return ""
    p = p.replace("\\", "/").rstrip("/")
    return p.lower()


def read_registry(sessions_dir: str) -> list[dict]:
    out = []
    for path in glob.glob(os.path.join(sessions_dir, "*.json")):
        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except Exception:
            continue
        if not isinstance(data, dict):
            continue
        pid = data.get("pid")
        if not isinstance(pid, int):
            continue
        out.append(data)
    return out


def is_pid_alive(pid: int) -> bool:
    """Best-effort Windows liveness check via tasklist. Fails OPEN (assumes
    alive) on any error -- overcounting a dead session as live just means an
    unnecessary informational warning; undercounting risks silently missing
    a real concurrent session, which is the exact bug this hook exists to
    fix."""
    try:
        proc = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/NH"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        out = proc.stdout or ""
        return str(pid) in out
    except Exception:
        return True


def own_session_id_from_stdin() -> str:
    try:
        raw = sys.stdin.read()
    except Exception:
        return ""
    if not raw:
        return ""
    try:
        data = json.loads(raw)
    except Exception:
        return ""
    sid = data.get("session_id")
    return sid if isinstance(sid, str) else ""


def repo_matches(cwd: str, repo_root_norm: str, worktrees_root_norm: str) -> bool:
    c = norm_path(cwd)
    if not c:
        return False
    if c == repo_root_norm:
        return True
    if c == worktrees_root_norm or c.startswith(worktrees_root_norm + "/"):
        return True
    return False


def fmt_duration(started_at_ms: int, now_ms: int) -> str:
    mins = max(0, (now_ms - started_at_ms) // 60000)
    if mins < 60:
        return f"{mins}m"
    h, m = divmod(mins, 60)
    return f"{h}t{m}m"


def collect_sessions(repo_root: str, exclude_session_id: str) -> tuple[list[dict], list[dict]]:
    """Returns (all_alive_repo_sessions, others_excluding_self)."""
    sessions_dir = os.path.join(home_dir(), ".claude", "sessions")
    repo_root_norm = norm_path(repo_root)
    worktrees_root_norm = repo_root_norm + "-worktrees"
    now_ms = int(datetime.now().timestamp() * 1000)

    alive = []
    for s in read_registry(sessions_dir):
        if not repo_matches(s.get("cwd", ""), repo_root_norm, worktrees_root_norm):
            continue
        if not is_pid_alive(s["pid"]):
            continue
        entry = {
            "pid": s["pid"],
            "sessionId": s.get("sessionId", ""),
            "name": s.get("name") or f"pid-{s['pid']}",
            "startedAt": s.get("startedAt") or now_ms,
        }
        entry["ageLabel"] = fmt_duration(entry["startedAt"], now_ms)
        alive.append(entry)

    alive.sort(key=lambda e: e["startedAt"])

    if exclude_session_id:
        others = [e for e in alive if e["sessionId"] != exclude_session_id]
    else:
        # No stdin session_id available (degraded mode) -- best-effort
        # self-exclusion: the most-recently-started matching session is
        # overwhelmingly likely to be the one that just invoked this hook.
        others = list(alive)
        if others:
            newest = max(others, key=lambda e: e["startedAt"])
            others = [e for e in others if e is not newest]

    return alive, others


def render_field_value(entries: list[dict], self_session_id: str, cap: int = 6) -> str:
    if not entries:
        return "Ingen aktiv session"
    parts = []
    for e in entries[:cap]:
        tag = " (dig)" if self_session_id and e["sessionId"] == self_session_id else ""
        parts.append(f"{e['name']}{tag} ({e['ageLabel']})")
    extra = len(entries) - cap
    suffix = f" +{extra} flere" if extra > 0 else ""
    return f"{AUTO_TAG} {len(entries)} session(er): " + ", ".join(parts) + suffix


def field_is_ours_or_reset(value: str) -> bool:
    if AUTO_TAG in value:
        return True
    stripped = re.sub(r"[*_`]", "", value).strip().lower()
    return stripped in RESET_SENTINELS


def extract_field_value(line: str) -> str | None:
    m = re.match(r"^> \*\*\U0001F916[^:]*:\*\*\s?(.*)$", line)
    return m.group(1) if m else None


def update_now_md(now_md_path: str, new_value: str) -> str:
    """Replaces ONLY the matched robot-emoji field line's value, preserving
    everything else byte-for-byte (including CRLF). Returns one of:
    "written", "skipped-curated", "skipped-no-marker", "skipped-missing-file".
    Never raises."""
    try:
        if not os.path.isfile(now_md_path):
            return "skipped-missing-file"
        with open(now_md_path, "r", encoding="utf-8", newline="") as fh:
            content = fh.read()
    except Exception:
        return "skipped-missing-file"

    m = FIELD_LINE_RE.search(content)
    if not m:
        return "skipped-no-marker"

    line = m.group(0)
    current_value = extract_field_value(line)
    if current_value is None or not field_is_ours_or_reset(current_value):
        return "skipped-curated"

    label_match = re.match(r"^(> \*\*\U0001F916[^:]*:\*\*)", line)
    label = label_match.group(1) if label_match else "> **\U0001F916 Aktive sessioner:**"
    new_line = f"{label} {new_value}"

    try:
        new_content = content[: m.start()] + new_line + content[m.end():]
        with open(now_md_path, "w", encoding="utf-8", newline="") as fh:
            fh.write(new_content)
        return "written"
    except Exception:
        return "skipped-missing-file"


def build_warning(others: list[dict]) -> str:
    lines = [
        f"MULTI-AI GATE (#559): {len(others)} anden(e) Claude Code-session(er) ser ud til at koere allerede mod dette repo (samme maskine):",
    ]
    for e in others:
        lines.append(f"- {e['name']} (pid {e['pid']}, koert i {e['ageLabel']})")
    lines.append(
        "Per CLAUDE.md Start trin 1: hvis dette IKKE er et tilsigtet parallelt spor "
        "(natboelge/worktree-workflow), STOP og spoerg brugeren foer du fortsaetter. "
        "Signalet er lokalt best-effort (kun denne maskine, kun proces-liveness) -- "
        "ikke den fulde mcp__ccd_session_mgmt__list_sessions-visning."
    )
    return "\\n".join(lines)


def emit(message: str) -> None:
    payload = {"systemMessage": message}
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["start", "stop"], required=True)
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--now-md", default=None)
    args = parser.parse_args()

    try:
        now_md_path = args.now_md or os.path.join(args.repo_root, "docs", "NOW.md")
        self_session_id = own_session_id_from_stdin()
        all_alive, others = collect_sessions(args.repo_root, self_session_id)

        if args.mode == "start":
            value = render_field_value(all_alive, self_session_id)
            update_now_md(now_md_path, value)
            if others:
                emit(build_warning(others))
        else:  # stop
            # 'others' already excludes self; that is exactly "who remains".
            value = render_field_value(others, "")
            update_now_md(now_md_path, value)
    except Exception:
        # Fail silent + safe: never block session start/stop over this.
        pass

    return 0


if __name__ == "__main__":
    sys.exit(main())
