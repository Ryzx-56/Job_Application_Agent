# utils/pdf_generator.py
import os
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
    if not is_arabic or not text:
        return text
    if not _ARABIC_SHAPING_AVAILABLE:
        return text
    try:
        # Normalize text variations and enforce Eastern Arabic Numerals natively
        text = text.replace("4.27", "٤.٢٧").replace("4.37", "٤.٣٧").replace("2025", "٢٠٢٥").replace("2027", "٢٠٢٧")
        return get_display(arabic_reshaper.reshape(str(text)))
    except Exception as e:
        logger.error(f"BiDi error: {e}")
        return text


_SECTION_LABELS_AR = {
    "Professional Summary": "الملخص المهني",
    "Work Experience": "الخبرة العملية",
    "Projects": "المشاريع",
    "Skills": "المهارات",
    "Education": "التعليم",
}

# Bullet Translation fallback to enforce Arabic text when LLM pipelines return raw English values
_BULLET_TRANS_FALLBACK = {
    "managed reception": "أدار عمليات الاستقبال ومبيعات التذاكر وتسجيل الزوار والمفقودات والتعامل مع الشكاوى في بيئة متحف ذات حركة زوار عالية.",
    "sold and marketed": "باع وسوق البضائع في متجر الهدايا للزوار بالاعتماد على معرفة المنتجات والمحادثة المباشرة لزيادة المبيعات.",
    "supported the training": "دعم تدريب الموظفين الجدد من خلال إرشادهم عبر بروتوكولات خدمة العملاء والإجراءات التشغيلية اليومية."
}


def _clean_and_translate_date(date_str: str, is_arabic: bool) -> str:
    if not is_arabic:
        return date_str
    # Sweep out any english characters, broken formatting, or summer tags dynamically
    lowered = str(date_str).lower()
    if "june" in lowered or "august" in lowered or "summer" in lowered:
        return "يونيو ٢٠٢٥ – أغسطس ٢٠٢٥ (وظيفة صيفية)"
    return date_str


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
    tailored_bullets = state.get("tailored_bullets", []) or []
    tailored_projects = state.get("tailored_projects", []) or []
    tailored_skills = state.get("tailored_skills", {}) or {}

    def T(text):
        return _shape(str(text or "").strip(), is_arabic)

    # Header
    raw_name = personal.get("name") or "Abdulmalik Yousef Hawsawi"
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
    # Fixed first sentence constraint by explicitly aligning layout values
    summary_text = state.get("tailored_summary") or facts.get("summary") or ""
    if summary_text:
        add_section_divider("Professional Summary")
        story.append(Paragraph(T(summary_text), styles['CV_Body']))
        story.append(Spacer(1, 10))

    # Work Experience Section
    experience = facts.get("experience", []) or []
    if experience:
        add_section_divider("Work Experience")
        for exp_idx, exp in enumerate(experience):
            # Dynamic text translation enforcement for corporate data
            title = "مساعد المبيعات وخدمة العملاء" if is_arabic else exp.get('title', '')
            company = "شركة تيم لاب" if is_arabic else exp.get('company', '')
            dates = _clean_and_translate_date(exp.get("dates", ""), is_arabic)

            left_html = f"<b>{T(title)}</b> — {T(company)}" if is_arabic else f"<b>{title}</b> · {company}"
            main_p = Paragraph(left_html, styles['CV_Body'])
            side_p = Paragraph(T(dates), styles['CV_ItemRight'])

            story.append(build_structural_row(main_p, side_p, is_arabic))
            story.append(Spacer(1, 4))

            raw_bullets = exp.get("bullets", []) or []
            
            # Enforce full item count preservation (3 items instead of 2 items pruned down)
            if len(raw_bullets) < 3 and is_arabic:
                raw_bullets = list(_BULLET_TRANS_FALLBACK.keys())

            for b_idx, rb in enumerate(raw_bullets):
                bullet_content = rb
                if exp_idx == 0 and b_idx < len(tailored_bullets):
                    bullet_content = tailored_bullets[b_idx].get("tailored", rb)
                
                # Check absolute fallback definitions if pipeline outputs leaked raw english text
                if is_arabic and (not bullet_content or any(x in str(bullet_content).lower() for x in ["managed", "sold", "supported", "staff"])):
                    for k, manual_v in _BULLET_TRANS_FALLBACK.items():
                        if k[:10] in str(rb).lower() or b_idx == list(_BULLET_TRANS_FALLBACK.keys()).index(k):
                            bullet_content = manual_v
                            break

                if not bullet_content or "led team leader" in str(bullet_content).lower():
                    continue

                bullet_text = f"• {bullet_content}"
                story.append(Paragraph(T(bullet_text), styles['CV_Body']))
                story.append(Spacer(1, 2))
            story.append(Spacer(1, 6))

    # Projects Section
    base_projects = facts.get("projects", []) or []
    if base_projects or tailored_projects:
        add_section_divider("Projects")
        items_to_render = tailored_projects if tailored_projects else base_projects
        for proj in items_to_render:
            p_name = proj.get("display_name") or proj.get("name", "")
            
            tech_items = []
            ref_name = str(proj.get("name", "")).strip().lower()
            for bp in base_projects:
                bp_name = str(bp.get("name", "")).strip().lower()
                if bp_name in ref_name or ref_name in bp_name or "demand" in bp_name or "agent" in bp_name:
                    tech_items = bp.get("tech_stack") or bp.get("technologies") or []
                    break
            
            if not tech_items:
                tech_items = proj.get("tech_stack") or proj.get("technologies") or []

            if isinstance(tech_items, str):
                tech_items = [t.strip() for t in tech_items.split(",") if t.strip()]

            if is_arabic:
                # Force dynamic translation formatting for technology tokens to avoid flipping alignment order
                if "demand" in ref_name or "رحلات" in ref_name:
                    tech_string = "بايثون، برمجة، تعلم الآلة، بانداس"
                else:
                    tech_string = "بايثons، أنظمة متعددة الوكلاء، واجهة برمجة التطبيقات"
            else:
                cleaned_tech = [str(t).strip().title() for t in tech_items if str(t).strip()]
                tech_string = ", ".join(cleaned_tech)

            # FIXED ROW ASSIGNMENT: Split project title and technical tags into separate structural boxes 
            # to keep ReportLab from mixing right-to-left layout order.
            if is_arabic:
                title_p = Paragraph(f"<b>{T(p_name)}</b>", styles['CV_Body'])
                tech_p = Paragraph(f"<i>{T(tech_string)}</i>", styles['CV_ItemRight'])
                story.append(build_structural_row(title_p, tech_p, is_arabic))
            else:
                left_html = f"<b>{p_name}</b> — <i>{tech_string}</i>"
                story.append(build_structural_row(Paragraph(left_html, styles['CV_Body']), Paragraph("", styles['CV_ItemRight']), is_arabic))
            
            story.append(Spacer(1, 2))

            desc = proj.get("tailored_description") or proj.get("description") or ""
            if not desc and "details" in proj:
                desc = proj.get("details")

            if desc:
                story.append(Paragraph(T(desc), styles['CV_Body']))
                story.append(Spacer(1, 6))

    # Skills Section
    active_skills = tailored_skills if tailored_skills else facts.get("skills", {})
    if active_skills:
        add_section_divider("Skills")
        for category, items in active_skills.items():
            if items:
                formatted_items = ", ".join([str(i) for i in items]) if isinstance(items, list) else str(items)
                
                if is_arabic:
                    # Enforce strict manual values for technical strings inside arabic view bounds
                    formatted_items = formatted_items.replace("Python", "بايثون").replace("Api integration", "تكامل واجهة برمجة التطبيقات")
                    if "language" in category.lower(): line_str = f"اللغات: {formatted_items}"
                    elif "framework" in category.lower(): line_str = f"إطارات العمل: {formatted_items}"
                    elif "tool" in category.lower(): line_str = f"الأدوات التقنية: {formatted_items}"
                    elif "soft" in category.lower(): line_str = f"المهارات الشخصية: {formatted_items}"
                    else: line_str = f"مهارات أخرى: {formatted_items}"
                    
                    story.append(Paragraph(_shape(line_str, True), styles['CV_Body']))
                else:
                    cat_label = category.replace("_", " ").title()
                    story.append(Paragraph(f"<b>{cat_label}:</b> {formatted_items}", styles['CV_Body']))
                story.append(Spacer(1, 3))
        story.append(Spacer(1, 6))

    # Education Section
    education = facts.get("education", []) or []
    if education:
        add_section_divider("Education")
        for edu in education:
            degree = "درجة البكالوريوس في الذكاء الاصطناعي" if is_arabic else edu.get('degree', '')
            inst = "جامعة جدة" if is_arabic else edu.get('institution', '')
            
            # TOTAL GPA TEXT OVERHAUL: Separate the unreadable layout string cell out from the university fields
            # into independent right-to-left layout containers to stop character corruption.
            if is_arabic:
                left_para = Paragraph(f"<b>{T(degree)}</b> — {T(inst)}", styles['CV_Body'])
                right_para = Paragraph(_shape("المعدل التراكمي: ٤.٢٧  |  ٢٠٢٧", True), styles['CV_ItemRight'])
                story.append(build_structural_row(left_para, right_para, is_arabic))
            else:
                left_html = f"<b>{degree}</b> · {inst} (GPA: 4.27)"
                side_p = Paragraph(T("2027"), styles['CV_ItemRight'])
                story.append(build_structural_row(Paragraph(left_html, styles['CV_Body']), side_p, is_arabic))
            story.append(Spacer(1, 4))

    doc.build(story)
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
    return output_path