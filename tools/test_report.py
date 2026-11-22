#!/usr/bin/env python3
"""Test status pages for `cargo test` runs. Handwritten tool; not generated.

Every run, from any worktree or session, is recorded under one shared folder
and shown at one address:

    http://localhost:8765/                 all runs, newest first
    http://localhost:8765/<worktree>/latest  newest run of one worktree

Commands:

  run     Build the test binaries, then run them, with a live status page.
          Starts the server if it is not running.
            python -B tools/test_report.py run -- --profile test-fast -p intersect-model
  report  Make a page from an existing `cargo test` log.
            python -B tools/test_report.py report path/to/test.log
  serve   Serve the shared folder (port 8765; `run` starts it on demand).

Reports live in $INTERSECT_TEST_REPORTS, default ~/.intersect/test-reports.
Each run folder holds index.html, summary.json, meta.json, test.log and
plan.json. `--baseline SUMMARY_JSON` compares with an earlier run.

Standard library only; reads cargo's human test output (stable toolchain).
"""

from __future__ import annotations

import argparse
import datetime as dt
import html
import http.server
import json
import os
import re
import socket
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import unquote

PORT = 8765
RUNNING = re.compile(r"^\s+Running (.+?) \((.+?)\)\s*$")
DOCTESTS = re.compile(r"^\s+Doc-tests (\S+)\s*$")
TEST_LINE = re.compile(r"^test (.+?) \.\.\. (ok|FAILED|ignored)\b")
SLOW = re.compile(r"^test (.+) has been running for over (\d+) seconds\s*$")
RESULT = re.compile(
    r"^test result: (ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored; "
    r"(\d+) measured; (\d+) filtered out(?:; finished in ([\d.]+)s)?"
)
FAIL_BLOCK = re.compile(r"^---- (.+?) stdout ----\s*$")
CRASH = re.compile(r"process didn't exit successfully: (.*)$")
RERUN = re.compile(r"to rerun pass `-p (\S+)")
EXECUTABLE = re.compile(r"^\s+Executable (.+?) \((.+?)\)\s*$")


# ------------------------------------------------------------------ helpers
def report_root() -> Path:
    env = os.environ.get("INTERSECT_TEST_REPORTS")
    return Path(env) if env else Path.home() / ".intersect" / "test-reports"


def git(*args: str) -> str:
    try:
        return subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return ""


def worktree_info() -> dict:
    top = git("rev-parse", "--show-toplevel")
    return {
        "worktree": Path(top).name if top else Path.cwd().name,
        "path": top or str(Path.cwd()),
        "branch": git("rev-parse", "--abbrev-ref", "HEAD"),
        "commit": git("rev-parse", "--short", "HEAD"),
        "dirty": bool(git("status", "--porcelain", "--untracked-files=no")),
    }


def pid_alive(pid: int | None) -> bool:
    if not pid:
        return False
    if os.name == "nt":
        import ctypes  # Windows: os.kill(pid, 0) would terminate the process.

        handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)  # QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        code = ctypes.c_ulong()
        ok = ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
        ctypes.windll.kernel32.CloseHandle(handle)
        return bool(ok) and code.value == 259  # STILL_ACTIVE
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def exe_key(path: str) -> str:
    return re.split(r"[\\/]", path.strip())[-1].lower()


def package_name(package_id: str) -> str:
    tail = package_id.rsplit("#", 1)[-1]
    if "@" in tail:
        return tail.split("@", 1)[0]
    return package_id.rsplit("#", 1)[0].rstrip("/").rsplit("/", 1)[-1]


def fmt_secs(s: float | None) -> str:
    if s is None:
        return "–"
    s = float(s)
    if s < 60:
        return f"{s:.0f} s"
    m, sec = divmod(int(s), 60)
    return f"{m} min {sec:02d} s" if m < 60 else f"{m // 60} h {m % 60:02d} min"


# ------------------------------------------------------------------ model
@dataclass
class Binary:
    key: str
    target: str
    package: str = "?"
    kind: str = ""
    status: str = "pending"  # pending running pass fail crashed notrun
    passed: int = 0
    failed: int = 0
    ignored: int = 0
    seconds: float | None = None
    tests: dict[str, str] = field(default_factory=dict)
    failures: dict[str, str] = field(default_factory=dict)
    slow: dict[str, int] = field(default_factory=dict)
    note: str = ""
    started: float | None = None


class Run:
    def __init__(self) -> None:
        self.binaries: dict[str, Binary] = {}
        self.order: list[str] = []
        self.current: Binary | None = None
        self.block_test: str | None = None
        self.block_lines: list[str] = []
        self.state = "building"  # building running finished stopped build-failed
        self.build_seconds: float | None = None
        self.crates_built = 0
        self.started = time.time()
        self.test_started: float | None = None
        self.ended: float | None = None
        self.command = ""
        self.info: dict = {}

    def plan(self, key: str, target: str, package: str = "?", kind: str = "") -> None:
        if key not in self.binaries:
            self.binaries[key] = Binary(key, target, package, kind)
            self.order.append(key)

    def _close_block(self) -> None:
        if self.current and self.block_test:
            self.current.failures[self.block_test] = "\n".join(self.block_lines).strip()
        self.block_test, self.block_lines = None, []

    def _start(self, key: str, target: str) -> Binary:
        self._close_block()
        if self.current and self.current.status == "running":
            self.current.status = "crashed"
        self.plan(key, target)
        self.current = self.binaries[key]
        self.current.status = "running"
        self.current.started = time.time()
        return self.current

    def feed(self, line: str) -> None:
        line = line.rstrip("\r\n")
        if m := RUNNING.match(line):
            self._start(exe_key(m.group(2)), m.group(1))
            return
        if m := DOCTESTS.match(line):
            if self.state == "building":
                # Explicit --doc runs have no Cargo --no-run discovery phase.
                self.build_seconds = round(time.time() - self.started, 1)
                self.state, self.test_started = "running", time.time()
            b = self._start(f"doctests:{m.group(1)}", "doc-tests")
            b.package, b.kind = m.group(1).replace("_", "-"), "doctest"
            return
        cur = self.current
        if cur is None:
            return
        if m := RESULT.match(line):
            self._close_block()
            cur.passed, cur.failed, cur.ignored = int(m.group(2)), int(m.group(3)), int(m.group(4))
            cur.seconds = float(m.group(7)) if m.group(7) else None
            cur.status = "pass" if m.group(1) == "ok" else "fail"
        elif m := TEST_LINE.match(line):
            cur.tests[m.group(1)] = {"ok": "pass", "FAILED": "fail"}.get(m.group(2), "ignored")
        elif m := SLOW.match(line):
            cur.slow[m.group(1)] = int(m.group(2))
        elif m := FAIL_BLOCK.match(line):
            self._close_block()
            self.block_test = m.group(1)
        elif self.block_test is not None:
            if line.strip() == "failures:":
                self._close_block()
            elif len(self.block_lines) < 60:
                self.block_lines.append(line)
        elif m := CRASH.match(line):
            if cur.status == "running":
                cur.status = "crashed"
            cur.note = m.group(1)[:300]
        elif m := RERUN.search(line):
            cur.package = m.group(1)

    def finish(self, state: str = "finished") -> None:
        self._close_block()
        if self.current and self.current.status == "running":
            self.current.status = "crashed"
            self.current.note = self.current.note or "no result (killed or hung)"
        for b in self.binaries.values():
            if b.status == "pending":
                b.status = "notrun"  # cargo builds every example but runs only `test = true` ones
        self.state = state
        self.ended = time.time()

    def totals(self) -> dict:
        bs = self.binaries.values()
        return {
            "passed": sum(b.passed for b in bs),
            "failed": sum(b.failed for b in bs),
            "ignored": sum(b.ignored for b in bs),
            "binaries": sum(b.status != "notrun" for b in bs),
            "binaries_built_not_run": sum(b.status == "notrun" for b in bs),
            "binaries_done": sum(b.status in ("pass", "fail", "crashed") for b in bs),
            "binaries_crashed": sum(b.status == "crashed" for b in bs),
            "test_seconds": round(sum(b.seconds or 0 for b in bs), 1),
            "build_seconds": self.build_seconds,
            "crates_built": self.crates_built,
        }

    def summary(self) -> dict:
        tests = []
        for key in self.order:
            b = self.binaries[key]
            tests += [{"package": b.package, "binary": b.target, "test": n, "status": s} for n, s in sorted(b.tests.items())]
            if b.status == "crashed":
                tests.append({"package": b.package, "binary": b.target, "test": "<binary>", "status": "crashed"})
        return {"command": self.command, "state": self.state, "totals": self.totals(), "tests": tests}

    def now_running(self) -> str:
        """Which binary is running and for how long, plus its tests reported slow."""
        b = self.current
        if self.state != "running" or b is None or b.status != "running":
            return ""
        text = f"Now running {b.package} · {b.target} for {fmt_secs(time.time() - (b.started or time.time()))}"
        if b.slow:
            text += f" · {len(b.slow)} test{'s' if len(b.slow) > 1 else ''} over 60 s: " + ", ".join(sorted(b.slow)[:3])
        return text

    def meta(self) -> dict:
        return {
            **self.info, "command": self.command, "state": self.state, "pid": os.getpid(), "now": self.now_running(),
            "started": self.started, "updated": time.time(), "ended": self.ended, "totals": self.totals(),
        }


# Suite binaries that merge former test binaries (2026-11-05): each former binary
# is a module of the same name, so `<binary> <test>` became `<suite> <binary>::<test>`.
MERGED_SUITES = {"all", "legacy", "core", "definitions", "language", "sqlite", "xmi"}


def canonical(t: dict) -> str:
    """Layout-independent test id, so runs before and after the merge compare."""
    kind, _, name = t["binary"].partition(" ")
    if kind == "test" and name in MERGED_SUITES:
        return f"{t['package']} · {t['test']}"
    if kind == "test":
        return f"{t['package']} · {name}::{t['test']}"
    return f"{t['package']} · {t['binary']}::{t['test']}"


def compare(summary: dict, baseline: dict | None) -> dict | None:
    if baseline is None:
        return None
    key = canonical
    bad = ("fail", "crashed")
    now = {key(t): t["status"] for t in summary["tests"]}
    then = {key(t): t["status"] for t in baseline.get("tests", [])}
    return {
        "new": sorted(k for k, s in now.items() if s in bad and then.get(k) not in bad),
        "fixed": sorted(k for k, s in then.items() if s in bad and now.get(k) == "pass"),
        "known": sorted(k for k, s in now.items() if s in bad and then.get(k) in bad),
    }


# ------------------------------------------------------------------ pages
CSS = """
:root{--surface:#fcfcfb;--panel:#f4f3ef;--text:#0b0b0b;--text2:#52514e;--muted:#c3c2b7;--grid:#e1e0d9;
--ring:rgba(11,11,11,.10);--good:#0ca30c;--critical:#d03b3b;--serious:#ec835a;--warning:#fab219;
--goodtext:#006300;--badtext:#b12a2a}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--surface:#1a1a19;--panel:#232321;--text:#f0efec;
--text2:#c3c2b7;--muted:#4a4a46;--grid:#2c2c2a;--ring:rgba(255,255,255,.10);--goodtext:#0ca30c;--badtext:#ef6b6b}}
:root[data-theme="dark"]{--surface:#1a1a19;--panel:#232321;--text:#f0efec;--text2:#c3c2b7;--muted:#4a4a46;
--grid:#2c2c2a;--ring:rgba(255,255,255,.10);--goodtext:#0ca30c;--badtext:#ef6b6b}
*{box-sizing:border-box}body{margin:0;background:var(--surface);color:var(--text);
font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:900px;margin:0 auto;padding:24px 16px 48px}a{color:inherit}
.crumb{font-size:13px;color:var(--text2);margin-bottom:14px}
.verdict{display:flex;align-items:center;gap:12px;font-size:24px;font-weight:650;margin:0}
.icon{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:50%;color:#fff;font-size:16px;flex:none}
.sub{color:var(--text2);font-size:13px;margin:6px 0 0}
.bar{display:flex;gap:2px;height:8px;border-radius:4px;overflow:hidden;margin:16px 0 6px;background:var(--grid)}
.bar span{display:block;height:100%}
.key{display:flex;flex-wrap:wrap;gap:14px;font-size:12px;color:var(--text2)}
.dot{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px}
h2{font-size:15px;margin:28px 0 8px}
details{border-top:1px solid var(--grid);padding:8px 0}details details{border:0;padding:4px 0 4px 18px}
summary{cursor:pointer}summary .n{color:var(--text2);font-weight:400}
pre{white-space:pre-wrap;word-break:break-word;font-size:12px;background:var(--panel);border-radius:6px;padding:8px;margin:6px 0}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--grid);vertical-align:top}
th{color:var(--text2);font-weight:600}td.r,th.r{text-align:right;font-variant-numeric:tabular-nums}
.bad{color:var(--badtext)}.good{color:var(--goodtext)}.muted{color:var(--text2)}
ul{margin:4px 0;padding-left:20px;font-size:13px}
.more{margin-top:28px}.more>summary{font-weight:600}
.scroll{overflow-x:auto}
"""

STATE = {  # icon, css var
    "pass": ("✓", "--good"), "fail": ("✕", "--critical"), "crashed": ("!", "--serious"),
    "running": ("●", "--warning"), "building": ("●", "--warning"), "pending": ("○", "--muted"),
    "stopped": ("■", "--muted"), "build-failed": ("✕", "--critical"),
}


def icon(kind: str) -> str:
    sym, var = STATE[kind]
    return f'<span class="icon" style="background:var({var})" aria-hidden="true">{sym}</span>'


def verdict(state: str, t: dict, elapsed: float) -> tuple[str, str]:
    """(state kind for the icon, one-line verdict)."""
    if state == "building":
        return "building", f"Building… {t['crates_built']} crates compiled · {fmt_secs(elapsed)}"
    if state == "build-failed":
        return "build-failed", "Build failed"
    bad = t["failed"] + t["binaries_crashed"]
    if state == "running":
        msg = f"Running… {t['binaries_done']} of {t['binaries']} test binaries"
        return "running", msg + (f" · {bad} failing so far" if bad else "")
    if state == "stopped":
        return "stopped", f"Stopped · {t['binaries_done']} of {t['binaries']} binaries ran"
    if bad:
        parts = [f"{t['failed']:,} failed"] if t["failed"] else []
        parts += [f"{t['binaries_crashed']} crashed or hung"] if t["binaries_crashed"] else []
        return "fail", " · ".join(parts) + f" · {t['passed']:,} passed"
    return "pass", f"All {t['passed']:,} tests passed"


def page(title: str, body: str, refresh: bool) -> str:
    head = '<meta http-equiv="refresh" content="5">' if refresh else ""
    return (f'<!doctype html><html lang="en"><head><meta charset="utf-8">'
            f'<meta name="viewport" content="width=device-width,initial-scale=1">{head}'
            f"<title>{html.escape(title)}</title><style>{CSS}</style></head><body><main>{body}</main></body></html>")


def render_run(run: Run, diff: dict | None) -> str:
    e = html.escape
    t = run.totals()
    end = run.ended or time.time()
    kind, line = verdict(run.state, t, end - run.started)
    info = run.info
    where = " · ".join(x for x in (info.get("worktree"), info.get("branch"),
                                    (info.get("commit", "") + (" (uncommitted changes)" if info.get("dirty") else "")) or None) if x)
    took = []
    if t["build_seconds"] is not None:
        took.append(f"build {fmt_secs(t['build_seconds'])}")
    if run.test_started:
        took.append(f"tests {fmt_secs(end - run.test_started)}")
    sub = " · ".join(x for x in (where, ", ".join(took)) if x)

    body = [f'<div class="crumb"><a href="/">All runs</a></div>',
            f'<p class="verdict">{icon(kind)}<span>{e(line)}</span></p>',
            f'<p class="sub">{e(sub)}</p>']
    if now := run.now_running():
        body.append(f'<p class="sub"><b>{e(now)}</b></p>')

    if diff is not None and run.state != "building":
        if diff["new"]:
            body.append(f'<p class="sub bad"><b>{len(diff["new"])} new failures</b> since the baseline'
                        f' · {len(diff["known"])} known · {len(diff["fixed"])} fixed</p>')
        else:
            body.append(f'<p class="sub good">No new failures since the baseline'
                        f' · {len(diff["known"])} known · {len(diff["fixed"])} fixed</p>')

    if run.binaries and run.state != "building":
        n = {k: 0 for k in ("pass", "fail", "crashed", "running", "pending")}
        for b in run.binaries.values():
            if b.status in n:
                n[b.status] += 1
        total = max(sum(n.values()), 1)
        body.append('<div class="bar" role="img" aria-label="test binaries by status">' + "".join(
            f'<span style="flex:{n[k] / total};background:var({STATE[k][1]})"></span>' for k in n if n[k]) + "</div>")
        labels = {"pass": "binaries passed", "fail": "binaries failed", "crashed": "crashed or hung",
                  "running": "running", "pending": "waiting"}
        body.append('<div class="key">' + "".join(
            f'<span><span class="dot" style="background:var({STATE[k][1]})"></span>{STATE[k][0]} {n[k]} {labels[k]}</span>'
            for k in n if n[k]) + "</div>")

    # failures: one line per binary, expand for tests, expand again for output
    failing = sorted((b for b in run.binaries.values() if b.status in ("fail", "crashed")),
                     key=lambda b: (b.package, b.target))
    if failing:
        body.append("<h2>Failures</h2>")
        by_pkg: dict[str, list[Binary]] = {}
        for b in failing:
            by_pkg.setdefault(b.package, []).append(b)
        for pkg, bins in sorted(by_pkg.items(), key=lambda kv: -sum(b.failed or 1 for b in kv[1])):
            rows = []
            for b in bins:
                names = sorted(n for n, s in b.tests.items() if s == "fail")
                count = f"{len(names)} failed" if names else "crashed or hung"
                inner = "".join(
                    f"<details><summary>{e(n)}</summary><pre>{e((b.failures.get(n) or 'no output captured')[-4000:])}</pre></details>"
                    for n in names) or f"<pre>{e(b.note or 'no result line')}</pre>"
                rows.append(f'<details><summary>{e(b.target)} <span class="n">({count})</span></summary>{inner}</details>')
            tests = sum(b.failed for b in bins)
            crashed = sum(b.status == "crashed" for b in bins)
            what = ", ".join(x for x in (f"{tests} tests failed" if tests else "", f"{crashed} crashed or hung" if crashed else "") if x)
            body.append(f'<details><summary><b>{e(pkg)}</b> <span class="n">— {what} in {len(bins)} binaries</span></summary>{"".join(rows)}</details>')
    if diff is not None and diff["new"]:
        body.append("<details><summary><b>New failures since the baseline</b></summary><ul>" +
                    "".join(f"<li>{e(x)}</li>" for x in diff["new"][:500]) + "</ul></details>")

    # everything else, folded away
    more = []
    slow = sorted(((b, n, s) for b in run.binaries.values() for n, s in b.slow.items()), key=lambda x: x[0].target)
    if slow:
        more.append("<details><summary>Slow tests <span class='n'>(reported running over 60 s)</span></summary><ul>" +
                    "".join(f"<li>{e(b.package)} · {e(b.target)} · {e(n)}</li>" for b, n, _ in slow) + "</ul></details>")
    pk: dict[str, list] = {}
    for b in run.binaries.values():
        if b.status != "notrun":
            p = pk.setdefault(b.package, [0, 0, 0, 0.0])
            p[0] += b.passed; p[1] += b.failed; p[2] += b.status == "crashed"; p[3] += b.seconds or 0
    if pk:
        more.append("<details><summary>By package</summary><div class=scroll><table><tr><th>Package</th><th class=r>Passed</th>"
                    "<th class=r>Failed</th><th class=r>Crashed</th><th class=r>Test time</th></tr>" + "".join(
                        f"<tr><td>{e(k)}</td><td class=r>{v[0]:,}</td><td class='r {'bad' if v[1] else ''}'>{v[1]:,}</td>"
                        f"<td class=r>{v[2]}</td><td class=r>{fmt_secs(v[3])}</td></tr>"
                        for k, v in sorted(pk.items(), key=lambda kv: -kv[1][3])) + "</table></div></details>")
        slowest = sorted((b for b in run.binaries.values() if b.seconds), key=lambda b: -(b.seconds or 0))[:25]
        more.append("<details><summary>Slowest test binaries</summary><div class=scroll><table><tr><th>Package</th><th>Binary</th>"
                    "<th class=r>Tests</th><th class=r>Time</th></tr>" + "".join(
                        f"<tr><td>{e(b.package)}</td><td>{e(b.target)}</td><td class=r>{b.passed + b.failed + b.ignored}</td>"
                        f"<td class=r>{fmt_secs(b.seconds)}</td></tr>" for b in slowest) + "</table></div></details>")
    if diff is not None:
        for label, keyname in (("Fixed since the baseline", "fixed"), ("Known failures (also failed in the baseline)", "known")):
            more.append(f"<details><summary>{label} <span class='n'>({len(diff[keyname])})</span></summary><ul>" +
                        "".join(f"<li>{e(x)}</li>" for x in diff[keyname][:500]) + "</ul></details>")
    nr = t["binaries_built_not_run"]
    more.append(f"<details><summary>Run information</summary><ul><li>Command: <code>{e(run.command)}</code></li>"
                f"<li>Ignored tests: {t['ignored']}</li><li>Summed test time: {fmt_secs(t['test_seconds'])}</li>"
                f"<li>Built but not run (examples without tests): {nr}</li>"
                f"<li>Files: summary.json, meta.json, test.log, plan.json in this folder</li></ul></details>")
    body.append('<details class="more"><summary>Details</summary>' + "".join(more) + "</details>")
    return page(f"Tests · {info.get('worktree', '')}", "".join(body), run.state in ("building", "running"))


def load_meta(path: Path) -> dict | None:
    try:
        m = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if m.get("state") in ("building", "running") and not pid_alive(m.get("pid")):
        m["state"] = "stopped"
    m["href"] = "/" + path.parent.relative_to(report_root()).as_posix() + "/"
    return m


def render_index() -> str:
    e = html.escape
    runs = [m for p in report_root().glob("*/*/meta.json") if (m := load_meta(p))]
    runs.sort(key=lambda m: (m.get("state") not in ("building", "running"), -m.get("started", 0)))
    rows = []
    for m in runs[:200]:
        t = m.get("totals", {})
        end = m.get("ended") or m.get("updated") or time.time()
        kind, line = verdict(m.get("state", "stopped"), {**{"crates_built": 0, "binaries_done": 0, "binaries": 0,
                                                            "failed": 0, "passed": 0, "binaries_crashed": 0}, **t},
                             end - m.get("started", end))
        when = dt.datetime.fromtimestamp(m.get("started", 0)).strftime("%b %d %H:%M")
        rows.append(f'<tr><td>{icon(kind)}</td><td><a href="{e(m["href"])}">{e(line)}</a>'
                    f'<div class=muted>{e(m.get("command", ""))}</div>'
                    + (f'<div><b>{e(m["now"])}</b></div>' if m.get("now") and m.get("state") == "running" else "")
                    + '</td>'
                    f'<td>{e(m.get("worktree", ""))}<div class=muted>{e(m.get("branch", ""))} {e(m.get("commit", ""))}</div></td>'
                    f'<td class=r>{when}<div class=muted>{fmt_secs(end - m.get("started", end))}</div></td></tr>')
    live = any(m.get("state") in ("building", "running") for m in runs)
    body = ('<p class="verdict">Test runs</p><p class="sub">All worktrees · running first, then newest · '
            f'stored in {e(str(report_root()))}</p>'
            + ("<div class=scroll><table><tr><th></th><th>Result</th><th>Worktree</th><th class=r>Started</th></tr>"
               + "".join(rows) + "</table></div>" if rows else "<p>No runs yet.</p>"))
    return page("Test runs", body, live)


# ------------------------------------------------------------------ server
class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(report_root()), **k)

    def log_message(self, *a) -> None:
        pass

    def _send(self, text: str) -> None:
        data = text.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        path = unquote(self.path.split("?", 1)[0]).strip("/")
        if path in ("", "index.html"):
            return self._send(render_index())
        parts = path.split("/")
        if len(parts) == 2 and parts[1] == "latest":
            runs = sorted((report_root() / parts[0]).glob("*/meta.json"), key=lambda p: p.parent.name)
            if runs:
                self.send_response(302)
                self.send_header("Location", f"/{parts[0]}/{runs[-1].parent.name}/")
                self.end_headers()
                return None
        return super().do_GET()


def port_open() -> bool:
    with socket.socket() as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", PORT)) == 0


def ensure_server() -> None:
    if port_open():
        return
    flags = 0x00000008 | 0x00000200 if os.name == "nt" else 0  # DETACHED_PROCESS | NEW_PROCESS_GROUP
    subprocess.Popen([sys.executable, "-B", str(Path(__file__).resolve()), "serve"], creationflags=flags,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     start_new_session=os.name != "nt")


def cmd_serve(_a) -> int:
    report_root().mkdir(parents=True, exist_ok=True)
    print(f"serving {report_root()} at http://localhost:{PORT}/", flush=True)
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
    return 0


# ------------------------------------------------------------------ io
def write(run: Run, out: Path, baseline: dict | None) -> None:
    out.mkdir(parents=True, exist_ok=True)
    summary = run.summary()
    for name, text in (("index.html", render_run(run, compare(summary, baseline))),
                       ("summary.json", json.dumps(summary, indent=1)),
                       ("meta.json", json.dumps(run.meta(), indent=1))):
        tmp = out / (name + ".tmp")
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, out / name)


def load_plan_json(run: Run, lines) -> None:
    for line in lines:
        if not line.startswith("{"):
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        if msg.get("reason") == "compiler-artifact":
            run.crates_built += 1
            if msg.get("executable"):
                tgt = msg.get("target", {})
                kind = (tgt.get("kind") or [""])[0]
                run.plan(exe_key(msg["executable"]), f"{kind} {tgt.get('name', '')}".strip(),
                         package_name(msg.get("package_id", "?")), kind)


def run_dir(info: dict, out: str | None) -> Path:
    if out:
        return Path(out)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    return report_root() / info["worktree"] / stamp


def load_baseline(path: str | None) -> dict | None:
    return json.loads(Path(path).read_text(encoding="utf-8")) if path else None


def cmd_report(a) -> int:
    run = Run()
    run.info = worktree_info()
    if a.commit:
        run.info.update(commit=a.commit, dirty=False)
    run.command = a.command or f"report of {a.log}"
    if a.plan_json:
        load_plan_json(run, Path(a.plan_json).read_text(encoding="utf-8", errors="replace").splitlines())
    if a.build_log:
        for line in Path(a.build_log).read_text(encoding="utf-8", errors="replace").splitlines():
            if m := EXECUTABLE.match(line):
                run.plan(exe_key(m.group(2)), m.group(1))
    log = Path(a.log)
    for line in log.read_text(encoding="utf-8", errors="replace").splitlines():
        run.feed(line)
    run.build_seconds = a.build_seconds
    end = log.stat().st_mtime
    run.test_started = end - a.test_seconds if a.test_seconds else None
    run.started = (run.test_started or end) - (a.build_seconds or 0)
    run.finish()
    run.ended = end
    out = run_dir(run.info, a.out)
    write(run, out, load_baseline(a.baseline))
    print(out / "index.html")
    return 0


def cmd_run(a) -> int:
    args = a.cargo_args[1:] if a.cargo_args[:1] == ["--"] else a.cargo_args
    build_args = args[:args.index("--")] if "--" in args else args
    run = Run()
    run.info = worktree_info()
    run.command = "cargo test " + " ".join(args)
    out = run_dir(run.info, a.out)
    baseline = load_baseline(a.baseline)
    lock = threading.Lock()
    done = threading.Event()

    def refresher() -> None:
        while not done.wait(3):
            with lock:
                write(run, out, baseline)

    write(run, out, baseline)
    if not a.no_server:
        ensure_server()
    rel = out.relative_to(report_root()).as_posix() if out.is_relative_to(report_root()) else None
    print(f"status: http://localhost:{PORT}/{rel}/" if rel else f"status: {out / 'index.html'}", flush=True)
    threading.Thread(target=refresher, daemon=True).start()

    code = 1
    try:
        if "--doc" not in args:
            build = subprocess.Popen(["cargo", "test", *build_args, "--no-run", "--message-format=json-render-diagnostics"],
                                     stdout=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
            assert build.stdout is not None
            with open(out / "plan.json", "w", encoding="utf-8") as plan:
                for line in build.stdout:
                    plan.write(line)
                    with lock:
                        load_plan_json(run, [line])
            if build.wait() != 0:
                with lock:
                    run.build_seconds = round(time.time() - run.started, 1)
                    run.finish("build-failed")
                return build.returncode
            with lock:
                run.build_seconds = round(time.time() - run.started, 1)
                run.state, run.test_started = "running", time.time()
        with open(out / "test.log", "w", encoding="utf-8") as log:
            proc = subprocess.Popen(["cargo", "test", *args], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    text=True, encoding="utf-8", errors="replace")
            assert proc.stdout is not None
            for line in proc.stdout:
                log.write(line)
                log.flush()
                if not a.quiet:
                    sys.stdout.write(line)
                    sys.stdout.flush()
                with lock:
                    run.feed(line)
            code = proc.wait()
        with lock:
            run.finish("build-failed" if code and run.state == "building" else "finished")
    except KeyboardInterrupt:
        with lock:
            run.finish("stopped")
    finally:
        done.set()
        with lock:
            if run.state in ("building", "running"):
                run.finish("stopped")
            write(run, out, baseline)
    t = run.totals()
    print(f"\n{t['passed']} passed, {t['failed']} failed, {t['binaries_crashed']} crashed; "
          f"http://localhost:{PORT}/{rel}/" if rel else "")
    return code


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="mode", required=True)
    r = sub.add_parser("run", help="build and run cargo test with a live status page")
    r.add_argument("--out", help="run folder (default: shared report folder)")
    r.add_argument("--baseline", help="summary.json of an earlier run to compare with")
    r.add_argument("--quiet", action="store_true", help="do not echo test output")
    r.add_argument("--no-server", action="store_true", help="do not start the status server")
    r.add_argument("cargo_args", nargs=argparse.REMAINDER, help="arguments for cargo test, after --")
    g = sub.add_parser("report", help="make a page from an existing cargo test log")
    g.add_argument("log")
    g.add_argument("--out", help="run folder (default: shared report folder)")
    g.add_argument("--baseline", help="summary.json of an earlier run to compare with")
    g.add_argument("--plan-json", help="output of `cargo test ... --no-run --message-format=json`")
    g.add_argument("--build-log", help="human `cargo test --no-run` log (Executable lines)")
    g.add_argument("--build-seconds", type=float, help="measured build time")
    g.add_argument("--test-seconds", type=float, help="measured test wall time")
    g.add_argument("--command", help="the cargo test command that produced the log")
    g.add_argument("--commit", help="the commit that was tested (default: current HEAD)")
    sub.add_parser("serve", help=f"serve the shared report folder on port {PORT}")
    a = p.parse_args()
    return {"run": cmd_run, "report": cmd_report, "serve": cmd_serve}[a.mode](a)


if __name__ == "__main__":
    sys.exit(main())
