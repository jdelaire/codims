import argparse
import json
import math
import os
import selectors
import subprocess
import time
import urllib.parse
from dataclasses import dataclass
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parent
DEFAULT_ACTIVE_MINUTES = 5.0
DEFAULT_MAX_AGE_HOURS = 12.0
DEFAULT_APP_SERVER_TIMEOUT = 12.0
APP_SERVER_PAGE_LIMIT = 100
APP_SERVER_MAX_PAGES = 10
INTERACTIVE_SOURCE_KINDS = ["cli", "vscode", "exec", "appServer"]
SUBAGENT_SOURCE_KINDS = [
    "subAgent",
    "subAgentReview",
    "subAgentCompact",
    "subAgentThreadSpawn",
    "subAgentOther",
]
THREAD_SOURCE_KINDS = INTERACTIVE_SOURCE_KINDS + SUBAGENT_SOURCE_KINDS
COMPLETED_TURN_STATUSES = {"completed"}
TERMINAL_TURN_STATUSES = {
    "completed",
    "failed",
    "cancelled",
    "canceled",
    "interrupted",
}
LAST_RESPONSE_SNIPPET_LIMIT = 280
NO_RESPONSE_CAPTURED = "No response captured"


class AppServerError(Exception):
    pass


@dataclass
class RawThread:
    id: str
    title: str
    nickname: str
    role: str
    cwd: str
    updated_at_ms: int
    parent_id: str
    parent_title: str
    completed: bool = False
    terminal: bool = False
    last_response_snippet: str = NO_RESPONSE_CAPTURED


class CodexAppServerClient:
    def __init__(self, codex_bin="codex", timeout=DEFAULT_APP_SERVER_TIMEOUT):
        self.command = [codex_bin, "app-server", "--listen", "stdio://"]
        self.timeout = timeout
        self.process = None
        self.selector = None
        self.next_id = 0
        self.stderr_lines = []

    def __enter__(self):
        try:
            self.process = subprocess.Popen(
                self.command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
            )
        except OSError as error:
            raise AppServerError(str(error)) from error

        self.selector = selectors.DefaultSelector()
        self.selector.register(self.process.stdout, selectors.EVENT_READ, "stdout")
        self.selector.register(self.process.stderr, selectors.EVENT_READ, "stderr")
        self.request(
            "initialize",
            {
                "clientInfo": {
                    "name": "codims",
                    "title": "Codims",
                    "version": "0.1.0",
                },
                "capabilities": {"experimentalApi": True},
            },
        )
        self.notify("initialized", {})
        return self

    def __exit__(self, exc_type, exc, traceback):
        self.close()
        return False

    def close(self):
        if self.selector:
            self.selector.close()
            self.selector = None
        if not self.process:
            return
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
        self.process = None

    def notify(self, method, params):
        self._send({"method": method, "params": params})

    def request(self, method, params=None):
        request_id = self.next_id
        self.next_id += 1
        self._send({"method": method, "id": request_id, "params": params})
        deadline = time.time() + self.timeout

        while time.time() < deadline:
            self._raise_if_exited()
            for key, _ in self.selector.select(timeout=0.1):
                line = key.fileobj.readline()
                if not line:
                    continue
                if key.data == "stderr":
                    self.stderr_lines.append(line.strip())
                    continue
                try:
                    message = json.loads(line)
                except json.JSONDecodeError as error:
                    raise AppServerError(f"invalid app-server JSON: {line.strip()}") from error
                if message.get("id") != request_id:
                    continue
                if "error" in message:
                    error = message["error"]
                    raise AppServerError(error.get("message", str(error)))
                return message.get("result")

        stderr = "\n".join(line for line in self.stderr_lines if line)
        detail = f": {stderr}" if stderr else ""
        raise AppServerError(f"app-server timeout waiting for {method}{detail}")

    def _send(self, message):
        self._raise_if_exited()
        try:
            self.process.stdin.write(json.dumps(message) + "\n")
            self.process.stdin.flush()
        except (BrokenPipeError, OSError) as error:
            raise AppServerError(str(error)) from error

    def _raise_if_exited(self):
        if not self.process:
            raise AppServerError("app-server not running")
        if self.process.poll() is not None:
            stderr = self.process.stderr.read() if self.process.stderr else ""
            raise AppServerError(f"app-server exited with code {self.process.returncode}: {stderr}")


def parse_float(value, default, allow_zero=False):
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default

    if not math.isfinite(parsed):
        return default
    if parsed == 0 and allow_zero:
        return parsed
    if parsed > 0:
        return parsed
    return default


def first_param(params, name):
    value = params.get(name)
    if isinstance(value, (list, tuple)):
        return value[0] if value else None
    return value


def parse_thread_params(params):
    active_minutes = parse_float(
        first_param(params, "activeMinutes"), DEFAULT_ACTIVE_MINUTES
    )
    max_age_hours = parse_float(
        first_param(params, "maxAgeHours"), DEFAULT_MAX_AGE_HOURS, allow_zero=True
    )
    return active_minutes, max_age_hours


def project_from_cwd(cwd):
    project = os.path.basename(cwd.rstrip("/")) if cwd else ""
    return project or "unknown"


def age_seconds(updated_at_ms, now_ms):
    return max(0, int((now_ms - updated_at_ms) / 1000))


def classify_thread(updated_at_ms, now_ms, active_minutes, completed=False, terminal=False):
    if completed:
        return "DONE", "idle"
    if terminal:
        return "RECENT", "idle"
    age = age_seconds(updated_at_ms, now_ms)
    if age <= 60:
        return "ACTIVE", "energetic"
    if age <= active_minutes * 60:
        return "ACTIVE", "working"
    return "RECENT", "idle"


def timestamp_to_ms(value):
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return 0
    if numeric > 10_000_000_000:
        return int(numeric)
    return int(numeric * 1000)


def subagent_source(thread):
    source = thread.get("source")
    if not isinstance(source, dict):
        return None
    subagent = source.get("subAgent")
    return subagent if isinstance(subagent, dict) else None


def thread_spawn_source(thread):
    subagent = subagent_source(thread)
    if not subagent:
        return {}
    spawn = subagent.get("thread_spawn")
    return spawn if isinstance(spawn, dict) else {}


def parent_thread_id(thread):
    parent_id = thread.get("parentThreadId")
    if parent_id:
        return parent_id
    return thread_spawn_source(thread).get("parent_thread_id") or ""


def effective_parent_id(thread):
    return parent_thread_id(thread) or str(thread.get("id") or "")


def app_server_thread_title(thread):
    return str(thread.get("name") or thread.get("preview") or "")


def app_server_thread_nickname(thread):
    nickname = thread.get("agentNickname") or thread_spawn_source(thread).get("agent_nickname")
    if nickname:
        return str(nickname)
    if not subagent_source(thread):
        return app_server_thread_title(thread) or "agent"
    return "agent"


def app_server_thread_role(thread):
    return str(
        thread.get("agentRole")
        or thread_spawn_source(thread).get("agent_role")
        or "thread"
    )


def within_max_age(updated_at_ms, now_ms, max_age_hours):
    if max_age_hours == 0:
        return True
    return age_seconds(updated_at_ms, now_ms) <= max_age_hours * 60 * 60


def thread_list_params(cursor=None):
    params = {
        "limit": APP_SERVER_PAGE_LIMIT,
        "sortKey": "updated_at",
        "sortDirection": "desc",
        "sourceKinds": THREAD_SOURCE_KINDS,
        "archived": False,
        "useStateDbOnly": True,
    }
    if cursor:
        params["cursor"] = cursor
    return params


def fetch_app_server_pages(client, now_ms, max_age_hours):
    threads = []
    cursor = None
    for _ in range(APP_SERVER_MAX_PAGES):
        result = client.request("thread/list", thread_list_params(cursor))
        page = result.get("data", []) if isinstance(result, dict) else []
        threads.extend(page)

        if max_age_hours != 0 and page:
            oldest_ms = min(timestamp_to_ms(thread.get("updatedAt")) for thread in page)
            if not within_max_age(oldest_ms, now_ms, max_age_hours):
                break

        cursor = result.get("nextCursor") if isinstance(result, dict) else None
        if not cursor:
            break
    return threads


def read_parent_title(client, parent_id):
    if not parent_id:
        return ""
    try:
        result = client.request(
            "thread/read", {"threadId": parent_id, "includeTurns": False}
        )
    except AppServerError:
        return ""
    thread = result.get("thread", {}) if isinstance(result, dict) else {}
    return app_server_thread_title(thread)


def turn_status(turn):
    status = turn.get("status") if isinstance(turn, dict) else None
    if isinstance(status, dict):
        return str(status.get("type") or "").lower()
    if status:
        return str(status).lower()
    lifecycle = turn.get("lifecycle") if isinstance(turn, dict) else None
    if isinstance(lifecycle, dict):
        return str(lifecycle.get("status") or lifecycle.get("type") or "").lower()
    return ""


def latest_turn_lifecycle(thread):
    turns = thread.get("turns") or []
    latest_turn = turns[-1] if turns else {}
    status = turn_status(latest_turn)
    completed = status in COMPLETED_TURN_STATUSES
    terminal = status in TERMINAL_TURN_STATUSES
    return completed, terminal


def collapse_text(text):
    return " ".join(str(text or "").split())


def snippet_text(text, limit=LAST_RESPONSE_SNIPPET_LIMIT):
    collapsed = collapse_text(text)
    if not collapsed:
        return NO_RESPONSE_CAPTURED
    if len(collapsed) <= limit:
        return collapsed
    suffix = "..."
    return f"{collapsed[: limit - len(suffix)].rstrip()}{suffix}"


def read_thread_lifecycle(client, thread_id):
    try:
        result = client.request(
            "thread/read", {"threadId": thread_id, "includeTurns": True}
        )
    except (AppServerError, OSError, ValueError):
        return False, False, NO_RESPONSE_CAPTURED

    thread = result.get("thread", {}) if isinstance(result, dict) else {}
    completed, terminal = latest_turn_lifecycle(thread)
    _, last_response = extract_thread_prompt_and_response(thread)
    return completed, terminal, snippet_text(last_response)


def load_app_server_threads(client, now_ms, max_age_hours):
    app_threads = fetch_app_server_pages(client, now_ms, max_age_hours)
    visible = [
        thread
        for thread in app_threads
        if within_max_age(timestamp_to_ms(thread.get("updatedAt")), now_ms, max_age_hours)
    ]

    parent_ids = sorted({parent_thread_id(thread) for thread in visible if parent_thread_id(thread)})
    parent_titles = {parent_id: read_parent_title(client, parent_id) for parent_id in parent_ids}

    raw_threads = []
    for thread in visible:
        thread_id = str(thread.get("id") or "")
        if not thread_id:
            continue
        completed, terminal, last_response_snippet = read_thread_lifecycle(
            client, thread_id
        )
        raw_threads.append(
            RawThread(
                id=str(thread.get("id") or ""),
                title=app_server_thread_title(thread),
                nickname=app_server_thread_nickname(thread),
                role=app_server_thread_role(thread),
                cwd=str(thread.get("cwd") or ""),
                updated_at_ms=timestamp_to_ms(thread.get("updatedAt")),
                parent_id=effective_parent_id(thread),
                parent_title=parent_titles.get(
                    parent_thread_id(thread),
                    app_server_thread_title(thread),
                ),
                completed=completed,
                terminal=terminal,
                last_response_snippet=last_response_snippet,
            )
        )
    return raw_threads


def thread_to_dict(thread, now_ms, active_minutes):
    state, intensity = classify_thread(
        thread.updated_at_ms,
        now_ms,
        active_minutes,
        completed=thread.completed,
        terminal=thread.terminal,
    )
    return {
        "id": thread.id,
        "title": thread.title,
        "nickname": thread.nickname,
        "role": thread.role,
        "cwd": thread.cwd,
        "project": project_from_cwd(thread.cwd),
        "parent_id": thread.parent_id,
        "parent_title": thread.parent_title,
        "updated_at_ms": thread.updated_at_ms,
        "age_seconds": age_seconds(thread.updated_at_ms, now_ms),
        "state": state,
        "intensity": intensity,
        "last_response_snippet": thread.last_response_snippet,
    }


def build_payload(threads, now_ms, active_minutes):
    shaped_threads = [
        thread_to_dict(thread, now_ms, active_minutes) for thread in threads
    ]
    return {
        "source": "codex_app_server",
        "threads": shaped_threads,
        "counts": {
            "active": sum(
                1 for thread in shaped_threads if thread["state"] == "ACTIVE"
            ),
            "visible": len(shaped_threads),
            "projects": len({thread["project"] for thread in shaped_threads}),
        },
        "generated_at_ms": now_ms,
    }


def empty_payload(now_ms, error):
    return {
        "source": "codex_app_server",
        "threads": [],
        "counts": {"active": 0, "visible": 0, "projects": 0},
        "generated_at_ms": now_ms,
        "error": str(error),
    }


def text_from_user_input(content):
    parts = []
    for item in content or []:
        item_type = item.get("type") if isinstance(item, dict) else None
        if item_type == "text":
            parts.append(str(item.get("text") or ""))
        elif item_type == "image":
            parts.append(f"[image] {item.get('url') or ''}".strip())
        elif item_type == "localImage":
            parts.append(f"[local image] {item.get('path') or ''}".strip())
        elif item_type == "skill":
            parts.append(f"[skill] {item.get('name') or item.get('path') or ''}".strip())
        elif item_type == "mention":
            parts.append(f"[mention] {item.get('name') or item.get('path') or ''}".strip())
    return "\n".join(part for part in parts if part)


def item_content_section(item):
    if not isinstance(item, dict):
        return None

    item_type = item.get("type")
    if item_type == "userMessage":
        text = text_from_user_input(item.get("content"))
        label = "User"
    elif item_type == "agentMessage":
        text = str(item.get("text") or "")
        label = "Agent"
    elif item_type == "plan":
        text = str(item.get("text") or "")
        label = "Plan"
    elif item_type == "reasoning":
        text = "\n".join(item.get("summary") or item.get("content") or [])
        label = "Reasoning"
    elif item_type == "commandExecution":
        command = str(item.get("command") or "")
        output = str(item.get("aggregatedOutput") or "")
        text = "\n".join(part for part in [f"$ {command}" if command else "", output] if part)
        label = "Command"
    elif item_type == "collabAgentToolCall":
        text = str(item.get("prompt") or "")
        label = "Subagent Prompt"
    else:
        return None

    if not text:
        return None
    return f"{label}\n{text}"


def extract_thread_prompt_and_response(thread):
    agent_prompt = ""
    last_agent_text = ""
    for turn in thread.get("turns") or []:
        for item in turn.get("items") or []:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "userMessage" and not agent_prompt:
                agent_prompt = text_from_user_input(item.get("content"))
            elif item.get("type") == "agentMessage":
                text = str(item.get("text") or "")
                if text:
                    last_agent_text = text
    return agent_prompt, last_agent_text


def extract_thread_content(thread):
    agent_prompt, last_response = extract_thread_prompt_and_response(thread)
    sections = []
    if agent_prompt:
        sections.append(f"Agent prompt\n{agent_prompt}")
    if last_response:
        sections.append(f"Last response\n{last_response}")
    return "\n\n".join(sections)


def thread_detail_to_dict(thread, now_ms):
    updated_at_ms = timestamp_to_ms(thread.get("updatedAt"))
    agent_prompt, last_response = extract_thread_prompt_and_response(thread)
    return {
        "id": str(thread.get("id") or ""),
        "title": app_server_thread_title(thread),
        "nickname": app_server_thread_nickname(thread),
        "role": app_server_thread_role(thread),
        "cwd": str(thread.get("cwd") or ""),
        "project": project_from_cwd(str(thread.get("cwd") or "")),
        "parent_id": effective_parent_id(thread),
        "updated_at_ms": updated_at_ms,
        "age_seconds": age_seconds(updated_at_ms, now_ms),
        "turn_count": len(thread.get("turns") or []),
        "agent_prompt": agent_prompt,
        "last_response": last_response,
        "content": extract_thread_content(thread),
    }


def empty_thread_detail_payload(now_ms, error):
    return {
        "source": "codex_app_server",
        "thread": None,
        "generated_at_ms": now_ms,
        "error": str(error),
    }


def get_thread_detail_payload(thread_id, client_factory=None, now_ms=None):
    if now_ms is None:
        now_ms = int(time.time() * 1000)
    if client_factory is None:
        client_factory = default_client_factory()

    try:
        with client_factory() as client:
            result = client.request(
                "thread/read", {"threadId": thread_id, "includeTurns": True}
            )
    except (AppServerError, OSError, ValueError) as error:
        return empty_thread_detail_payload(now_ms, error)

    thread = result.get("thread", {}) if isinstance(result, dict) else {}
    return {
        "source": "codex_app_server",
        "thread": thread_detail_to_dict(thread, now_ms),
        "generated_at_ms": now_ms,
    }


def thread_message_error_payload(thread_id, now_ms, error):
    return {
        "source": "codex_app_server",
        "sent": False,
        "thread_id": thread_id,
        "generated_at_ms": now_ms,
        "error": str(error),
    }


def send_thread_message_payload(
    thread_id,
    message,
    role,
    client_factory=None,
    now_ms=None,
):
    if now_ms is None:
        now_ms = int(time.time() * 1000)

    if role != "thread":
        return thread_message_error_payload(
            thread_id,
            now_ms,
            "message sending is available from role thread only",
        )

    text = str(message or "").strip()
    if not text:
        return thread_message_error_payload(thread_id, now_ms, "message is empty")

    if client_factory is None:
        client_factory = default_client_factory()

    try:
        with client_factory() as client:
            client.request("thread/resume", {"threadId": thread_id})
            result = client.request(
                "turn/start",
                {
                    "threadId": thread_id,
                    "input": [{"type": "text", "text": text}],
                },
            )
    except (AppServerError, OSError, ValueError) as error:
        return thread_message_error_payload(thread_id, now_ms, error)

    return {
        "source": "codex_app_server",
        "sent": True,
        "thread_id": thread_id,
        "generated_at_ms": now_ms,
        "turn": result,
    }


def default_client_factory(codex_bin="codex", timeout=DEFAULT_APP_SERVER_TIMEOUT):
    return lambda: CodexAppServerClient(codex_bin=codex_bin, timeout=timeout)


def get_threads_payload(
    client_factory=None,
    active_minutes=DEFAULT_ACTIVE_MINUTES,
    max_age_hours=DEFAULT_MAX_AGE_HOURS,
    now_ms=None,
):
    if now_ms is None:
        now_ms = int(time.time() * 1000)
    if client_factory is None:
        client_factory = default_client_factory()

    try:
        with client_factory() as client:
            threads = load_app_server_threads(client, now_ms, max_age_hours)
    except (AppServerError, OSError, ValueError) as error:
        return empty_payload(now_ms, error)

    return build_payload(threads, now_ms, active_minutes)


class CodimsRequestHandler(SimpleHTTPRequestHandler):
    static_dir = ROOT_DIR
    client_factory = staticmethod(default_client_factory())

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(self.static_dir), **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/threads":
            self.handle_threads_api(parsed.query)
            return
        if parsed.path.startswith("/api/thread/"):
            thread_id = urllib.parse.unquote(parsed.path.removeprefix("/api/thread/"))
            self.handle_thread_detail_api(thread_id)
            return

        super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/api/thread/") and parsed.path.endswith("/message"):
            thread_id = urllib.parse.unquote(
                parsed.path.removeprefix("/api/thread/").removesuffix("/message")
            )
            self.handle_thread_message_api(thread_id)
            return

        self.send_error(404)

    def handle_threads_api(self, query):
        params = urllib.parse.parse_qs(query)
        active_minutes, max_age_hours = parse_thread_params(params)
        payload = get_threads_payload(
            client_factory=self.client_factory,
            active_minutes=active_minutes,
            max_age_hours=max_age_hours,
        )
        self.send_json(payload)

    def handle_thread_detail_api(self, thread_id):
        payload = get_thread_detail_payload(
            thread_id,
            client_factory=self.client_factory,
        )
        self.send_json(payload)

    def handle_thread_message_api(self, thread_id):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length).decode("utf-8")
            request = json.loads(body or "{}")
        except (UnicodeDecodeError, ValueError, json.JSONDecodeError) as error:
            self.send_json(
                thread_message_error_payload(
                    thread_id,
                    int(time.time() * 1000),
                    f"invalid JSON body: {error}",
                )
            )
            return

        payload = send_thread_message_payload(
            thread_id,
            request.get("message", ""),
            request.get("role", ""),
            client_factory=self.client_factory,
        )
        self.send_json(payload)

    def send_json(self, payload: dict[str, Any]):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def make_handler(static_dir, client_factory=None):
    class ConfiguredCodimsRequestHandler(CodimsRequestHandler):
        pass

    ConfiguredCodimsRequestHandler.static_dir = Path(static_dir).resolve()
    if client_factory is not None:
        ConfiguredCodimsRequestHandler.client_factory = staticmethod(client_factory)
    return ConfiguredCodimsRequestHandler


def parse_args(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--codex-bin", default="codex")
    parser.add_argument(
        "--app-server-timeout",
        type=float,
        default=DEFAULT_APP_SERVER_TIMEOUT,
    )
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    handler = make_handler(
        ROOT_DIR,
        client_factory=default_client_factory(
            codex_bin=args.codex_bin,
            timeout=args.app_server_timeout,
        ),
    )
    httpd = ThreadingHTTPServer((args.host, args.port), handler)

    print(f"Codims running at http://{args.host}:{httpd.server_port}")
    print(f"Reading Codex threads from {args.codex_bin} app-server")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
