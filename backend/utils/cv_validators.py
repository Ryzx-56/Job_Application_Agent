# utils/cv_validators.py
"""
Deterministic cleanup of model output, applied after Agent 3 and before
anything is rendered.

WHY VALIDATORS AND NOT PROMPT RULES. Every defect handled here was already
covered by an instruction in TAILORING_SYSTEM_PROMPT, and every one of them
still reached a finished CV. A prompt rule is a request; a validator is a
guarantee. The measured case that settled it: degree normalisation
("Bachelor degree" -> "Bachelor's Degree") is an explicit prompt rule, it
passed on both runs of the blind model comparison, and it FAILED on the very
next production run of the same pipeline on the same input. A rule that holds
two times out of three is not a rule.

So the split is:
  · things with a right answer that code can compute  -> here
  · things that need judgment (tone, emphasis, what to cut) -> the prompt

Everything here is conservative in the same direction: it removes or corrects,
it never invents. Nothing in this module can add a claim to a CV.
"""

import re

from loguru import logger


# ─── 1. DATASETS, BENCHMARKS AND HOSTING PLATFORMS ARE NOT SKILLS ───────────
#
# Observed in real output: `Tools: API Integration, Multi-agent System,
# Pandas, CASIA 2, Kaggle`. CASIA 2 is a forgery-detection dataset and Kaggle
# is a website you download datasets from. Neither is a tool, neither is a
# skill, and both displace real keywords in a section the ATS scorer is
# measuring — so they cost twice.
#
# Matched on the whole normalised entry, never as a substring: "Kaggle" is
# removed, "Kaggle Grandmaster" is not (that is a real credential), and
# "Pandas" survives because it is a library.
_DATASETS_AND_PLATFORMS = {
    # Vision / forgery / face datasets
    "casia", "casia 2", "casia v2", "casia2", "imagenet", "coco", "ms coco",
    "mnist", "fashion-mnist", "cifar", "cifar-10", "cifar-100", "celeba",
    "lfw", "pascal voc", "open images", "kitti", "ade20k", "cityscapes",
    "places365", "svhn", "caltech-101", "casia-webface", "ffhq", "widerface",
    # NLP / speech benchmarks
    "glue", "superglue", "squad", "imdb", "wikitext", "common crawl",
    "librispeech", "conll", "conll-2003", "snli", "multinli", "xnli",
    "commonvoice", "common voice", "ms marco", "trec", "wmt",
    # Tabular / general
    "uci", "uci ml repository", "uci machine learning repository", "titanic",
    "iris dataset", "boston housing", "adult income",
    # Hosting / competition platforms — where data lives, not what you can do
    "kaggle", "roboflow", "papers with code", "paperswithcode", "openml",
    "drivendata", "zindi", "aicrowd", "codalab", "data.gov",
    "google dataset search",
}

# ─── 2. FILLER TAGS ─────────────────────────────────────────────────────────
#
# Observed in real output: a project tech tag of `Programming`. It carries no
# information a recruiter or an ATS can use, and it occupies a slot a real
# keyword would have had.
_FILLER_TERMS = {
    "programming", "coding", "computer", "computers", "computing",
    "technology", "tech", "software", "it", "i.t.", "information technology",
    "development", "developing", "development skills", "general",
    "miscellaneous", "misc", "other", "others", "various", "etc", "etc.",
    "n/a", "na", "none", "stuff", "things", "basics", "fundamentals",
    "computer skills", "technical skills", "hard skills", "soft skills",
    "tools", "frameworks", "languages", "skills",
}


def _norm(value) -> str:
    """Casefolded, punctuation-trimmed, whitespace-collapsed."""
    return re.sub(r"\s+", " ", str(value or "").strip().strip(".,;:•-").strip()).casefold()


def is_dataset_or_platform(value) -> bool:
    return _norm(value) in _DATASETS_AND_PLATFORMS


def is_filler(value) -> bool:
    return _norm(value) in _FILLER_TERMS


def clean_skill_list(values, where: str = "skills") -> list:
    """
    One skills category, with datasets, platforms, filler and duplicates
    removed. Order is preserved — the model put the most relevant first.
    """
    cleaned, seen = [], set()
    for value in values or []:
        text = str(value or "").strip()
        if not text:
            continue
        key = _norm(text)
        if not key or key in seen:
            continue
        if is_dataset_or_platform(text):
            logger.info(f"🧹 Dropped {text!r} from {where} — a dataset/platform is not a skill")
            continue
        if is_filler(text):
            logger.info(f"🧹 Dropped {text!r} from {where} — filler, carries no information")
            continue
        seen.add(key)
        cleaned.append(text)
    return cleaned


def clean_skills(skills: dict) -> dict:
    """Every category of a tailored_skills dict, cleaned. Shape preserved:
    callers rely on all five keys existing, empty or not."""
    if not isinstance(skills, dict):
        return skills
    return {
        category: (clean_skill_list(items, f"skills.{category}")
                   if isinstance(items, list) else items)
        for category, items in skills.items()
    }


# ─── 3. PROJECT TECH TAGS ───────────────────────────────────────────────────
#
# The templates print tags on one line beside the project title. In several
# comparison runs the tag string was long enough to push the title onto a
# second line and break the column. A cap is the fix that does not depend on
# sixteen templates each handling overflow correctly.
MAX_TECH_TAGS = 6
MAX_TECH_TAGS_CHARS = 70


def clean_tech_stack(values, project_name: str = "") -> list:
    """
    A project's tech tags: no datasets, no filler, no duplicates, capped at
    MAX_TECH_TAGS entries and MAX_TECH_TAGS_CHARS rendered characters.

    Trimmed from the END, because the model returns the most relevant first
    and the tail is where the padding lives.
    """
    tags = clean_skill_list(values, f"project tags ({project_name})" if project_name else "project tags")
    if len(tags) > MAX_TECH_TAGS:
        logger.info(
            f"✂️ {project_name or 'project'}: {len(tags)} tech tags capped to {MAX_TECH_TAGS}"
        )
        tags = tags[:MAX_TECH_TAGS]
    while tags and len(", ".join(tags)) > MAX_TECH_TAGS_CHARS and len(tags) > 1:
        tags.pop()
    return tags


# ─── 4. DEGREE NORMALISATION ────────────────────────────────────────────────
#
# "Bachelor degree in Artificial Intelligence" -> "Bachelor's Degree in
# Artificial Intelligence". The identity of the qualification is never
# changed: only the spelling of the degree word itself, and only when the
# input is one of these unambiguous mis-spellings. A degree this does not
# recognise is returned untouched — inventing a qualification is the single
# worst thing this pipeline can do, so an unfixed typo is always the better
# error.
_DEGREE_PATTERNS = [
    (re.compile(r"\bbachelors?\s+degree\b", re.I), "Bachelor's Degree"),
    (re.compile(r"\bbachelor\s+degree\b", re.I), "Bachelor's Degree"),
    (re.compile(r"\bbachelors\b(?!\s*')", re.I), "Bachelor's"),
    (re.compile(r"\bmasters?\s+degree\b", re.I), "Master's Degree"),
    (re.compile(r"\bmaster\s+degree\b", re.I), "Master's Degree"),
    (re.compile(r"\bmasters\b(?!\s*')", re.I), "Master's"),
    (re.compile(r"\bassociates?\s+degree\b", re.I), "Associate Degree"),
    (re.compile(r"\bbachelor\s+of\s+", re.I), "Bachelor of "),
    (re.compile(r"\bmaster\s+of\s+", re.I), "Master of "),
    (re.compile(r"\bph\.?\s*d\.?\b", re.I), "PhD"),
    (re.compile(r"\bdoctorate\s+degree\b", re.I), "Doctorate"),
    (re.compile(r"\bhigh\s+school\s+diploma\b", re.I), "High School Diploma"),
]


def normalize_degree(text) -> str:
    """
    A degree string with its qualification word spelled correctly.

    Arabic degrees are returned untouched — the patterns are all Latin, and
    an Arabic CV's degree comes through the glossary, not through here.
    """
    original = str(text or "")
    if not original.strip():
        return original
    fixed = original
    for pattern, replacement in _DEGREE_PATTERNS:
        fixed = pattern.sub(replacement, fixed)
    if fixed != original:
        logger.info(f"🎓 Degree normalised: {original!r} -> {fixed!r}")
    return fixed
