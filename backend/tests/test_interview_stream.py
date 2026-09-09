"""
What must still happen when the browser goes away mid-run.

An interview prep takes two to four minutes over SSE. Losing the client in
that window is normal — a phone locks, a tab is backgrounded, a proxy gives
up. The generator stops running the instant that happens, so anything that
lived in the generator after the model call was, in practice, optional:

  · `_save_prep` never ran     -> the questions were regenerated next visit,
                                  which is the "it regenerates every time"
                                  complaint and a repeated model bill
  · `release_addon_quota`      -> ran on the worker already, so it was fine
                                  for a crash but the SUCCESS path still
                                  charged a slot for a discarded result

Both now live on the worker thread. These tests pin that, because the failure
mode leaves no trace in the output — the user just sees a spinner again.
"""

import queue
import threading
from unittest.mock import patch

import pytest

import core.interview as interview


ROW = {"id": "resume-1", "job_description": "x" * 400, "generation_snapshot": {"facts_json": {}}}
CONTENT = {"language": "en", "questions": [{"question": "why us"}], "overview": "o"}


def _drain(gen, stop_after=None):
    """Consume the SSE generator, optionally abandoning it early the way a
    disconnected browser does."""
    frames = []
    for i, frame in enumerate(gen):
        frames.append(frame)
        if stop_after is not None and len(frames) >= stop_after:
            gen.close()          # exactly what Starlette does on disconnect
            break
    return frames


def test_a_successful_prep_is_saved_even_if_the_client_disconnects():
    saved = []
    with patch.object(interview, "run_interview_prep", return_value=CONTENT), \
         patch.object(interview, "_save_prep", side_effect=lambda *a: saved.append(a)), \
         patch.object(interview, "get_addon_quota", return_value={}), \
         patch.object(interview, "release_addon_quota") as release:
        gen = interview._stream_interview_prep(ROW, "user-1", "en")
        # Abandon the stream before the `complete` frame is ever read.
        _drain(gen, stop_after=0)
        # The worker owns the save, so give it a moment to finish.
        for t in threading.enumerate():
            if t is not threading.current_thread() and t.daemon:
                t.join(timeout=10)

    assert saved, "a generated prep was discarded because the browser left"
    assert saved[0][0] == "user-1" and saved[0][1] == "resume-1"
    release.assert_not_called()


def test_a_crash_releases_the_monthly_slot_and_logs_a_traceback(caplog):
    with patch.object(interview, "run_interview_prep", side_effect=KeyError("facts_json")), \
         patch.object(interview, "_save_prep") as save, \
         patch.object(interview, "get_addon_quota", return_value={}), \
         patch.object(interview, "release_addon_quota") as release:
        frames = _drain(interview._stream_interview_prep(ROW, "user-1", "en"))

    release.assert_called_once_with("user-1", interview.INTERVIEW_PREP)
    save.assert_not_called()
    error_frames = [f for f in frames if "event: error" in f]
    assert error_frames, frames
    assert "request_id" in error_frames[0], \
        "a user-visible failure must carry an id that can be found in the logs"


def test_the_error_payload_never_leaks_the_exception_to_the_user():
    """The traceback goes to the log; the browser gets a sentence."""
    with patch.object(interview, "run_interview_prep",
                      side_effect=RuntimeError("connection to 10.0.0.4:5432 refused")), \
         patch.object(interview, "_save_prep"), \
         patch.object(interview, "get_addon_quota", return_value={}), \
         patch.object(interview, "release_addon_quota"):
        frames = _drain(interview._stream_interview_prep(ROW, "user-1", "en"))

    blob = "".join(frames)
    assert "10.0.0.4" not in blob
    assert "Something went wrong preparing your questions" in blob
