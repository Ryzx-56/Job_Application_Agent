# utils/pdf_generator.py
import os
import re
from datetime import date
from pathlib import Path

import jinja2
from loguru import logger

from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# NOTE: the cover letter is still ReportLab (see comment further down), so
# unlike the CV path it does NOT get Pango's automatic Arabic shaping/bidi
# for free from WeasyPrint. It needs its own shaping step, same as the old
# pre-WeasyPrint CV code used to. If arabic_reshaper/python-bidi aren't
# installed, Arabic cover letters fall back to unshaped text rather than
# crashing - isolated letters are a visible bug, a 500 is a worse one.
try:
    import arabic_reshaper
    from bidi.algorithm import get_display
    _ARABIC_SHAPING_AVAILABLE = True
except ImportError:
    _ARABIC_SHAPING_AVAILABLE = False

from utils.template_registry import resolve_template_path, DEFAULT_TEMPLATE_ID
from utils.cv_context import build_cv_context
from utils.fit_to_page import render_html_fit_to_page

OUTPUT_DIR = "outputs"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# ---------------------------------------------------------------------------
# Arabic content-level translation (kept from the old ReportLab version).
#
# DELETED vs. the old file: arabic_reshaper / python-bidi and all the manual
# glyph-shaping + bidi-reordering + font-switching-via-regex code. WeasyPrint
# renders through Pango/cairo, which does real Arabic text shaping and bidi
# automatically from `direction: rtl` + normal Unicode text - none of that
# hand-rolled logic is needed anymore, and it was also the prior root cause
# of the "isolated Arabic letters" bug (silent fallback when arabic_reshaper
# failed to import). That whole bug class goes away with this rewrite.
#
# KEPT: digit transliteration and month-name translation. Those are CONTENT
# decisions (what characters the text should contain), not shaping - Pango
# won't do "January" -> "يناير" or "5" -> "٥" on its own.
# ---------------------------------------------------------------------------

_EASTERN_ARABIC_DIGITS = str.maketrans("0123456789", "٠١٢٣٤٥٦٧٨٩")

_MONTH_AR = {
    "january": "يناير", "february": "فبراير", "march": "مارس", "april": "أبريل",
    "may": "مايو", "june": "يونيو", "july": "يوليو", "august": "أغسطس",
    "september": "سبتمبر", "october": "أكتوبر", "november": "نوفمبر", "december": "ديسمبر",
    "present": "حتى الآن",
}


def _to_eastern_arabic_numerals(text: str) -> str:
    return text.translate(_EASTERN_ARABIC_DIGITS)


def _translate_date_terms(date_str: str) -> str:
    if not date_str:
        return date_str
    result = str(date_str)
    for en, ar in _MONTH_AR.items():
        result = re.sub(rf"\b{en}\b", ar, result, flags=re.IGNORECASE)
    return result


def _arabicize_prose(context: dict) -> None:
    """
    Mutates `context` in place: digit transliteration + month translation on
    PROSE fields only (dates, GPA, grad year). Deliberately never touches
    personal.email / personal.linkedin / personal.github - those are
    identifiers and must render byte-for-byte, same rule the old ReportLab
    code enforced (a corrupted email/link silently breaks).
    """
    for exp in context.get("experience", []):
        exp["dates"] = _to_eastern_arabic_numerals(_translate_date_terms(exp.get("dates", "")))
    for edu in context.get("education", []):
        if edu.get("gpa"):
            edu["gpa"] = _to_eastern_arabic_numerals(str(edu["gpa"]))
        if edu.get("graduation_year"):
            edu["graduation_year"] = _to_eastern_arabic_numerals(str(edu["graduation_year"]))


# ---------------------------------------------------------------------------
# Arabic RTL + font override, injected as CSS rather than baked into every
# template file - applies uniformly no matter which of the 11 templates is
# chosen, and keeps the template files themselves free of Arabic-specific
# markup.
# ---------------------------------------------------------------------------

ASSETS_FONT_DIR = Path(__file__).parent.parent / "assets" / "fonts"
_ARABIC_FONT_REGULAR = ASSETS_FONT_DIR / "NotoNaskhArabic-Regular.ttf"
_ARABIC_FONT_BOLD = ASSETS_FONT_DIR / "NotoNaskhArabic-Bold.ttf"


# Register the same font files with ReportLab (separate registry from
# WeasyPrint/Pango) so render_cover_letter_pdf can reference them by name.
# This runs once at import time; failures are logged, not raised, since a
# missing font asset shouldn't take down English cover letters too.
_ARABIC_FONT_NAME = "NotoNaskhArabic"
_ARABIC_FONT_NAME_BOLD = "NotoNaskhArabic-Bold"
_ARABIC_REPORTLAB_FONT_REGISTERED = False

if _ARABIC_FONT_REGULAR.exists():
    try:
        pdfmetrics.registerFont(TTFont(_ARABIC_FONT_NAME, str(_ARABIC_FONT_REGULAR)))
        pdfmetrics.registerFont(TTFont(
            _ARABIC_FONT_NAME_BOLD,
            str(_ARABIC_FONT_BOLD if _ARABIC_FONT_BOLD.exists() else _ARABIC_FONT_REGULAR),
        ))
        _ARABIC_REPORTLAB_FONT_REGISTERED = True
    except Exception as e:
        logger.error(f"❌ Failed to register Arabic font with ReportLab: {e}")
else:
    logger.warning(f"Arabic font asset missing at: {_ARABIC_FONT_REGULAR} (cover letter Arabic will fall back to Helvetica)")


def _shape_arabic(text: str) -> str:
    """
    ReportLab draws Unicode glyphs left-to-right in logical order and does
    NOT do Arabic contextual shaping or bidi reordering on its own (unlike
    WeasyPrint/Pango on the CV path). Without this step, Arabic text either
    shows as isolated, unconnected letters or - if paired with a font that
    truly has no Arabic glyphs at all, as with the old Helvetica default -
    as tofu boxes. Run every Arabic prose string through this before handing
    it to a Paragraph().
    """
    if not text or not _ARABIC_SHAPING_AVAILABLE:
        return text
    try:
        return get_display(arabic_reshaper.reshape(text))
    except Exception as e:
        logger.error(f"❌ Arabic shaping failed, rendering unshaped: {e}")
        return text


def _arabic_override_css() -> str:
    regular_uri = _ARABIC_FONT_REGULAR.as_uri() if _ARABIC_FONT_REGULAR.exists() else None
    bold_uri = _ARABIC_FONT_BOLD.as_uri() if _ARABIC_FONT_BOLD.exists() else regular_uri

    font_face = ""
    if regular_uri:
        font_face = f"""
        @font-face {{ font-family: 'Arabic'; src: url('{regular_uri}'); font-weight: normal; }}
        @font-face {{ font-family: 'Arabic'; src: url('{bold_uri}'); font-weight: bold; }}
        """
    else:
        logger.warning(f"Arabic font asset missing at: {_ARABIC_FONT_REGULAR}")

    return f"""
    <style>
      {font_face}
      body, body * {{
        font-family: 'Arabic', 'Noto Naskh Arabic', sans-serif !important;
        direction: rtl;
      }}
      body {{ text-align: right; }}
      .entry-header {{ flex-direction: row-reverse; }}
      ul.bullets {{ margin-right: 18px; margin-left: 0 !important; padding-right: 0; }}
      /* Identifiers stay LTR even inside an RTL document */
      a[href^="mailto"], a[href*="linkedin.com"], a[href*="github.com"] {{
        direction: ltr; unicode-bidi: embed; font-family: inherit !important;
      }}
    </style>
    """


def _inject_arabic_overrides(html: str) -> str:
    return html.replace("</head>", _arabic_override_css() + "</head>")


# ---------------------------------------------------------------------------
# Jinja environment over templates/ (shared across every template, resolved
# per-render via utils/template_registry.py)
# ---------------------------------------------------------------------------

_TEMPLATES_DIR = Path(__file__).parent.parent / "templates"
_jinja_env = jinja2.Environment(loader=jinja2.FileSystemLoader(str(_TEMPLATES_DIR)))


def render_cv_pdf(state: dict, template_id: str | None = None) -> str:
    """
    Renders the tailored CV to PDF using the chosen template. Falls back to
    DEFAULT_TEMPLATE_ID if template_id is None or unrecognized (see
    resolve_template_path) - this is what makes "user didn't pick a
    template" behave correctly from the dashboard.
    """
    output_path = os.path.join(OUTPUT_DIR, "tailored_cv.pdf")

    resolved_template_id = template_id or DEFAULT_TEMPLATE_ID
    template_filename = resolve_template_path(resolved_template_id).name

    context = build_cv_context(state, template_id=resolved_template_id)
    if context["is_arabic"]:
        _arabicize_prose(context)

    transform = _inject_arabic_overrides if context["is_arabic"] else None

    pdf_bytes = render_html_fit_to_page(
        jinja_env=_jinja_env,
        template_name=template_filename,
        context=context,
        base_url=str(_TEMPLATES_DIR),
        html_transform=transform,
    )

    with open(output_path, "wb") as f:
        f.write(pdf_bytes)

    logger.info(f"✅ CV PDF saved → {output_path} (template: {resolved_template_id})")
    return output_path


# ---------------------------------------------------------------------------
# Cover letter PDF - still ReportLab (unlike the CV, which moved to
# WeasyPrint). cover_letter_template.html exists in templates/ but its
# content hasn't been shared yet, so a full WeasyPrint conversion is still
# pending - send it over for that treatment, including a template picker.
#
# FIXED here: Arabic cover letters were rendering as tofu boxes because
# CL_Body was hardcoded to fontName="Helvetica", which has no Arabic
# glyphs at all - this is a different bug from the old "isolated letters"
# CV issue (font simply couldn't draw the characters, vs. drawing them
# unshaped). Now uses the same NotoNaskhArabic asset as the CV, registered
# separately for ReportLab, plus manual shaping/bidi (see _shape_arabic)
# since ReportLab - unlike WeasyPrint/Pango - doesn't do that automatically.
# ---------------------------------------------------------------------------

def _cover_letter_styles(is_arabic: bool):
    styles = getSampleStyleSheet()
    TEXT_COLOR = colors.HexColor("#2D3748")

    if is_arabic and _ARABIC_REPORTLAB_FONT_REGISTERED:
        styles.add(ParagraphStyle(
            name='CL_Body', fontName=_ARABIC_FONT_NAME, fontSize=11, leading=18,
            alignment=TA_RIGHT, textColor=TEXT_COLOR,
        ))
        styles.add(ParagraphStyle(
            name='CL_Bold', fontName=_ARABIC_FONT_NAME_BOLD, fontSize=11, leading=18,
            alignment=TA_RIGHT, textColor=TEXT_COLOR,
        ))
    else:
        styles.add(ParagraphStyle(name='CL_Body', fontName="Helvetica", fontSize=10, leading=15, alignment=TA_LEFT, textColor=TEXT_COLOR))
        styles.add(ParagraphStyle(name='CL_Bold', fontName="Helvetica-Bold", fontSize=10, leading=15, alignment=TA_LEFT, textColor=TEXT_COLOR))

    return styles


def render_cover_letter_pdf(state: dict) -> str:
    output_path = os.path.join(OUTPUT_DIR, "cover_letter.pdf")

    is_arabic = str(state.get("cv_language", "en")).lower().startswith("ar")
    if is_arabic and not _ARABIC_REPORTLAB_FONT_REGISTERED:
        logger.warning("Arabic cover letter requested but the Arabic font isn't registered — falling back to Helvetica (will show tofu boxes).")

    def body(text: str) -> str:
        """Shape+reorder Arabic prose; pass English straight through."""
        return _shape_arabic(text) if is_arabic else text

    # RTL documents still read left-to-right for the page margins ReportLab
    # itself lays out (it's the text direction *inside* each paragraph that
    # flips, via TA_RIGHT + shaping) - margins stay symmetric either way.
    doc = SimpleDocTemplate(output_path, pagesize=letter, leftMargin=54, rightMargin=54, topMargin=54, bottomMargin=54)
    styles = _cover_letter_styles(is_arabic)
    story = []

    facts = state.get("facts_json", {}) or {}
    personal = facts.get("personal", {}) or {}
    wf = state.get("weight_factors", {}) or {}

    name = personal.get("name") or ("اسم المتقدم" if is_arabic else "Candidate Name")
    story.append(Paragraph(f"<b>{body(name)}</b>", styles['CL_Bold']))
    if personal.get("location"):
        story.append(Paragraph(body(personal["location"]), styles['CL_Body']))
    if personal.get("email"):
        # Identifiers stay LTR and unshaped even inside an Arabic letter -
        # same rule the CV path enforces for email/LinkedIn/GitHub.
        story.append(Paragraph(personal["email"], styles['CL_Body']))
    story.append(Spacer(1, 15))

    today_str = date.today().strftime("%B %d, %Y")
    if is_arabic:
        today_str = _to_eastern_arabic_numerals(_translate_date_terms(today_str))
    story.append(Paragraph(body(today_str) if is_arabic else today_str, styles['CL_Body']))
    story.append(Spacer(1, 15))

    company = wf.get("company")
    job_title = wf.get("job_title")
    hiring_team_label = "فريق التوظيف" if is_arabic else "Hiring Team"
    story.append(Paragraph(body(hiring_team_label), styles['CL_Body']))
    if company:
        # Company names are usually proper nouns/Latin script even in an
        # Arabic letter - shaping is a harmless no-op on non-Arabic text.
        story.append(Paragraph(body(company) if is_arabic else company, styles['CL_Body']))
    story.append(Spacer(1, 15))
    if job_title:
        re_label = f"الموضوع: التقديم على وظيفة {job_title}" if is_arabic else f"RE: Application for {job_title}"
        story.append(Paragraph(f"<b>{body(re_label)}</b>", styles['CL_Bold']))
        story.append(Spacer(1, 15))

    dear_label = "السادة فريق التوظيف المحترمين،" if is_arabic else "Dear Hiring Team,"
    story.append(Paragraph(body(dear_label), styles['CL_Body']))
    story.append(Spacer(1, 10))

    letter_text = state.get("cover_letter_text") or ""
    for para in [p.strip() for p in letter_text.split('\n') if p.strip()]:
        story.append(Paragraph(body(para), styles['CL_Body']))
        story.append(Spacer(1, 12))

    story.append(Spacer(1, 8))
    sincerely_label = "مع خالص التقدير،" if is_arabic else "Sincerely,"
    story.append(Paragraph(body(sincerely_label), styles['CL_Body']))
    story.append(Spacer(1, 20))
    story.append(Paragraph(body(name), styles['CL_Body']))

    doc.build(story)
    logger.info(f"✅ Cover letter PDF saved → {output_path}")
    return output_path
