# core/usage_tracker.py
#
# Actual wiring used (differs from the original draft's plan): rather than
# threading one live UsageEvent object through the LangGraph nodes,
# tailoring_engine.py accumulates its own local usage_counters dict during
# run_tailoring_engine() and returns it as plain fields (usage_tailoring_calls,
# usage_tailoring_input_tokens, etc.) alongside everything else that node
# already returns. That's the more natural fit for LangGraph, since node
# return values are dict updates merged into shared state, not live object
# references — a mutable object stashed in state wouldn't survive the
# parallel fan-out (document_generator/ats_scorer/jobs_finder) cleanly.
#
# main.py then calls UsageEvent.from_pipeline_result(result, ...) ONCE after
# the graph finishes, and .flush(user_id) right after that. The record_*
# instance methods below are kept for reference / for wiring up
# fact_checker.py's regeneration loop the same way later, but main.py itself
# only uses from_pipeline_result + flush.
#
# bullets_regenerated_count, and its associated regen call/token counts,
# now come from core/fact_checker.py the same way tailoring_engine.py
# supplies its own — both are read together in from_pipeline_result below.
#
# Also note: total_calls/total_input_tokens/total_output_tokens still only
# cover tailoring_engine.py + fact_checker.py's Claude calls — jd_analyzer,
# document_generator, and match_scorer aren't instrumented yet. Same
# pattern (on_usage callback -> accumulate -> return as a cumulative state
# field) would extend to them if you want full-pipeline token totals later.

from dataclasses import dataclass, field
from loguru import logger

try:
    from supabase import create_client
    import os
    _supabase = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],  # service role, not anon — this is server-side
    )
except Exception as e:
    _supabase = None
    logger.warning(f"⚠️ usage_tracker: Supabase client not initialized ({e}) — events will be logged, not stored.")


@dataclass
class UsageEvent:
    cv_language: str
    input_mode: str = "upload"

    tailoring_attempts: int = 1
    hit_max_retries: bool = False

    arabic_purity_pass_fired: bool = False
    arabic_purity_still_bad: bool = False

    bullets_regenerated_count: int = 0

    # True when the run generated without profiles.name_ar / name_en for its
    # output language, so the candidate's name fell back to the CV's parsed
    # name run through the Arabic glossary. That's the LEGACY behavior this
    # field exists to measure — query it to see how many users are still
    # skipping the name prompt (and therefore may be getting a
    # machine-transliterated name on their CV).
    name_fallback_used: bool = False

    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_calls: int = 1

    pipeline_succeeded: bool = True
    error_message: str = ""

    # --- convenience constructor for main.py ---

    @classmethod
    def from_pipeline_result(cls, result: dict, input_mode: str, pipeline_succeeded: bool, error_message: str = ""):
        """
        Build a UsageEvent straight from the dict LangGraph hands back after
        graph.invoke()/graph.stream() finishes. Reads the usage_* and
        hit_max_retries keys that tailoring_engine.py now returns.

        NOTE: total_calls/total_input_tokens/total_output_tokens cover both
        tailoring_engine.py's Claude calls (main pass + Arabic purity pass)
        AND fact_checker.py's regeneration calls — jd_analyzer,
        document_generator, and match_scorer still aren't instrumented.
        """
        return cls(
            cv_language=result.get("cv_language", "en"),
            input_mode=input_mode,
            tailoring_attempts=result.get("tailoring_attempts", 1),
            hit_max_retries=bool(result.get("hit_max_retries", False)),
            arabic_purity_pass_fired=bool(result.get("usage_arabic_purity_fired", False)),
            arabic_purity_still_bad=bool(result.get("usage_arabic_purity_still_bad", False)),
            bullets_regenerated_count=result.get("usage_bullets_regenerated_count", 0) or 0,
            name_fallback_used=bool(result.get("name_fallback_used", False)),
            total_input_tokens=(result.get("usage_tailoring_input_tokens", 0) or 0) + (result.get("usage_regen_input_tokens", 0) or 0),
            total_output_tokens=(result.get("usage_tailoring_output_tokens", 0) or 0) + (result.get("usage_regen_output_tokens", 0) or 0),
            total_calls=(result.get("usage_tailoring_calls", 0) or 0) + (result.get("usage_regen_calls", 0) or 0),
            pipeline_succeeded=pipeline_succeeded,
            error_message=error_message,
        )

    # --- call these from the points in the pipeline noted below ---

    def record_call(self, input_tokens: int | None = None, output_tokens: int | None = None):
        """Call this every time generate_claude_text is invoked, from any
        agent (tailoring_engine's main pass, the purity pass, each
        regeneration call). If your llm wrapper doesn't return usage yet,
        just call with no args to at least keep total_calls accurate."""
        self.total_calls += 1
        if input_tokens:
            self.total_input_tokens += input_tokens
        if output_tokens:
            self.total_output_tokens += output_tokens

    def record_retry(self):
        """Call in run_tailoring_engine's except blocks, before the next
        attempt starts."""
        self.tailoring_attempts += 1

    def record_max_retries_hit(self):
        self.hit_max_retries = True

    def record_arabic_purity_fired(self, still_offending: bool):
        """Call inside _enforce_arabic_purity, right after the corrective
        call returns — pass whether still_offending came back non-empty."""
        self.arabic_purity_pass_fired = True
        self.arabic_purity_still_bad = still_offending

    def record_bullet_regenerated(self):
        """Call once per bullet inside whatever loop invokes the
        `regenerate` closure from make_regeneration_fn."""
        self.bullets_regenerated_count += 1

    def record_failure(self, message: str):
        self.pipeline_succeeded = False
        self.error_message = message[:500]  # keep it short

    # --- call once, at the very end of the request ---

    def flush(self, user_id: str | None):
        row = {
            "user_id": user_id,
            "cv_language": self.cv_language,
            "input_mode": self.input_mode,
            "tailoring_attempts": self.tailoring_attempts,
            "hit_max_retries": self.hit_max_retries,
            "arabic_purity_pass_fired": self.arabic_purity_pass_fired,
            "arabic_purity_still_bad": self.arabic_purity_still_bad,
            "bullets_regenerated_count": self.bullets_regenerated_count,
            "name_fallback_used": self.name_fallback_used,
            "total_input_tokens": self.total_input_tokens or None,
            "total_output_tokens": self.total_output_tokens or None,
            "total_calls": self.total_calls,
            "pipeline_succeeded": self.pipeline_succeeded,
            "error_message": self.error_message or None,
        }

        if _supabase is None:
            logger.info(f"📊 usage_event (no Supabase client): {row}")
            return

        try:
            _supabase.table("cv_generation_events").insert(row).execute()
        except Exception as e:
            # Never let analytics logging break the actual pipeline response.
            logger.error(f"❌ Failed to write usage_event to Supabase: {e}")
