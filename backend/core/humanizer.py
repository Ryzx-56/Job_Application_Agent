# core/humanizer.py
#
# One shared block of "don't write like an LLM" rules, spliced into every
# prompt that produces prose a human will read as their own: the tailored CV
# (agents/tailoring_engine.py), the cover letter
# (agents/document_generator.py), and the LinkedIn profile
# (agents/linkedin_generator.py).
#
# WHY PROMPT-LEVEL AND NOT A SECOND PASS: the obvious alternative is a
# draft -> critique -> revise loop, which is the standard humanizing workflow.
# It is deliberately NOT used here. Every extra pass is another full Claude
# call per generation: roughly double the tokens and double the wait on a
# request the user is already sitting through, in exchange for a small gain
# over instructions that are simply written well the first time. A CV
# generation is not a research task; the model has all the facts up front and
# can follow style rules on the first attempt. If output quality ever proves
# otherwise, revisit this decision explicitly rather than by accident.
#
# LANGUAGE: these rules are written in terms of English tells, because that's
# what the tells are. On an Arabic generation the shape of the advice still
# holds (no signposting connectives, no inflated significance, vary sentence
# length), and the specific banned English phrases simply don't arise.

HUMANIZER_RULES = """DO NOT SOUND LIKE AI. This section is as binding as the factual rules:

  - NO DASH PUNCTUATION. Never use an em dash or an en dash as punctuation. Use a comma, a
    period, a colon, or write two sentences. Hyphens inside compound words are fine.
  - NO SIGNPOSTING CONNECTIVES. Cut "moreover", "furthermore", "additionally", "in addition",
    "notably", "importantly", "crucially", "overall", "ultimately", "that said". Just make the
    next point.
  - NO INFLATED SIGNIFICANCE. Never write that something "stands as a testament to", "plays a
    pivotal/vital/crucial role in", "underscores", "showcases", "highlights the importance of",
    or "demonstrates a strong ability to". State what was done and what came of it.
  - NO STOCK OPENERS about the state of the world: "in today's fast-paced", "in an
    ever-evolving", "in the rapidly changing landscape of". No "landscape", "realm", "sphere",
    "delve into", "navigate the complexities of", "tapestry", "journey" as metaphors.
  - NO PADDED TRIPLES. Three adjectives or three nouns in a row is the most recognizable AI
    rhythm there is ("scalable, efficient, and maintainable"). Use one word if one word is
    true, and only list three when all three are separately load-bearing facts.
  - NO "NOT ONLY X BUT ALSO Y", no "it's not just X, it's Y", no "X isn't merely Y". Say the
    thing directly.
  - NO HEDGING FILLER: "it is worth noting", "it should be mentioned", "arguably",
    "one could say". If it's worth writing, write it.
  - PREFER PLAIN VERBS. "built", "led", "cut", "shipped", "rewrote", "owned", "fixed" over
    "leveraged", "utilized", "spearheaded", "orchestrated", "facilitated", "streamlined". Drop
    "robust", "seamless", "cutting-edge", "state-of-the-art", "world-class", "innovative
    solutions", "best practices" unless the source text itself used the word.
  - VARY THE RHYTHM. Uniform sentence length is the tell people notice without being able to
    name it. Mix short sentences with longer ones. Do not open consecutive sentences or
    consecutive bullets with the same word or the same grammatical shape.
  - BE SPECIFIC INSTEAD OF IMPRESSIVE. A real number, tool, system or outcome from the source
    data beats any amount of adjective. Where the source has nothing specific, write a shorter
    line rather than inflating it.
  - NO EMOJI, no markdown bold or italics, no bullet characters inside a field's text, no
    hashtags."""


def with_humanizer(prompt_section: str) -> str:
    """Appends the rules to an existing style section of a prompt.

    Returned text is stable for a given input, so a prompt built with this
    stays byte-identical across calls and remains eligible for Anthropic's
    prompt caching (see the `system` note in core/llm_config.py).
    """
    return f"{prompt_section.rstrip()}\n\n{HUMANIZER_RULES}"
