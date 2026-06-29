import json
import os
import threading
import time
import unittest
import urllib.request

import server


NOW_MS = 100 * 60 * 60 * 1000
NOW_SECONDS = NOW_MS // 1000


def make_thread(
    thread_id,
    updated_seconds,
    *,
    name="",
    preview="",
    nickname=None,
    role=None,
    cwd="/repo/app",
    parent_id="parent",
    source_kind="thread_spawn",
    source=None,
):
    if source is None:
        source = {
            "subAgent": {
                source_kind: {
                    "parent_thread_id": parent_id,
                    "agent_nickname": nickname,
                    "agent_role": role,
                }
            }
        }
    return {
        "id": thread_id,
        "name": name,
        "preview": preview,
        "agentNickname": nickname,
        "agentRole": role,
        "cwd": cwd,
        "updatedAt": updated_seconds,
        "status": {"type": "notLoaded"},
        "source": source,
    }


def make_read_thread(thread_id, *, status=None, agent_text=""):
    turn = {
        "id": f"turn-{thread_id}",
        "items": [],
    }
    if status is not None:
        turn["status"] = status
    if agent_text:
        turn["items"].append(
            {
                "type": "agentMessage",
                "id": f"agent-{thread_id}",
                "text": agent_text,
            }
        )
    return {"thread": {"id": thread_id, "turns": [turn]}}


class FakeAppServerClient:
    def __init__(self, responses=None, error=None):
        self.responses = responses or {}
        self.error = error
        self.calls = []

    def __enter__(self):
        if self.error:
            raise self.error
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def request(self, method, params=None):
        self.calls.append((method, params or {}))
        if method == "thread/read":
            read_key = (
                method,
                (params or {}).get("threadId"),
                (params or {}).get("includeTurns"),
            )
            if read_key in self.responses:
                response = self.responses[read_key]
                if isinstance(response, Exception):
                    raise response
                return response
        key = (method, (params or {}).get("cursor"))
        if key in self.responses:
            response = self.responses[key]
            if isinstance(response, Exception):
                raise response
            return response
        if method in self.responses:
            response = self.responses[method]
            if isinstance(response, Exception):
                raise response
            return response
        raise AssertionError(f"unexpected request {method} {params}")


class ServerThreadPayloadTests(unittest.TestCase):
    def test_payload_reads_app_server_subagents_and_shapes_json(self):
        fake = FakeAppServerClient(
            {
                ("thread/list", None): {
                    "data": [
                        make_thread(
                            "main",
                            NOW_SECONDS - 10,
                            name="Main task",
                            cwd="/repo/app",
                            source="vscode",
                        ),
                        make_thread(
                            "fallback",
                            NOW_SECONDS - 20,
                            preview="Preview fallback",
                            nickname="",
                            role="",
                            cwd="/repo/fallback",
                        ),
                        make_thread(
                            "active",
                            NOW_SECONDS - 60,
                            name="Active child",
                            nickname="Ada",
                            role="worker",
                            cwd="/repo/app",
                        ),
                        make_thread(
                            "recent",
                            NOW_SECONDS - 11 * 60 * 60,
                            name="Recent child",
                            nickname="Grace",
                            role="explorer",
                            cwd="/repo/site",
                        ),
                        make_thread(
                            "old",
                            NOW_SECONDS - 13 * 60 * 60,
                            name="Old child",
                            nickname="Linus",
                            role="worker",
                            cwd="/repo/old",
                        ),
                    ],
                    "nextCursor": None,
                },
                "thread/read": {
                    "thread": {
                        "id": "parent",
                        "name": "Parent task",
                        "preview": "Parent preview",
                    }
                },
            }
        )

        payload = server.get_threads_payload(
            client_factory=lambda: fake,
            active_minutes=5,
            max_age_hours=12,
            now_ms=NOW_MS,
        )

        self.assertEqual(payload["source"], "codex_app_server")
        self.assertEqual(
            [thread["id"] for thread in payload["threads"]],
            ["main", "fallback", "active", "recent"],
        )
        self.assertEqual(payload["counts"], {"active": 3, "visible": 4, "projects": 3})

        main = payload["threads"][0]
        self.assertEqual(main["state"], "ACTIVE")
        self.assertEqual(main["nickname"], "Main task")
        self.assertEqual(main["parent_id"], "main")
        self.assertEqual(main["parent_title"], "Main task")

        active = next(thread for thread in payload["threads"] if thread["id"] == "active")
        self.assertEqual(active["state"], "ACTIVE")
        self.assertEqual(active["intensity"], "energetic")
        self.assertEqual(active["updated_at_ms"], (NOW_SECONDS - 60) * 1000)
        self.assertEqual(active["project"], "app")
        self.assertEqual(active["parent_id"], "parent")
        self.assertEqual(active["parent_title"], "Parent task")

        fallback = next(thread for thread in payload["threads"] if thread["id"] == "fallback")
        self.assertEqual(fallback["title"], "Preview fallback")
        self.assertEqual(fallback["nickname"], "agent")
        self.assertEqual(fallback["role"], "thread")

    def test_app_server_list_request_uses_subagent_filters(self):
        fake = FakeAppServerClient(
            {
                ("thread/list", None): {
                    "data": [
                        make_thread(
                            "active",
                            NOW_SECONDS - 60,
                            name="Active child",
                            nickname="Ada",
                            role="worker",
                        )
                    ],
                    "nextCursor": None,
                },
                "thread/read": {"thread": {"id": "parent", "name": "Parent task"}},
            }
        )

        server.get_threads_payload(
            client_factory=lambda: fake,
            active_minutes=5,
            max_age_hours=12,
            now_ms=NOW_MS,
        )

        list_call = next(call for call in fake.calls if call[0] == "thread/list")
        params = list_call[1]
        self.assertEqual(params["sortKey"], "updated_at")
        self.assertEqual(params["sortDirection"], "desc")
        self.assertFalse(params["archived"])
        self.assertTrue(params["useStateDbOnly"])
        self.assertIn("vscode", params["sourceKinds"])
        self.assertIn("subAgentThreadSpawn", params["sourceKinds"])

    def test_zero_max_age_keeps_old_app_server_threads(self):
        fake = FakeAppServerClient(
            {
                ("thread/list", None): {
                    "data": [
                        make_thread("old", NOW_SECONDS - 13 * 60 * 60, name="Old child")
                    ],
                    "nextCursor": None,
                },
                "thread/read": {"thread": {"id": "parent", "name": "Parent task"}},
            }
        )

        payload = server.get_threads_payload(
            client_factory=lambda: fake,
            active_minutes=5,
            max_age_hours=0,
            now_ms=NOW_MS,
        )

        self.assertEqual([thread["id"] for thread in payload["threads"]], ["old"])

    def test_invalid_query_values_fall_back_to_defaults(self):
        self.assertEqual(
            server.parse_thread_params({"activeMinutes": ["bad"], "maxAgeHours": ["-2"]}),
            (5.0, 12.0),
        )

    def test_age_seconds_returns_truncated_non_negative_int(self):
        self.assertEqual(server.age_seconds(8500, 10000), 1)
        self.assertEqual(server.age_seconds(11000, 10000), 0)

    def test_classify_thread_marks_within_active_minutes_as_working(self):
        self.assertEqual(
            server.classify_thread(NOW_MS - 61_000, NOW_MS, active_minutes=5),
            ("ACTIVE", "working"),
        )

    def test_classify_thread_uses_lifecycle_before_timestamp(self):
        self.assertEqual(
            server.classify_thread(
                NOW_MS - 10_000,
                NOW_MS,
                active_minutes=5,
                completed=True,
                terminal=True,
            ),
            ("DONE", "idle"),
        )
        self.assertEqual(
            server.classify_thread(
                NOW_MS - 10_000,
                NOW_MS,
                active_minutes=5,
                terminal=True,
            ),
            ("RECENT", "idle"),
        )
        self.assertEqual(
            server.classify_thread(NOW_MS - 10_000, NOW_MS, active_minutes=5),
            ("ACTIVE", "energetic"),
        )

    def test_threads_payload_marks_completed_terminal_and_active_lifecycles(self):
        fake = FakeAppServerClient(
            {
                ("thread/list", None): {
                    "data": [
                        make_thread(
                            "done",
                            NOW_SECONDS - 10,
                            name="Done child",
                            nickname="Ada",
                        ),
                        make_thread(
                            "interrupted",
                            NOW_SECONDS - 20,
                            name="Interrupted child",
                            nickname="Grace",
                        ),
                        make_thread(
                            "active",
                            NOW_SECONDS - 30,
                            name="Active child",
                            nickname="Linus",
                        ),
                    ],
                    "nextCursor": None,
                },
                ("thread/read", "parent", False): {
                    "thread": {"id": "parent", "name": "Parent task"}
                },
                ("thread/read", "done", True): make_read_thread(
                    "done",
                    status={"type": "completed"},
                    agent_text="Finished.",
                ),
                ("thread/read", "interrupted", True): make_read_thread(
                    "interrupted",
                    status={"type": "interrupted"},
                    agent_text="Stopped.",
                ),
                ("thread/read", "active", True): make_read_thread(
                    "active",
                    status={"type": "running"},
                    agent_text="Still working.",
                ),
            }
        )

        payload = server.get_threads_payload(
            client_factory=lambda: fake,
            active_minutes=5,
            max_age_hours=12,
            now_ms=NOW_MS,
        )

        by_id = {thread["id"]: thread for thread in payload["threads"]}
        self.assertEqual(by_id["done"]["state"], "DONE")
        self.assertEqual(by_id["done"]["intensity"], "idle")
        self.assertEqual(by_id["interrupted"]["state"], "RECENT")
        self.assertEqual(by_id["interrupted"]["intensity"], "idle")
        self.assertEqual(by_id["active"]["state"], "ACTIVE")
        self.assertEqual(by_id["active"]["intensity"], "energetic")
        self.assertEqual(payload["counts"]["active"], 1)

    def test_threads_payload_includes_bounded_last_response_snippet(self):
        long_response = "word\n" * 100
        fake = FakeAppServerClient(
            {
                ("thread/list", None): {
                    "data": [
                        make_thread("collapsed", NOW_SECONDS - 60, name="Collapsed"),
                        make_thread("long", NOW_SECONDS - 60, name="Long"),
                        make_thread("missing", NOW_SECONDS - 60, name="Missing"),
                        make_thread("error", NOW_SECONDS - 60, name="Error"),
                    ],
                    "nextCursor": None,
                },
                ("thread/read", "parent", False): {
                    "thread": {"id": "parent", "name": "Parent task"}
                },
                ("thread/read", "collapsed", True): make_read_thread(
                    "collapsed",
                    agent_text="Finished\n\nwith   extra\tspace.",
                ),
                ("thread/read", "long", True): make_read_thread(
                    "long",
                    agent_text=long_response,
                ),
                ("thread/read", "missing", True): make_read_thread("missing"),
                ("thread/read", "error", True): server.AppServerError("boom"),
            }
        )

        payload = server.get_threads_payload(
            client_factory=lambda: fake,
            active_minutes=5,
            max_age_hours=12,
            now_ms=NOW_MS,
        )

        by_id = {thread["id"]: thread for thread in payload["threads"]}
        self.assertEqual(
            by_id["collapsed"]["last_response_snippet"],
            "Finished with extra space.",
        )
        self.assertLessEqual(
            len(by_id["long"]["last_response_snippet"]),
            server.LAST_RESPONSE_SNIPPET_LIMIT,
        )
        self.assertTrue(by_id["long"]["last_response_snippet"].endswith("..."))
        self.assertNotIn("\n", by_id["long"]["last_response_snippet"])
        self.assertEqual(
            by_id["missing"]["last_response_snippet"],
            server.NO_RESPONSE_CAPTURED,
        )
        self.assertEqual(
            by_id["error"]["last_response_snippet"],
            server.NO_RESPONSE_CAPTURED,
        )

    def test_app_server_error_returns_empty_payload_with_error(self):
        payload = server.get_threads_payload(
            client_factory=lambda: FakeAppServerClient(error=server.AppServerError("boom")),
            now_ms=NOW_MS,
        )

        self.assertEqual(payload["threads"], [])
        self.assertEqual(payload["counts"], {"active": 0, "visible": 0, "projects": 0})
        self.assertEqual(payload["source"], "codex_app_server")
        self.assertIn("boom", payload["error"])

    def test_thread_detail_reads_turns_and_extracts_content(self):
        fake = FakeAppServerClient(
            {
                "thread/read": {
                    "thread": {
                        "id": "active",
                        "name": "Active child",
                        "preview": "Preview text",
                        "agentNickname": "Ada",
                        "agentRole": "worker",
                        "cwd": "/repo/app",
                        "updatedAt": NOW_SECONDS - 60,
                        "source": {
                            "subAgent": {
                                "thread_spawn": {
                                    "parent_thread_id": "parent",
                                    "agent_nickname": "Ada",
                                    "agent_role": "worker",
                                }
                            }
                        },
                        "turns": [
                            {
                                "id": "turn-1",
                                "items": [
                                    {
                                        "type": "userMessage",
                                        "id": "user-1",
                                        "content": [
                                            {
                                                "type": "text",
                                                "text": "Build the room renderer.",
                                                "text_elements": [],
                                            }
                                        ],
                                    },
                                    {
                                        "type": "agentMessage",
                                        "id": "agent-1",
                                        "text": "First response.",
                                    },
                                    {
                                        "type": "plan",
                                        "id": "plan-1",
                                        "text": "1. Add rooms\n2. Verify scene",
                                    },
                                    {
                                        "type": "agentMessage",
                                        "id": "agent-2",
                                        "text": "Implemented room renderer.",
                                    },
                                ],
                            }
                        ],
                    }
                }
            }
        )

        payload = server.get_thread_detail_payload(
            "active",
            client_factory=lambda: fake,
            now_ms=NOW_MS,
        )

        self.assertEqual(payload["source"], "codex_app_server")
        thread = payload["thread"]
        self.assertEqual(thread["id"], "active")
        self.assertEqual(thread["title"], "Active child")
        self.assertEqual(thread["nickname"], "Ada")
        self.assertEqual(thread["role"], "worker")
        self.assertEqual(thread["parent_id"], "parent")
        self.assertEqual(thread["turn_count"], 1)
        self.assertEqual(thread["agent_prompt"], "Build the room renderer.")
        self.assertEqual(thread["last_response"], "Implemented room renderer.")
        self.assertEqual(
            thread["content"],
            "Agent prompt\nBuild the room renderer.\n\nLast response\nImplemented room renderer.",
        )

        read_call = fake.calls[0]
        self.assertEqual(read_call[0], "thread/read")
        self.assertEqual(read_call[1]["threadId"], "active")
        self.assertTrue(read_call[1]["includeTurns"])

    def test_thread_detail_error_returns_empty_payload_with_error(self):
        payload = server.get_thread_detail_payload(
            "missing",
            client_factory=lambda: FakeAppServerClient(error=server.AppServerError("boom")),
            now_ms=NOW_MS,
        )

        self.assertEqual(payload["source"], "codex_app_server")
        self.assertIsNone(payload["thread"])
        self.assertIn("boom", payload["error"])

    def test_send_thread_message_resumes_and_starts_role_thread(self):
        fake = FakeAppServerClient(
            {
                "thread/resume": {"thread": {"id": "main"}},
                "turn/start": {"turn": {"id": "turn-2"}},
            }
        )

        payload = server.send_thread_message_payload(
            "main",
            "  Ship it  ",
            "thread",
            client_factory=lambda: fake,
            now_ms=NOW_MS,
        )

        self.assertTrue(payload["sent"])
        self.assertEqual(payload["thread_id"], "main")
        self.assertEqual(
            fake.calls,
            [
                ("thread/resume", {"threadId": "main"}),
                (
                    "turn/start",
                    {
                        "threadId": "main",
                        "input": [{"type": "text", "text": "Ship it"}],
                    },
                ),
            ],
        )

    def test_send_thread_message_refuses_child_agent_role(self):
        fake = FakeAppServerClient()

        payload = server.send_thread_message_payload(
            "child",
            "Ship it",
            "worker",
            client_factory=lambda: fake,
            now_ms=NOW_MS,
        )

        self.assertFalse(payload["sent"])
        self.assertIn("role thread only", payload["error"])
        self.assertEqual(fake.calls, [])

    def test_send_thread_message_refuses_empty_message(self):
        fake = FakeAppServerClient()

        payload = server.send_thread_message_payload(
            "main",
            "   ",
            "thread",
            client_factory=lambda: fake,
            now_ms=NOW_MS,
        )

        self.assertFalse(payload["sent"])
        self.assertIn("empty", payload["error"])
        self.assertEqual(fake.calls, [])


class HttpHandlerTests(unittest.TestCase):
    def setUp(self):
        self.fake = FakeAppServerClient(
            {
                ("thread/list", None): {
                    "data": [
                        make_thread(
                            "active",
                            int(time.time()) - 60,
                            name="Active child",
                            nickname="Ada",
                            role="worker",
                        )
                    ],
                    "nextCursor": None,
                },
                "thread/read": {"thread": {"id": "parent", "name": "Parent task"}},
            }
        )
        handler = server.make_handler(
            static_dir=os.getcwd(),
            client_factory=lambda: self.fake,
        )
        self.httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.httpd.server_port}"

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join()

    def test_threads_api_returns_json_payload(self):
        url = f"{self.base_url}/api/threads?activeMinutes=5&maxAgeHours=12"

        with urllib.request.urlopen(url) as response:
            self.assertEqual(
                response.headers["Content-Type"],
                "application/json; charset=utf-8",
            )
            payload = json.loads(response.read().decode("utf-8"))

        self.assertEqual(payload["source"], "codex_app_server")
        self.assertEqual(payload["counts"]["visible"], 1)
        self.assertEqual(payload["threads"][0]["id"], "active")

    def test_thread_detail_api_returns_json_payload(self):
        self.fake.responses["thread/read"] = {
            "thread": {
                "id": "active",
                "name": "Active child",
                "preview": "Preview text",
                "agentNickname": "Ada",
                "agentRole": "worker",
                "cwd": "/repo/app",
                "updatedAt": int(time.time()) - 60,
                "source": {
                    "subAgent": {
                        "thread_spawn": {
                            "parent_thread_id": "parent",
                            "agent_nickname": "Ada",
                            "agent_role": "worker",
                        }
                    }
                },
                "turns": [
                    {
                        "id": "turn-1",
                        "items": [
                            {
                                "type": "userMessage",
                                "id": "user-1",
                                "content": [
                                    {
                                        "type": "text",
                                        "text": "Inspect clicked thread.",
                                        "text_elements": [],
                                    }
                                ],
                            }
                        ],
                    }
                ],
            }
        }

        url = f"{self.base_url}/api/thread/active"

        with urllib.request.urlopen(url) as response:
            self.assertEqual(
                response.headers["Content-Type"],
                "application/json; charset=utf-8",
            )
            payload = json.loads(response.read().decode("utf-8"))

        self.assertEqual(payload["thread"]["id"], "active")
        self.assertEqual(payload["thread"]["agent_prompt"], "Inspect clicked thread.")

    def test_thread_message_api_sends_role_thread_message(self):
        self.fake.responses.update(
            {
                "thread/resume": {"thread": {"id": "main"}},
                "turn/start": {"turn": {"id": "turn-2"}},
            }
        )
        url = f"{self.base_url}/api/thread/main/message"
        request = urllib.request.Request(
            url,
            data=json.dumps({"message": "Ship it", "role": "thread"}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        with urllib.request.urlopen(request) as response:
            self.assertEqual(
                response.headers["Content-Type"],
                "application/json; charset=utf-8",
            )
            payload = json.loads(response.read().decode("utf-8"))

        self.assertTrue(payload["sent"])
        self.assertIn(("thread/resume", {"threadId": "main"}), self.fake.calls)
        self.assertIn(
            (
                "turn/start",
                {
                    "threadId": "main",
                    "input": [{"type": "text", "text": "Ship it"}],
                },
            ),
            self.fake.calls,
        )


if __name__ == "__main__":
    unittest.main()
