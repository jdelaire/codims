import json
import os
import threading
import time
import unittest
import urllib.request
from unittest import mock

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
    def clear_lifecycle_cache(self):
        cache = getattr(server, "THREAD_LIFECYCLE_CACHE", None)
        if cache is not None:
            cache.clear()

    def thread_read_call_count(self, fake, include_turns):
        return sum(
            1
            for method, params in fake.calls
            if method == "thread/read" and params.get("includeTurns") is include_turns
        )

    def test_payload_includes_capabilities(self):
        fake = FakeAppServerClient(
            {
                ("thread/list", None): {"data": [], "nextCursor": None},
            }
        )

        payload = server.get_threads_payload(client_factory=lambda: fake, now_ms=NOW_MS)

        self.assertEqual(
            payload["capabilities"],
            {"read_threads": True, "send_messages": False},
        )

    def test_default_payload_cache_reuses_lifecycle_reads_only(self):
        self.clear_lifecycle_cache()
        fake = FakeAppServerClient(
            {
                ("thread/list", None): {
                    "data": [
                        make_thread(
                            "default-cache-thread",
                            NOW_SECONDS - 60,
                            name="Cached child",
                            nickname="Ada",
                        )
                    ],
                    "nextCursor": None,
                },
                ("thread/read", "parent", False): {
                    "thread": {"id": "parent", "name": "Parent task"}
                },
                ("thread/read", "default-cache-thread", True): make_read_thread(
                    "default-cache-thread",
                    status={"type": "completed"},
                    agent_text="Cached response.",
                ),
            }
        )

        try:
            server.get_threads_payload(
                client_factory=lambda: fake,
                active_minutes=5,
                max_age_hours=12,
                now_ms=NOW_MS,
            )
            payload = server.get_threads_payload(
                client_factory=lambda: fake,
                active_minutes=5,
                max_age_hours=12,
                now_ms=NOW_MS,
            )
        finally:
            self.clear_lifecycle_cache()

        self.assertEqual(
            self.thread_read_call_count(fake, True),
            1,
            "unchanged thread id and updatedAt should reuse lifecycle cache",
        )
        self.assertEqual(
            self.thread_read_call_count(fake, False),
            2,
            "parent title reads should not use lifecycle cache",
        )
        self.assertEqual(payload["threads"][0]["state"], "DONE")
        self.assertEqual(
            payload["threads"][0]["last_response_snippet"],
            "Cached response.",
        )

    def get_threads_payload_with_cache(self, fake, cache, now_ms=NOW_MS):
        try:
            return server.get_threads_payload(
                client_factory=lambda: fake,
                active_minutes=5,
                max_age_hours=12,
                now_ms=now_ms,
                lifecycle_cache=cache,
            )
        except TypeError as error:
            self.fail(f"get_threads_payload should accept lifecycle_cache: {error}")

    def test_injected_lifecycle_cache_reuses_and_invalidates_by_updated_at(self):
        cache = {}
        first = FakeAppServerClient(
            {
                ("thread/list", None): {
                    "data": [
                        make_thread(
                            "explicit-cache-thread",
                            NOW_SECONDS - 60,
                            name="Cached child",
                            source="vscode",
                        )
                    ],
                    "nextCursor": None,
                },
                ("thread/read", "explicit-cache-thread", True): make_read_thread(
                    "explicit-cache-thread",
                    status={"type": "completed"},
                    agent_text="First response.",
                ),
            }
        )
        second = FakeAppServerClient(
            {
                ("thread/list", None): {
                    "data": [
                        make_thread(
                            "explicit-cache-thread",
                            NOW_SECONDS - 30,
                            name="Cached child",
                            source="vscode",
                        )
                    ],
                    "nextCursor": None,
                },
                ("thread/read", "explicit-cache-thread", True): make_read_thread(
                    "explicit-cache-thread",
                    status={"type": "running"},
                    agent_text="Second response.",
                ),
            }
        )

        first_payload = self.get_threads_payload_with_cache(first, cache)
        repeated_payload = self.get_threads_payload_with_cache(first, cache)
        invalidated_payload = self.get_threads_payload_with_cache(second, cache)

        self.assertEqual(self.thread_read_call_count(first, True), 1)
        self.assertEqual(self.thread_read_call_count(second, True), 1)
        self.assertEqual(first_payload["threads"][0]["state"], "DONE")
        self.assertEqual(repeated_payload["threads"][0]["state"], "DONE")
        self.assertEqual(invalidated_payload["threads"][0]["state"], "ACTIVE")
        self.assertEqual(
            invalidated_payload["threads"][0]["last_response_snippet"],
            "Second response.",
        )
        self.assertEqual(set(cache), {"explicit-cache-thread"})
        self.assertEqual(
            cache["explicit-cache-thread"]["updated_at_ms"],
            (NOW_SECONDS - 30) * 1000,
        )

    def test_lifecycle_cache_retries_after_transient_read_error(self):
        cache = {}
        failed = FakeAppServerClient(
            {
                ("thread/list", None): {
                    "data": [
                        make_thread(
                            "retry-thread",
                            NOW_SECONDS - 60,
                            name="Retry child",
                            source="vscode",
                        )
                    ],
                    "nextCursor": None,
                },
                ("thread/read", "retry-thread", True): server.AppServerError(
                    "temporary"
                ),
            }
        )
        recovered = FakeAppServerClient(
            {
                ("thread/list", None): {
                    "data": [
                        make_thread(
                            "retry-thread",
                            NOW_SECONDS - 60,
                            name="Retry child",
                            source="vscode",
                        )
                    ],
                    "nextCursor": None,
                },
                ("thread/read", "retry-thread", True): make_read_thread(
                    "retry-thread",
                    status={"type": "completed"},
                    agent_text="Recovered response.",
                ),
            }
        )

        failed_payload = self.get_threads_payload_with_cache(failed, cache)
        recovered_payload = self.get_threads_payload_with_cache(recovered, cache)

        self.assertEqual(self.thread_read_call_count(failed, True), 1)
        self.assertEqual(self.thread_read_call_count(recovered, True), 1)
        self.assertEqual(
            failed_payload["threads"][0]["last_response_snippet"],
            server.NO_RESPONSE_CAPTURED,
        )
        self.assertEqual(recovered_payload["threads"][0]["state"], "DONE")
        self.assertEqual(
            recovered_payload["threads"][0]["last_response_snippet"],
            "Recovered response.",
        )

    def test_lifecycle_cache_prunes_threads_not_visible_in_current_payload(self):
        cache = {}
        first = FakeAppServerClient(
            {
                ("thread/list", None): {
                    "data": [
                        make_thread(
                            "kept-thread",
                            NOW_SECONDS - 60,
                            name="Kept child",
                            source="vscode",
                        ),
                        make_thread(
                            "gone-thread",
                            NOW_SECONDS - 60,
                            name="Gone child",
                            source="vscode",
                        ),
                    ],
                    "nextCursor": None,
                },
                ("thread/read", "kept-thread", True): make_read_thread(
                    "kept-thread",
                    agent_text="Kept response.",
                ),
                ("thread/read", "gone-thread", True): make_read_thread(
                    "gone-thread",
                    agent_text="Gone response.",
                ),
            }
        )
        second = FakeAppServerClient(
            {
                ("thread/list", None): {
                    "data": [
                        make_thread(
                            "kept-thread",
                            NOW_SECONDS - 60,
                            name="Kept child",
                            source="vscode",
                        )
                    ],
                    "nextCursor": None,
                },
                ("thread/read", "kept-thread", True): make_read_thread(
                    "kept-thread",
                    agent_text="Kept response.",
                ),
            }
        )

        self.get_threads_payload_with_cache(first, cache)
        self.get_threads_payload_with_cache(second, cache)

        self.assertEqual(set(cache), {"kept-thread"})

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
            (3.0, 8.0),
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

    def test_threads_payload_treats_interrupted_thread_as_resumable(self):
        fake = FakeAppServerClient(
            {
                ("thread/list", None): {
                    "data": [
                        make_thread(
                            "resumed",
                            NOW_SECONDS - 10,
                            name="Resumed thread",
                            nickname="Ada",
                        )
                    ],
                    "nextCursor": None,
                },
                ("thread/read", "parent", False): {
                    "thread": {"id": "parent", "name": "Parent task"}
                },
                ("thread/read", "resumed", True): make_read_thread(
                    "resumed",
                    status="interrupted",
                    agent_text="Working again.",
                ),
            }
        )

        payload = server.get_threads_payload(
            client_factory=lambda: fake,
            active_minutes=5,
            max_age_hours=12,
            now_ms=NOW_MS,
        )

        self.assertEqual(payload["threads"][0]["state"], "ACTIVE")
        self.assertEqual(payload["threads"][0]["intensity"], "energetic")

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
                            "failed",
                            NOW_SECONDS - 20,
                            name="Failed child",
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
                ("thread/read", "failed", True): make_read_thread(
                    "failed",
                    status={"type": "failed"},
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
        self.assertEqual(by_id["failed"]["state"], "RECENT")
        self.assertEqual(by_id["failed"]["intensity"], "idle")
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
                        make_thread("malformed", NOW_SECONDS - 60, name="Malformed"),
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
                ("thread/read", "malformed", True): {
                    "thread": {"id": "malformed", "turns": ["bad-turn"]}
                },
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
        self.assertEqual(by_id["malformed"]["state"], "ACTIVE")
        self.assertEqual(
            by_id["malformed"]["last_response_snippet"],
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

    def test_send_thread_message_disabled_by_default_does_not_call_app_server(self):
        fake = FakeAppServerClient()

        payload = server.send_thread_message_payload(
            "main",
            "Ship it",
            "thread",
            client_factory=lambda: fake,
            now_ms=NOW_MS,
        )

        self.assertFalse(payload["sent"])
        self.assertIn("disabled", payload["error"])
        self.assertEqual(fake.calls, [])

    def test_send_thread_message_resumes_and_starts_role_thread(self):
        fake = FakeAppServerClient(
            {
                "thread/resume": {"thread": {"id": "main"}},
                "turn/start": {"turn": {"id": "turn-2"}},
            }
        )

        with mock.patch.object(server, "MESSAGE_SENDING_ENABLED", True):
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

    def test_send_thread_message_dry_run_does_not_call_app_server(self):
        fake = FakeAppServerClient()

        with mock.patch.object(server, "MESSAGE_SENDING_ENABLED", True):
            payload = server.send_thread_message_payload(
                "main",
                "Ship it",
                "thread",
                client_factory=lambda: fake,
                now_ms=NOW_MS,
                dry_run=True,
            )

        self.assertFalse(payload["sent"])
        self.assertTrue(payload["dry_run"])
        self.assertEqual(payload["message"], "Ship it")
        self.assertEqual(fake.calls, [])

    def test_send_thread_message_refuses_child_agent_role(self):
        fake = FakeAppServerClient()

        with mock.patch.object(server, "MESSAGE_SENDING_ENABLED", True):
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

        with mock.patch.object(server, "MESSAGE_SENDING_ENABLED", True):
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

    def test_thread_message_api_refuses_disabled_messages(self):
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

        self.assertFalse(payload["sent"])
        self.assertIn("disabled", payload["error"])
        self.assertEqual(self.fake.calls, [])


class ServerCliTests(unittest.TestCase):
    def test_parse_args_defaults_to_localhost(self):
        args = server.parse_args([])

        self.assertEqual(args.host, "127.0.0.1")
        self.assertEqual(args.port, 8765)
        self.assertEqual(args.codex_bin, "codex")

    def test_parse_args_allows_explicit_lan_host(self):
        args = server.parse_args(["--host", "0.0.0.0", "--port", "9000"])

        self.assertEqual(args.host, "0.0.0.0")
        self.assertEqual(args.port, 9000)

    def test_main_prints_codex_grid_brand(self):
        class FakeHTTPServer:
            def __init__(self, address, handler):
                self.server_port = 43210

            def serve_forever(self):
                return None

            def server_close(self):
                return None

        with (
            mock.patch.object(server, "ThreadingHTTPServer", FakeHTTPServer),
            mock.patch("builtins.print") as print_mock,
        ):
            self.assertEqual(server.main(["--port", "0"]), 0)

        print_mock.assert_any_call("Codex Grid running at http://127.0.0.1:43210")


if __name__ == "__main__":
    unittest.main()
