# utils/pdf_generator.py
import os
import re
from datetime import date
from loguru import logger

from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

try:
    import arabic_reshaper
    from bidi.algorithm import get_display
    _ARABIC_SHAPING_AVAILABLE = True
except ImportError:
    _ARABIC_SHAPING_AVAILABLE = False

OUTPUT_DIR = "outputs"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Word renders Arabic shaping/bidi natively, so unlike docx_generator.py we
# DO need reshaping + bidi here (ReportLab has no built-in Arabic support).
ARABIC_FONT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "assets", "fonts")
ARABIC_FONT_REGULAR_PATH = os.path.join(ARABIC_FONT_DIR, "NotoNaskhArabic-Regular.ttf")
ARABIC_FONT_BOLD_PATH = os.path.join(ARABIC_FONT_DIR, "NotoNaskhArabic-Bold.ttf")
ARABIC_FONT_NAME = "Arabic"
ARABIC_FONT_BOLD_NAME = "Arabic-Bold"

_arabic_fonts_registered = False
_arabic_fonts_ready = False


def _ensure_arabic_fonts():
    global _arabic_fonts_registered, _arabic_fonts_ready
    if _arabic_fonts_registered:
        return
    if not os.path.exists(ARABIC_FONT_REGULAR_PATH):
        logger.warning(f"Arabic font asset missing at: {ARABIC_FONT_REGULAR_PATH}")
        return
    try:
        pdfmetrics.registerFont(TTFont(ARABIC_FONT_NAME, ARABIC_FONT_REGULAR_PATH))
        bold_path = ARABIC_FONT_BOLD_PATH if os.path.exists(ARABIC_FONT_BOLD_PATH) else ARABIC_FONT_REGULAR_PATH
        pdfmetrics.registerFont(TTFont(ARABIC_FONT_BOLD_NAME, bold_path))
        _arabic_fonts_ready = True
    except Exception as e:
        logger.error(f"Failed to register Arabic font: {e}")


def _shape(text: str, is_arabic: bool) -> str:
    """Reshape + apply BiDi so Arabic renders correctly in ReportLab. Uses
    Eastern Arabic (Hindi) numerals for any digit in the text, generically —
    not tied to any specific candidate's numbers."""
    if not is_arabic or not text:
        return text
    if not _ARABIC_SHAPING_AVAILABLE:
        return text
    try:
        text = _to_eastern_arabic_numerals(str(text))
        return get_display(arabic_reshaper.reshape(text))
    except Exception as e:
        logger.error(f"BiDi error: {e}")
        return text


_EASTERN_ARABIC_DIGITS = str.maketrans("0123456789", "٠١٢٣٤٥٦٧٨٩")


def _to_eastern_arabic_numerals(text: str) -> str:
    """Generic digit transliteration — converts every 0-9 digit found in the
    string, regardless of what number it's part of (GPA, year, phone, etc.)."""
    return text.translate(_EASTERN_ARABIC_DIGITS)


_SECTION_LABELS_AR = {
    "Professional Summary": "الملخص المهني",
    "Work Experience": "الخبرة العملية",
    "Projects": "المشاريع",
    "Skills": "المهارات",
    "Education": "التعليم",
}

_MONTH_AR = {
    "january": "يناير", "february": "فبراير", "march": "مارس", "april": "أبريل",
    "may": "مايو", "june": "يونيو", "july": "يوليو", "august": "أغسطس",
    "september": "سبتمبر", "october": "أكتوبر", "november": "نوفمبر", "december": "ديسمبر",
    "present": "حتى الآن",
}


def _translate_date_terms(date_str: str, is_arabic: bool) -> str:
    """Generic English month-name / 'Present' translation for Arabic CVs.
    Only swaps known date vocabulary via word-boundary regex — years,
    separators, and anything else in the string pass through untouched.
    This replaces a previous version that overwrote entire date strings with
    one hardcoded date range regardless of the candidate's actual dates."""
    if not is_arabic or not date_str:
        return date_str
    result = str(date_str)
    for en, ar in _MONTH_AR.items():
        result = re.sub(rf"\b{en}\b", ar, result, flags=re.IGNORECASE)
    return result


def build_pdf_styles(is_arabic: bool = False):
    if is_arabic:
        _ensure_arabic_fonts()
    styles = getSampleStyleSheet()
    PRIMARY_COLOR = colors.HexColor("#1A365D")
    TEXT_COLOR = colors.HexColor("#2D3748")

    regular_font = ARABIC_FONT_NAME if (is_arabic and _arabic_fonts_ready) else "Helvetica"
    bold_font = ARABIC_FONT_BOLD_NAME if (is_arabic and _arabic_fonts_ready) else "Helvetica-Bold"
    
    body_align = TA_RIGHT if is_arabic else TA_LEFT
    side_align = TA_LEFT if is_arabic else TA_RIGHT

    styles.add(ParagraphStyle(
        name='CV_Name', fontName=bold_font, fontSize=20, leading=24, alignment=TA_CENTER, textColor=PRIMARY_COLOR
    ))
    styles.add(ParagraphStyle(
        name='CV_Contact', fontName=regular_font, fontSize=9, leading=13, alignment=TA_CENTER, textColor=TEXT_COLOR
    ))
    styles.add(ParagraphStyle(
        name='CV_SectionHeading', fontName=bold_font, fontSize=12, leading=16, alignment=body_align, textColor=PRIMARY_COLOR, spaceBefore=12, spaceAfter=4
    ))
    styles.add(ParagraphStyle(
        name='CV_Body', fontName=regular_font, fontSize=10, leading=15, alignment=body_align, textColor=TEXT_COLOR
    ))
    styles.add(ParagraphStyle(
        name='CV_ItemRight', fontName=regular_font, fontSize=10, leading=15, alignment=side_align, textColor=TEXT_COLOR
    ))
    return styles


def build_structural_row(left_para, right_para, is_arabic: bool):
    if is_arabic:
        row = [[right_para, left_para]]
        widths = [180, 360]
    else:
        row = [[left_para, right_para]]
        widths = [360, 180]
    t = Table(row, colWidths=widths)
    t.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('LEFTPADDING', (0,0), (-1,-1), 0),
        ('RIGHTPADDING', (0,0), (-1,-1), 0),
    ]))
    return t


def render_cv_pdf(state: dict) -> str:
    output_path = os.path.join(OUTPUT_DIR, "tailored_cv.pdf")
    doc = SimpleDocTemplate(output_path, pagesize=letter, leftMargin=36, rightMargin=36, topMargin=36, bottomMargin=36)
    
    is_arabic = state.get("cv_language", "en") == "ar"
    styles = build_pdf_styles(is_arabic)
    story = []

    facts = state.get("facts_json", {}) or {}
    personal = facts.get("personal", {}) or {}

    # Tailored (Agent 3) content, falling back to raw facts_json — mirrors
    # utils/docx_generator.py's lookup pattern so PDF and DOCX stay in sync,
    # and so every bullet/project is matched by its actual content instead
    # of by list position (position-based matching breaks the moment Agent 3
    # reorders bullets to lead with the most relevant ones, which the
    # tailoring prompt explicitly allows it to do).
    tailored_skills = state.get("tailored_skills") or facts.get("skills", {}) or {}
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
    tailored_volunteer_work = state.get("tailored_volunteer_work", []) or []

    def T(text):
        return _shape(str(text or "").strip(), is_arabic)

    # Header
    raw_name = personal.get("name") or "Candidate Name"
    story.append(Paragraph(T(raw_name), styles['CV_Name']))
    story.append(Spacer(1, 4))

    contact_info = []
    if personal.get("email"): contact_info.append(personal["email"])
    if personal.get("location"): contact_info.append(personal["location"])
    if personal.get("linkedin"): contact_info.append(f"LinkedIn: {personal['linkedin']}")
    if personal.get("github"): contact_info.append(f"GitHub: {personal['github']}")

    contact_str = "  |  ".join(reversed(contact_info) if is_arabic else contact_info)
    story.append(Paragraph(T(contact_str), styles['CV_Contact']))
    story.append(Spacer(1, 10))

    def add_section_divider(en_title):
        lbl = _SECTION_LABELS_AR.get(en_title, en_title.upper()) if is_arabic else en_title.upper()
        story.append(Paragraph(T(lbl), styles['CV_SectionHeading']))
        t = Table([['']], colWidths=[540], rowHeights=[1])
        t.setStyle(TableStyle([
            ('LINEABOVE', (0,0), (-1,-1), 0.75, colors.HexColor("#CBD5E0")),
            ('BOTTOMPADDING', (0,0), (-1,-1), 0), ('TOPPADDING', (0,0), (-1,-1), 0)
        ]))
        story.append(t)
        story.append(Spacer(1, 6))

    # Summary Section
    summary_text = state.get("tailored_summary") or facts.get("summary") or ""
    if summary_text:
        add_section_divider("Professional Summary")
        story.append(Paragraph(T(summary_text), styles['CV_Body']))
        story.append(Spacer(1, 10))

    # Work Experience Section
    experience = facts.get("experience", []) or []
    if experience:
        add_section_divider("Work Experience")
        for exp in experience:
            title = exp.get('title', '')
            company = exp.get('company', '')
            dates = _translate_date_terms(exp.get("dates", ""), is_arabic)

            left_html = f"<b>{T(title)}</b> — {T(company)}" if is_arabic else f"<b>{title}</b> · {company}"
            main_p = Paragraph(left_html, styles['CV_Body'])
            side_p = Paragraph(T(dates), styles['CV_ItemRight'])

            story.append(build_structural_row(main_p, side_p, is_arabic))
            story.append(Spacer(1, 4))

            for raw_bullet in exp.get("bullets", []) or []:
                bullet_content = bullet_lookup.get(raw_bullet.strip(), raw_bullet)
                if not bullet_content:
                    continue

                bullet_text = f"• {bullet_content}"
                story.append(Paragraph(T(bullet_text), styles['CV_Body']))
                story.append(Spacer(1, 2))
            story.append(Spacer(1, 6))

    # Projects Section
    base_projects = facts.get("projects", []) or []
    if base_projects:
        add_section_divider("Projects")
        for base_proj in base_projects:
            name = (base_proj.get("name") or "").strip()
            tailored = project_lookup.get(name)
            display_name = (tailored.get("display_name") if tailored else None) or name
            desc = (tailored.get("tailored_description") if tailored else None) or base_proj.get("description", "")

            tech_items = base_proj.get("tech_stack") or base_proj.get("technologies") or []
            if isinstance(tech_items, str):
                tech_items = [t.strip() for t in tech_items.split(",") if t.strip()]
            cleaned_tech = [str(t).strip() for t in tech_items if str(t).strip()]
            tech_string = "، ".join(cleaned_tech) if is_arabic else ", ".join(
                t.title() for t in cleaned_tech
            )

            # Project title and tech tags go in separate structural table
            # cells (rather than one concatenated string) so ReportLab
            # doesn't mangle right-to-left ordering when mixing Latin tech
            # names into an Arabic line.
            if is_arabic:
                title_p = Paragraph(f"<b>{T(display_name)}</b>", styles['CV_Body'])
                tech_p = Paragraph(f"<i>{T(tech_string)}</i>" if tech_string else "", styles['CV_ItemRight'])
                story.append(build_structural_row(title_p, tech_p, is_arabic))
            else:
                left_html = f"<b>{display_name}</b>" + (f" — <i>{tech_string}</i>" if tech_string else "")
                story.append(build_structural_row(Paragraph(left_html, styles['CV_Body']), Paragraph("", styles['CV_ItemRight']), is_arabic))

            story.append(Spacer(1, 2))

            if desc:
                story.append(Paragraph(T(desc), styles['CV_Body']))
                story.append(Spacer(1, 6))

    # Skills Section
    active_skills = tailored_skills if tailored_skills else facts.get("skills", {})
    if active_skills:
        add_section_divider("Skills")
        category_labels_ar = {
            "languages": "اللغات البرمجية",
            "frameworks": "أطر العمل",
            "tools": "الأدوات",
            "soft_skills": "المهارات الشخصية",
            "other": "أخرى",
        }
        for category, items in active_skills.items():
            if items:
                formatted_items = ", ".join([str(i) for i in items]) if isinstance(items, list) else str(items)
                if is_arabic:
                    label = category_labels_ar.get(category, category)
                    line_str = f"{label}: {formatted_items}"
                    story.append(Paragraph(_shape(line_str, True), styles['CV_Body']))
                else:
                    cat_label = category.replace("_", " ").title()
                    story.append(Paragraph(f"<b>{cat_label}:</b> {formatted_items}", styles['CV_Body']))
                story.append(Spacer(1, 3))
        story.append(Spacer(1, 6))

    # Volunteer Work Section
    raw_volunteer_work = facts.get("volunteer_work", []) or []
    if raw_volunteer_work:
        add_section_divider("Volunteer Work" if not is_arabic else "الأعمال التطوعية")
        display_volunteer = (
            tailored_volunteer_work
            if len(tailored_volunteer_work) == len(raw_volunteer_work)
            else raw_volunteer_work
        )
        for v in display_volunteer:
            story.append(Paragraph(T(f"• {v}"), styles['CV_Body']))
            story.append(Spacer(1, 2))
        story.append(Spacer(1, 6))

    # Education Section
    education = facts.get("education", []) or []
    if education:
        add_section_divider("Education")
        for edu in education:
            degree = edu.get('degree', '')
            inst = edu.get('institution', '')
            gpa = edu.get('gpa')
            grad_year = edu.get('graduation_year', '') or ''

            if is_arabic:
                left_para = Paragraph(f"<b>{T(degree)}</b> — {T(inst)}", styles['CV_Body'])
                right_bits = []
                if gpa:
                    right_bits.append(f"{_shape('المعدل التراكمي', True)}: {_shape(str(gpa), True)}")
                if grad_year:
                    right_bits.append(_shape(str(grad_year), True))
                right_para = Paragraph("  |  ".join(right_bits), styles['CV_ItemRight'])
                story.append(build_structural_row(left_para, right_para, is_arabic))
            else:
                left_html = f"<b>{degree}</b> · {inst}" + (f" (GPA: {gpa})" if gpa else "")
                side_p = Paragraph(T(grad_year), styles['CV_ItemRight'])
                story.append(build_structural_row(Paragraph(left_html, styles['CV_Body']), side_p, is_arabic))
            story.append(Spacer(1, 4))

    doc.build(story)
    logger.info(f"✅ CV PDF saved → {output_path}")
    return output_path


def render_cover_letter_pdf(state: dict) -> str:
    output_path = os.path.join(OUTPUT_DIR, "cover_letter.pdf")
    doc = SimpleDocTemplate(output_path, pagesize=letter, leftMargin=54, rightMargin=54, topMargin=54, bottomMargin=54)
    
    is_arabic = state.get("cv_language", "en") == "ar"
    styles = build_pdf_styles(is_arabic)
    story = []

    facts = state.get("facts_json", {}) or {}
    personal = facts.get("personal", {}) or {}
    wf = state.get("weight_factors", {}) or {}

    def T(text):
        return _shape(text, is_arabic)

    name = personal.get("name") or "Candidate Name"
    story.append(Paragraph(f"<b>{T(name)}</b>", styles['CV_Body']))
    if personal.get("location"): story.append(Paragraph(T(personal["location"]), styles['CV_Body']))
    if personal.get("email"): story.append(Paragraph(personal["email"], styles['CV_Body']))
    story.append(Spacer(1, 15))

    story.append(Paragraph(date.today().strftime("%B %d, %Y"), styles['CV_Body']))
    story.append(Spacer(1, 15))

    def _known_or_none(value):
        # jd_analyzer stores the literal string "Unknown" (not None/empty)
        # when it can't extract a field from the JD, which slips right past
        # a plain `or` fallback since "Unknown" is truthy. Treat it the same
        # as missing.
        v = str(value or "").strip()
        return None if (not v or v.lower() == "unknown") else v

    company = _known_or_none(wf.get("company"))
    job_title = _known_or_none(wf.get("job_title"))

    hiring_team = "فريق التوظيف" if is_arabic else "Hiring Team"
    story.append(Paragraph(T(hiring_team), styles['CV_Body']))
    if company:
        story.append(Paragraph(T(company), styles['CV_Body']))
    story.append(Spacer(1, 15))

    if job_title:
        subject = f"الموضوع: التقديم على وظيفة {T(job_title)}" if is_arabic else f"RE: Application for {job_title}"
        story.append(Paragraph(f"<b>{T(subject)}</b>", styles['CV_Body']))
        story.append(Spacer(1, 15))

    salutation = "السادة الأفاضل في فريق التوظيف المحترمين،" if is_arabic else "Dear Hiring Team,"
    story.append(Paragraph(T(salutation), styles['CV_Body']))
    story.append(Spacer(1, 10))

    letter_text = state.get("cover_letter_text") or ""
    for para in [p.strip() for p in letter_text.split('\n') if p.strip()]:
        story.append(Paragraph(T(para), styles['CV_Body']))
        story.append(Spacer(1, 12))

    story.append(Spacer(1, 8))
    story.append(Paragraph(T("مع خالص التقدير،" if is_arabic else "Sincerely,"), styles['CV_Body']))
    story.append(Spacer(1, 20))
    story.append(Paragraph(T(name), styles['CV_Body']))

    doc.build(story)
    logger.info(f"✅ Cover letter PDF saved → {output_path}")
    return output_path
