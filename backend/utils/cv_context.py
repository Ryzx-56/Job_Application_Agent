# utils/cv_context.py
"""
Builds the render context both generators need from LangGraph state:
  - utils/pdf_generator.py (Jinja2 + WeasyPrint, template-driven)
  - utils/docx_generator.py (python-docx, style-preset-driven)

This used to be duplicated inline in both files (bullet_lookup /
project_lookup built twice, slightly differently). Centralizing it means a
future bug fix to "how do we match a tailored bullet back to its section"
only has to happen once, and PDF/DOCX can't drift out of sync again.
"""

from loguru import logger

from core.profile_names import has_arabic, has_latin
from utils.skills import has_skills
from utils.template_registry import DEFAULT_TEMPLATE_ID, template_supports_photo
from utils.arabic_localizer import apply_glossary, localize_date, to_eastern_arabic_numerals


def _s(value) -> str:
    """
    String-coalesce: `None` -> "", anything else -> str(value) unchanged.
    Exists because `dict.get(key, default)` is a no-op whenever `key` IS
    present with an explicit `None` value (Pydantic's model_dump() always
    includes Optional fields, even unset ones) — `.get()`'s default only
    kicks in when the key is missing entirely. Every Optional field coming
    out of facts_json/tailored_* must be routed through this (or `or ""`)
    before it reaches a template or docx run, otherwise Jinja/f-strings
    print the literal text "None" for an unset field — see the CV/DOCX
    "None" rendering bug this fixes.
    """
    return "" if value is None else str(value)


def _profile_handle(value) -> str:
    """
    The bare username out of a LinkedIn/GitHub value, whatever shape it
    arrived in.

    WHY THIS EXISTS. Every one of the 16 templates renders this field as a
    PREFIX PLUS THE VALUE — `linkedin.com/in/{{ personal.linkedin }}` — which
    is only correct if the value is a bare handle. Agent 1 extracts what the
    CV actually prints, and a CV normally prints the full URL, so the real
    output was:

        linkedin.com/in/https://www.linkedin.com/in/abdulmalik-hawsawi/
        github.com/https://github.com/Ryzx-56

    on the contact line of every template, plus an href pointing at that same
    doubled path. Fixed here rather than in the 16 templates (or in the
    parser prompt) for two reasons: one place cannot drift out of sync with
    fifteen others, and doing it at RENDER time also repairs every CV already
    stored in a generation_snapshot, which a parser-side fix could not.

    Handles: full URLs with or without scheme/www, a "in/handle" fragment
    (what the manual form's placeholder suggests), an "@handle", a bare
    handle, trailing slashes, and query strings. Returns the last real path
    segment, so an unexpected shape still yields something well-formed rather
    than a URL nested inside a URL.
    """
    text = _s(value).strip()
    if not text:
        return ""
    text = text.split("?", 1)[0].split("#", 1)[0]
    text = text.rstrip("/").lstrip("@")
    segments = [segment for segment in text.split("/") if segment]
    if not segments:
        return ""
    handle = segments[-1]
    # A scheme-only value ("https://") or a bare host ("linkedin.com") leaves
    # nothing that is actually a username — better an empty contact line than
    # a link to linkedin.com/in/linkedin.com.
    if handle.lower() in ("linkedin.com", "www.linkedin.com", "github.com",
                          "www.github.com", "http:", "https:", "in"):
        return ""
    return handle


# ─── TEMPLATE CHROME ────────────────────────────────────────────────────────
# Section headings and field labels were hardcoded English literals inside
# all 12 Jinja templates ("Skills", "Languages:", "GPA", ...). Since they
# live in the template rather than in the generated content, no amount of
# Arabic localization in the pipeline could reach them — an Arabic CV came
# out with fully Arabic prose sitting under English headings.
#
# Both variants live here, in one place, so a template can render either
# language without knowing anything about which one it's in, and so a new
# label can't be added to one language and forgotten in the other.
_LABELS_EN = {
    "profile": "Profile",
    "summary": "Summary",
    "professional_summary": "Professional Summary",
    "experience": "Experience",
    "work_experience": "Work Experience",
    "professional_experience": "Professional Experience",
    "projects": "Projects",
    "skills": "Skills",
    "education": "Education",
    "certifications": "Certifications",
    "volunteer": "Volunteer Work",
    "contact": "Contact",
    "languages": "Languages",
    "frameworks": "Frameworks",
    "frameworks_libraries": "Frameworks & Libraries",
    "tools": "Tools",
    "soft_skills": "Soft Skills",
    "other_skills": "Other",
    "gpa": "GPA",
    "coursework": "Relevant Coursework",
    # Sections added with the facts_schema expansion — see FactsJSON. The
    # last one is the heading for a catch-all section whose own title didn't
    # survive extraction; the section's content is still printed under it
    # rather than dropped.
    "achievements": "Key Achievements",
    "training": "Training & Courses",
    "participation": "Conferences & Participation",
    "publications": "Publications",
    "teaching_editorial": "Teaching & Editorial Boards",
    "awards": "Awards",
    "additional": "Additional Information",
    # NOT "languages" — that key is already taken by the SKILLS category
    # (programming languages) and reusing it would relabel a skills row.
    # This one is the human languages Agent 1 extracts into
    # facts_json.languages_spoken.
    "spoken_languages": "Languages",
}

_LABELS_AR = {
    "profile": "نبذة",
    "summary": "الملخص",
    "professional_summary": "الملخص المهني",
    "experience": "الخبرات",
    "work_experience": "الخبرات العملية",
    "professional_experience": "الخبرات المهنية",
    "projects": "المشاريع",
    "skills": "المهارات",
    "education": "التعليم",
    "certifications": "الشهادات",
    "volunteer": "العمل التطوعي",
    "contact": "معلومات التواصل",
    "languages": "لغات البرمجة",
    "frameworks": "الأطر والمكتبات",
    "frameworks_libraries": "الأطر والمكتبات",
    "tools": "الأدوات",
    "soft_skills": "المهارات الشخصية",
    "other_skills": "مهارات أخرى",
    "gpa": "المعدل التراكمي",
    "coursework": "المواد الدراسية ذات الصلة",
    "achievements": "أبرز الإنجازات",
    "training": "الدورات التدريبية",
    "participation": "المشاركات المحلية والدولية",
    "publications": "الأبحاث والمنشورات",
    "teaching_editorial": "التدريس وعضوية هيئات التحرير",
    "awards": "الجوائز والتكريمات",
    "additional": "معلومات إضافية",
    "spoken_languages": "اللغات",
}


def text_direction(strings, default: str) -> str:
    """
    "ltr" or "rtl" for a block of text, decided by the script it's written in.

    NEEDED BY THE VERBATIM FIELDS. `publications` and `additional_sections`
    are deliberately not translated (see build_cv_context), so on an Arabic CV
    they are Latin text sitting inside an RTL paragraph — and the Unicode bidi
    algorithm then resolves their NEUTRAL characters (leading digits, the
    trailing full stop) to the paragraph's direction. The result is not a font
    problem or a shaping problem, it is a MEANING problem:

        "1,240 procedures performed ... between 2019 and 2024."
                 rendered as
        ".procedures performed ... between 2019 and 2024 1,240"

    The surgeon's own figure lands at the end of the sentence it belongs at
    the front of. Marking the block with its real direction keeps each line
    laid out the way its own script reads. Works in both directions: an Arabic
    section inside an English CV gets `rtl` by the same test.

    `default` is the document's direction, used when the text has no strong
    characters either way (a line of pure digits).
    """
    for text in strings:
        if not isinstance(text, str):
            continue
        if has_arabic(text):
            return "rtl"
        if has_latin(text):
            return "ltr"
    return default


def _script_matches_output(name: str, is_arabic: bool) -> bool:
    """
    Is this name written in the script the document is being rendered in?

    Deliberately strict — a name must be PURELY the target script to count.
    A mixed-script string ("Abdulmalik عبدالملك", or an Arabic name with a
    Latin middle initial) is ambiguous about which spelling its owner
    considers theirs, so it defers to the profile field rather than guessing.
    Conservative in the safe direction: the profile value is always something
    the user typed themselves.
    """
    arabic, latin = has_arabic(name), has_latin(name)
    return (arabic and not latin) if is_arabic else (latin and not arabic)


def resolve_candidate_name(state: dict) -> str:
    """
    The candidate's name for this run. Never machine-translated, and now
    preferring the name on the CV they actually uploaded.

    WHY THIS ORDER CHANGED. The profile field used to win unconditionally,
    and because main.py's apply_candidate_names() refuses the run outright
    when that field is empty, the parsed CV name was structurally
    unreachable — every CV rendered with the account's settings name on it,
    even when the uploaded document said something else. That is the
    reported bug: upload a CV under an account whose profile name differs,
    and the wrong person's name comes out on the document.

    WHY IT IS NOT SIMPLY "PARSED NAME FIRST". A name has several valid
    spellings across scripts and only its owner knows which is theirs, which
    is the whole reason profiles.name_ar / name_en exist (see
    core/profile_names.py). Taking the parsed name unconditionally would put
    a Latin name on an Arabic CV whenever someone uploads an English CV and
    asks for Arabic output — reintroducing exactly what those fields fixed.

    So the test is SCRIPT MATCH, not source precedence. When the uploaded CV
    is already written in the output language, its name is the most
    authoritative spelling available — profile_names.py makes this same
    argument itself about Arabic CVs: the document "already contains the
    candidate's own Arabic spelling, which is authoritative in a way a
    machine transliteration never is." When the scripts differ, no
    authoritative spelling exists in the CV and the profile field is the
    only real answer.

    RESOLUTION ORDER, most to least authoritative:
      1. The parsed CV name, IF it is written in the output language's
         script. Verbatim, no glossary.
      2. The profile field for this output language — the user typed it.
      3. The other language's profile field, used as-is. Still a real name
         the user typed, just in the other script.
      4. The parsed CV name, glossary-translated. LEGACY path, reachable
         only when the user explicitly opted out of the name prompt —
         main.py sets name_fallback_used so it stays visible.

    Resolution matrix:
      EN CV -> EN doc : parsed name      (1)
      AR CV -> AR doc : parsed name      (1)
      EN CV -> AR doc : profile name_ar  (2)  no Latin name on an Arabic CV
      AR CV -> EN doc : profile name_en  (2)

    Shared by build_cv_context and pdf_generator's cover letter so the CV,
    the DOCX and the letter can never disagree about what the candidate is
    called. Manual-entry runs resolve identically: run_manual_cv_parser
    produces the same facts_json shape from the typed form.
    """
    is_arabic = str(state.get("cv_language", "en")).lower().startswith("ar")

    parsed = _s(((state.get("facts_json", {}) or {}).get("personal", {}) or {}).get("name")).strip()
    preferred = ((state.get("profile_name_ar") if is_arabic else state.get("profile_name_en")) or "").strip()
    other = ((state.get("profile_name_en") if is_arabic else state.get("profile_name_ar")) or "").strip()

    if parsed and _script_matches_output(parsed, is_arabic):
        return parsed

    # Everything below here is a fallback, and the brief asks that none of
    # them be silent. Two distinct situations, logged differently on purpose:
    #
    #   · No parsed name at all. Agent 1 is REQUIRED to return one
    #     (facts_schema.PersonalInfo.name is non-optional) and main.py's
    #     _pipeline_produced_usable_cv gates the whole run on it, so reaching
    #     here means something upstream went wrong in a way those checks
    #     missed — a partial extraction. WARNING: this one is a defect
    #     signal, and it is the line to grep for when a rendered CV has an
    #     unexpected name on it.
    #
    #   · A parsed name in the other script. Entirely expected (an English
    #     CV asked to render in Arabic) and the correct behaviour, so it is
    #     INFO, not a warning. Still recorded, because it explains why the
    #     document does not carry the name printed on the uploaded file.
    user_id = state.get("user_id") or "unknown"
    target_script = "Arabic" if is_arabic else "Latin"
    if not parsed:
        logger.warning(
            f"👤 NAME FALLBACK (no parsed name): Agent 1 returned no personal.name for user "
            f"{user_id}, falling back to the profile name for a '{'ar' if is_arabic else 'en'}' CV. "
            f"This should not happen — treat it as a partial extraction."
        )
    else:
        logger.info(
            f"👤 Name fallback (script mismatch): the uploaded CV's name is not {target_script} "
            f"script, so the {target_script} profile name is used for this "
            f"'{'ar' if is_arabic else 'en'}' CV (user {user_id})."
        )

    if preferred:
        return preferred

    if other:
        logger.warning(
            f"👤 NAME FALLBACK (other script): no {target_script} profile name on file for user "
            f"{user_id} — rendering the other language's profile name as-is."
        )
        return other

    glossary = (state.get("arabic_glossary") or {}) if is_arabic else {}
    logger.warning(
        f"👤 LEGACY NAME PATH: no profile name in either language for user {user_id}; "
        f"using the CV's parsed name{' via the Arabic glossary' if glossary else ''}. "
        f"See apply_candidate_names in main.py."
    )
    return apply_glossary(parsed, glossary) if glossary else parsed


def resolve_candidate_photo(state: dict, template_id: str | None) -> str:
    """
    The photo this render should draw, or "" for none.

    Extracted from the uploaded file with no LLM call (see utils/cv_photo.py)
    and carried on state as a JPEG data URI. Gated on the template rather
    than just on "is there a photo": the eleven original templates have no
    slot for one, and handing them a 30 KB string they never reference would
    only inflate the render context — which fit_to_page.py measures.

    Returns "" rather than None so a template's `{% if photo %}` behaves the
    same whether the key was absent, empty, or never set (the manual
    'Create New CV' flow has no uploaded file and so never has a photo).
    """
    if not template_supports_photo(template_id):
        return ""
    photo = _s(state.get("candidate_photo")).strip()
    return photo if photo.startswith("data:image/") else ""


def build_cv_context(state: dict, template_id: str | None = None) -> dict:
    facts = state.get("facts_json", {}) or {}
    personal = facts.get("personal", {}) or {}
    is_arabic = state.get("cv_language", "en") == "ar"

    # Arabic term glossary built by tailoring_engine.py — see the
    # arabic_glossary note in core/state.py. `ar()` is the single place raw
    # facts_json text gets localized on its way into the render context.
    #
    # This is what fixes the largest remaining source of English on an
    # "Arabic" CV: the tailored bullets were translated, but the employer,
    # university, degree and certifications printed directly around them
    # came straight out of facts_json and no agent ever touched them.
    # Purely a dictionary substitution — no LLM call happens here, which
    # matters because this runs inside the render thread pool.
    #
    # Identifier fields (email / phone / linkedin / github) are NEVER routed
    # through this. apply_glossary defends itself against them too, but the
    # real guarantee is that they simply aren't passed in.
    glossary = (state.get("arabic_glossary") or {}) if is_arabic else {}

    def ar(value) -> str:
        return apply_glossary(_s(value), glossary) if glossary else _s(value)

    def ar_list(values) -> list:
        return [ar(v) for v in (values or [])]


    # WHICH SKILLS ACTUALLY GET PRINTED.
    #
    # This was `state.get("tailored_skills") or facts.get("skills", {})`, and
    # that `or` is why CVs shipped with no Skills section at all: Agent 3
    # returns the five categories present-and-empty when it produced no
    # skills, which is truthy, so the raw parsed skills were never reached.
    # has_skills asks the question the code actually means. See utils/skills.py.
    #
    # Whether we fell back also decides localization: a tailored set is
    # already Arabic, the raw facts set is still English and has to go
    # through the glossary or an Arabic CV prints an English skills column.
    agent_skills = state.get("tailored_skills")
    if has_skills(agent_skills):
        tailored_skills = agent_skills
    elif has_skills(facts.get("skills")):
        raw_skills = facts.get("skills") or {}
        tailored_skills = (
            {
                category: ar_list(items) if isinstance(items, list) else items
                for category, items in raw_skills.items()
            }
            if glossary
            else raw_skills
        )
    else:
        tailored_skills = {}

    bullet_lookup = {
        (b.get("original") or "").strip(): (b.get("tailored") or "").strip()
        for b in state.get("tailored_bullets", []) or []
        if b.get("original") and b.get("tailored")
    }
    project_lookup = {
        (p.get("name") or "").strip(): p
        for p in state.get("tailored_projects", []) or []
        if p.get("name")
    }
    # Job titles: tailoring_engine.py now returns a localized title per
    # experience entry (see tailored_experience_titles), matched back by the
    # "company" field the same way tailored_projects matches by "name". This
    # exists specifically for Arabic CVs — without it, the title would stay
    # in whatever language the original uploaded CV was written in, even
    # while the bullets underneath it were freshly translated to Arabic.
    title_lookup = {
        (t.get("company") or "").strip(): (t.get("title") or "").strip()
        for t in state.get("tailored_experience_titles", []) or []
        if t.get("company") and t.get("title")
    }
    raw_volunteer_work = facts.get("volunteer_work", []) or []
    tailored_volunteer_work = state.get("tailored_volunteer_work", []) or []
    display_volunteer = (
        tailored_volunteer_work
        if len(tailored_volunteer_work) == len(raw_volunteer_work)
        else raw_volunteer_work
    )

    # Experience: attach each raw bullet's tailored replacement, in order,
    # as a plain list of strings — matches the real data shape (bullets
    # live inline on the experience entry, there's no separate "section"
    # tag to filter on).
    experience = []
    for exp in facts.get("experience", []) or []:
        # IMPORTANT: only the RAW fallback goes through ar(). A bullet that
        # came from bullet_lookup was already localized inside
        # tailoring_engine, and running the glossary over it a second time
        # can nest a substitution inside itself when a translation happens
        # to still contain its own Latin term (e.g. "بايثون (Python)").
        # Same reasoning applies to the title, projects and volunteer work
        # below: localize the fallback, never the already-tailored value.
        resolved_bullets = []
        for raw in (exp.get("bullets", []) or []):
            if not raw or not raw.strip():
                continue
            tailored = bullet_lookup.get(raw.strip())
            resolved_bullets.append(tailored if tailored is not None else ar(raw))

        experience.append({
            "title": title_lookup.get((exp.get("company") or "").strip()) or ar(exp.get("title")),
            "company": ar(exp.get("company")),
            # Month names and digits — see localize_date. Previously this
            # only happened inside pdf_generator, so the DOCX kept English
            # month names on an otherwise Arabic CV.
            "dates": localize_date(exp.get("dates")) if is_arabic else _s(exp.get("dates")),
            "bullets": resolved_bullets,
        })

    # Projects: a single tailored paragraph per project (tailored_description),
    # not a bullet list — matches tailoring_engine.py's actual output shape.
    projects = []
    for proj in facts.get("projects", []) or []:
        name = (proj.get("name") or "").strip()
        tailored = project_lookup.get(name)
        # tailored.tech_stack is tailoring_engine.py's cleaned/inferred version
        # (also translated for Arabic) — prefer it over the raw facts_json
        # pass-through, same "prefer the tailored version, fall back to raw"
        # pattern used for title/description just above. Only fall back if
        # tailoring_engine genuinely returned nothing usable.
        tailored_tech = (tailored or {}).get("tech_stack") or []
        if tailored_tech:
            # Already localized by tailoring_engine — do not re-apply.
            tech_items = [_s(t).strip() for t in tailored_tech if _s(t).strip()]
        else:
            raw_tech = proj.get("tech_stack") or proj.get("technologies") or []
            if isinstance(raw_tech, str):
                raw_tech = [t.strip() for t in raw_tech.split(",") if t.strip()]
            tech_items = [ar(t).strip() for t in raw_tech if _s(t).strip()]
        projects.append({
            # `name` here is the raw facts_json project name used as the
            # display fallback — localize it. The join key itself (matched
            # in project_lookup above) is deliberately left untranslated.
            "name": (tailored.get("display_name") if tailored else None) or ar(name),
            "tech_stack": tech_items,
            "description": (tailored.get("tailored_description") if tailored else None)
                            or ar(proj.get("description")),
        })

    # ─── FACTS THAT NO AGENT REWRITES ───────────────────────────────────────
    #
    # Everything from here to the return is raw facts_json, rendered as
    # extracted. Agent 3 is told explicitly not to touch these (see the
    # READ-ONLY FIELDS block in tailoring_engine.py): a publication citation,
    # a course title, an award, and above all the numbers inside a CV's own
    # sections are the candidate's factual record, and rephrasing them is
    # fabrication, not tailoring.
    #
    # Most of them take `ar()` — deterministic glossary substitution for
    # Arabic CVs, the same treatment certifications and institution names
    # already get.
    #
    # TWO ARE EXEMPT: `publications` and `additional_sections` are NOT
    # localized, in either direction. The glossary cannot alter a digit, but
    # it can still change what a line MEANS: it translates the longest Latin
    # run it finds, and "0.8% 30-day complication rate" splits into "30-" plus
    # the phrase "day complication rate", which came back as "معدل المضاعفات
    # اليومي" — a DAILY complication rate. The number survived and the
    # clinical window it referred to did not. That is a factual error on a
    # surgeon's CV, not a cosmetic one, and this field is precisely where
    # unverifiable factual data lives.
    #
    # Publications are exempt for a related reason: a citation is a lookup
    # key. Half-transliterating it ("Hawsawi, A." -> "حواساوي, A.") produces a
    # reference nobody can find, which defeats the only purpose a citation
    # has. Both therefore render in their original script on an Arabic CV.
    #
    # (The localizer's digit-hyphen handling is worth fixing on its own; it
    # affects certifications and volunteer work today, and is deliberately not
    # bundled in here.)
    def _date(value) -> str:
        return localize_date(value) if is_arabic else _s(value)

    training_courses = [
        {
            "name": ar(course.get("name")),
            "provider": ar(course.get("provider")),
            "date": _date(course.get("date")),
        }
        for course in (facts.get("training_courses", []) or [])
        if any(_s(course.get(k)).strip() for k in ("name", "provider", "date"))
    ]

    participation = [
        {
            "title": ar(item.get("title")),
            "role": ar(item.get("role")),
            "organization": ar(item.get("organization")),
            "scope": ar(item.get("scope")),
            "date": _date(item.get("date")),
        }
        for item in (facts.get("participation", []) or [])
        if any(_s(item.get(k)).strip() for k in ("title", "role", "organization"))
    ]

    # Verbatim, including on an Arabic CV — see the exemption note above.
    publications = []
    for pub in (facts.get("publications", []) or []):
        title = _s(pub.get("title")).strip()
        if not title:
            continue
        venue = _s(pub.get("venue")).strip()
        year = _s(pub.get("year")).strip()
        # A title extracted from a full citation usually ends in the citation's
        # own full stop, and the renderers then append ", {venue}" — printing
        # "...Document Generation., Journal of Applied AI". Drop that one
        # terminator, and only when something actually follows it.
        if (venue or year) and title[-1:] in ".,;":
            title = title[:-1].rstrip()
        publications.append({"title": title, "venue": venue, "year": year,
                             "url": _s(pub.get("url"))})
    # The direction these citations actually read in — see text_direction.
    publications_dir = text_direction(
        [p["title"] for p in publications] + [p["venue"] for p in publications],
        "rtl" if is_arabic else "ltr",
    )

    # The catch-all, verbatim in both languages — see the exemption note
    # above. Sections whose own heading didn't survive extraction are kept and
    # printed under the generic label rather than dropped: losing the heading
    # is a formatting problem, losing the content is a data loss.
    additional_sections = []
    for section in (facts.get("additional_sections", []) or []):
        entries = [_s(entry) for entry in (section.get("entries") or []) if _s(entry).strip()]
        if not entries:
            continue
        title = _s(section.get("section_title")).strip()
        additional_sections.append({
            "section_title": title or (_LABELS_AR if is_arabic else _LABELS_EN)["additional"],
            "entries": entries,
            # Per section, not per line: a CV section is written in one
            # language, and a heading and its bullets belong to each other.
            "dir": text_direction([title] + entries, "rtl" if is_arabic else "ltr"),
        })

    education = [
        {
            "institution": ar(edu.get("institution")),
            "degree": ar(edu.get("degree")),
            # GPA is a number; graduation_year can carry "2022-Current".
            "gpa": to_eastern_arabic_numerals(_s(edu.get("gpa"))) if is_arabic else _s(edu.get("gpa")),
            "graduation_year": localize_date(edu.get("graduation_year")) if is_arabic else _s(edu.get("graduation_year")),
            "distinctions": ar_list(edu.get("distinctions")),
            "relevant_coursework": ar_list(edu.get("relevant_coursework")),
        }
        for edu in (facts.get("education", []) or [])
    ]

    return {
        "personal": {
            # name comes verbatim from the uploaded CV when its script
            # matches this document's, and from the profile otherwise —
            # see resolve_candidate_name. Never glossary-translated on
            # either path. location is prose and gets localized.
            # email / phone / linkedin / github are IDENTIFIERS and must
            # render byte-for-byte — same rule pdf_generator.py's
            # _arabicize_prose already enforces for its own fields.
            "name": resolve_candidate_name(state),
            "email": _s(personal.get("email")),
            "phone": _s(personal.get("phone")),
            "location": ar(personal.get("location")),
            # Bare handles, never full URLs — every template renders these
            # behind a "linkedin.com/in/" / "github.com/" prefix of its own.
            # See _profile_handle.
            "linkedin": _profile_handle(personal.get("linkedin")),
            "github": _profile_handle(personal.get("github")),
        },
        "tagline": state.get("tagline") or None,
        # A JPEG data URI, or "" — see resolve_candidate_photo. Only the
        # photo-slot templates ever receive a non-empty value, and every one
        # of them guards it with `{% if photo %}`.
        "photo": resolve_candidate_photo(state, template_id),
        "tailored_summary": state.get("tailored_summary") or ar(facts.get("summary")),
        "experience": experience,
        "projects": projects,
        "skills": tailored_skills,
        "education": education,
        "certifications": ar_list(facts.get("certifications")),
        # display_volunteer is tailoring_engine's already-localized list when
        # the counts line up, and the raw facts list otherwise — only the
        # latter needs the glossary. See the note in the experience loop.
        "volunteer_work": (
            display_volunteer
            if display_volunteer is tailored_volunteer_work
            else ar_list(display_volunteer)
        ),
        # Raw facts, rendered verbatim — see the note above `training_courses`.
        # Blank entries are dropped rather than passed through: docx_generator's
        # _bullet() reads runs[0] on the paragraph it just created, and an empty
        # string produces a paragraph with no runs (IndexError, no .docx). The
        # schema's validators already strip empties out of a fresh extraction;
        # this also covers a re-render off an older stored snapshot, which never
        # goes through them.
        "major_achievements": [item for item in ar_list(facts.get("major_achievements")) if item.strip()],
        "training_courses": training_courses,
        "participation": participation,
        "publications": publications,
        "publications_dir": publications_dir,
        "teaching_and_editorial": [item for item in ar_list(facts.get("teaching_and_editorial")) if item.strip()],
        # `awards` was extracted by Agent 1 from the very first version of the
        # schema and never reached a template — it had no key in this context
        # at all, so every award on every CV was silently discarded at render
        # time. Same class of gap as the fields above, just older.
        "awards": [item for item in ar_list(facts.get("awards")) if item.strip()],
        # Human languages. Extracted by Agent 1 since the first version of the
        # schema and, like `awards` was, never given a key here — so no
        # template could render it and every CV silently lost its Languages
        # section. Localized like the other named fields: a language's name is
        # exactly the kind of term the Arabic glossary should translate.
        "languages_spoken": [item for item in ar_list(facts.get("languages_spoken")) if item.strip()],
        "additional_sections": additional_sections,
        "is_arabic": is_arabic,
        # Section headings / field labels for whichever language this CV is
        # in — see _LABELS_EN / _LABELS_AR. Templates must read these rather
        # than hardcoding English text.
        "labels": _LABELS_AR if is_arabic else _LABELS_EN,
        "template_id": template_id or DEFAULT_TEMPLATE_ID,
    }
