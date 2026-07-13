# utils/pdf_generator.py
import os
from datetime import date
from loguru import logger

# ReportLab Imports
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, ListFlowable, ListItem

OUTPUT_DIR = "outputs"
os.makedirs(OUTPUT_DIR, exist_ok=True)

_SMALL_WORDS = {"a", "an", "and", "as", "at", "but", "by", "for", "in", "nor",
                "of", "on", "or", "so", "the", "to", "up", "yet", "with"}


def _smart_title_case(text: str) -> str:
    """
    Capitalizes headings (project names, job titles, company names, degrees)
    without mangling acronyms or intentional casing.

    Root cause this exists for: cv_parser.py's Agent 1 (Gemini) is correctly
    forbidden from rephrasing facts — so if a candidate typed a project name
    in lowercase, it stays lowercase in facts_json (that's correct extraction
    behavior). This function is a purely cosmetic, deterministic display-layer
    fix — it never touches facts_json, only what gets rendered.

    - Words that are already ALL CAPS (len > 1) are treated as acronyms and
      left untouched (e.g. "API", "CV", "ATS").
    - Words with an internal capital letter are treated as intentional
      stylization and left untouched (e.g. "LinkedIn", "iOS", "GitHub").
    - Minor words (a, an, of, the, ...) are lowercased unless first/last word.
    - Everything else gets a single leading capital.
    """
    if not text:
        return text
    words = text.split(" ")
    result = []
    for i, word in enumerate(words):
        if not word:
            result.append(word)
            continue
        core = word.strip("()[]{}.,;:\"'")
        if core.isupper() and len(core) > 1:
            result.append(word)
            continue
        if any(c.isupper() for c in core[1:]):
            result.append(word)
            continue
        lower = word.lower()
        if 0 < i < len(words) - 1 and lower.strip("()[]{}.,;:\"'") in _SMALL_WORDS:
            result.append(lower)
            continue
        result.append(word[:1].upper() + word[1:].lower() if word[:1].isalpha() else word)
    return " ".join(result)


def build_pdf_styles():
    """Initializes and returns custom typography styles for an ATS-friendly look."""
    styles = getSampleStyleSheet()
    
    # Custom Palette
    PRIMARY_COLOR = colors.HexColor("#1A365D")  # Deep Navy
    TEXT_COLOR = colors.HexColor("#2D3748")     # Charcoal
    
    styles.add(ParagraphStyle(
        name='CV_Name',
        fontName='Helvetica-Bold',
        fontSize=20,
        leading=24,
        alignment=TA_CENTER,
        textColor=PRIMARY_COLOR
    ))
    
    styles.add(ParagraphStyle(
        name='CV_Contact',
        fontName='Helvetica',
        fontSize=9,
        leading=13,
        alignment=TA_CENTER,
        textColor=TEXT_COLOR
    ))
    
    styles.add(ParagraphStyle(
        name='CV_SectionHeading',
        fontName='Helvetica-Bold',
        fontSize=12,
        leading=16,
        textColor=PRIMARY_COLOR,
        spaceBefore=10,
        spaceAfter=4
    ))
    
    styles.add(ParagraphStyle(
        name='CV_Body',
        fontName='Helvetica',
        fontSize=10,
        leading=14,
        textColor=TEXT_COLOR
    ))

    styles.add(ParagraphStyle(
        name='CV_Body_Bold',
        fontName='Helvetica-Bold',
        fontSize=10,
        leading=14,
        textColor=TEXT_COLOR
    ))

    styles.add(ParagraphStyle(
        name='CV_ItemRight',
        fontName='Helvetica',
        fontSize=10,
        leading=14,
        alignment=TA_RIGHT,
        textColor=TEXT_COLOR
    ))
    
    return styles


def _build_bullet_lookup(tailored_bullets: list) -> dict:
    """original bullet text (stripped) -> tailored bullet text."""
    lookup = {}
    for b in tailored_bullets or []:
        original = (b.get("original") or "").strip()
        tailored = (b.get("tailored") or "").strip()
        if original and tailored:
            lookup[original] = tailored
    return lookup


def _build_project_lookup(tailored_projects: list) -> dict:
    """project name (stripped) -> {"display_name": str, "description": str}."""
    lookup = {}
    for p in tailored_projects or []:
        name = (p.get("name") or "").strip()
        desc = (p.get("tailored_description") or "").strip()
        display_name = (p.get("display_name") or "").strip()
        if name and desc:
            lookup[name] = {"display_name": display_name or name, "description": desc}
    return lookup


def render_cv_pdf(state: dict) -> str:
    """Renders tailored CV to PDF using ReportLab flowables."""
    output_path = os.path.join(OUTPUT_DIR, "tailored_cv.pdf")
    
    doc = SimpleDocTemplate(
        output_path, 
        pagesize=letter,
        leftMargin=36, 
        rightMargin=36, 
        topMargin=36, 
        bottomMargin=36
    )
    
    styles = build_pdf_styles()
    story = []
    
    facts = state.get("facts_json", {}) or {}
    personal = facts.get("personal", {}) or {}

    # Tailored (Agent 3) content — falls back to raw facts_json (with
    # deterministic display-case applied) if Agent 3 didn't produce a
    # tailored version of something.
    bullet_lookup = _build_bullet_lookup(state.get("tailored_bullets", []))
    project_lookup = _build_project_lookup(state.get("tailored_projects", []))
    tailored_volunteer_work = state.get("tailored_volunteer_work", []) or []
    tailored_skills = state.get("tailored_skills") or {}
    
    # 1. Header Section
    name = personal.get("name") or "Candidate Name"
    story.append(Paragraph(name, styles['CV_Name']))
    story.append(Spacer(1, 4))
    
    contact_info = []
    if personal.get("email"): contact_info.append(personal["email"])
    if personal.get("location"): contact_info.append(personal["location"])
    if personal.get("linkedin"): contact_info.append(f"LinkedIn: {personal['linkedin']}")
    if personal.get("github"): contact_info.append(f"GitHub: {personal['github']}")
    
    contact_str = "  |  ".join(contact_info)
    story.append(Paragraph(contact_str, styles['CV_Contact']))
    story.append(Spacer(1, 10))
    
    def add_section_divider(title):
        story.append(Paragraph(title.upper(), styles['CV_SectionHeading']))
        t = Table([['']], colWidths=[540], rowHeights=[1])
        t.setStyle(TableStyle([
            ('LINEABOVE', (0,0), (-1,-1), 0.75, colors.HexColor("#CBD5E0")),
            ('BOTTOMPADDING', (0,0), (-1,-1), 0),
            ('TOPPADDING', (0,0), (-1,-1), 0)
        ]))
        story.append(t)
        story.append(Spacer(1, 6))

    # 2. Professional Summary
    summary_text = state.get("tailored_summary") or facts.get("summary") or ""
    if summary_text:
        add_section_divider("Professional Summary")
        story.append(Paragraph(summary_text, styles['CV_Body']))
        story.append(Spacer(1, 10))

    # 3. Experience Section
    experience = facts.get("experience", []) or []
    if experience:
        add_section_divider("Work Experience")
        for exp in experience:
            display_title = _smart_title_case(exp.get('title', ''))
            display_company = _smart_title_case(exp.get('company', ''))
            left_text = f"<b>{display_title}</b> — {display_company}"
            right_text = exp.get("dates", "") or ""
            
            exp_table = Table(
                [[Paragraph(left_text, styles['CV_Body']), Paragraph(right_text, styles['CV_ItemRight'])]],
                colWidths=[400, 140]
            )
            exp_table.setStyle(TableStyle([
                ('VALIGN', (0,0), (-1,-1), 'TOP'),
                ('LEFTPADDING', (0,0), (-1,-1), 0),
                ('RIGHTPADDING', (0,0), (-1,-1), 0),
            ]))
            story.append(exp_table)
            story.append(Spacer(1, 4))
            
            bullets = exp.get("bullets", []) or []

            # Use Agent 3's tailored/polished version of each bullet when available,
            # matched by the original text. Falls back to the raw bullet if Agent 3
            # didn't produce a tailored version for it.
            display_bullets = [bullet_lookup.get(b.strip(), b) for b in bullets]

            list_items = [ListItem(Paragraph(b, styles['CV_Body']), leftIndent=12, bulletColor=colors.HexColor("#1A365D")) for b in display_bullets]
            if list_items:
                story.append(ListFlowable(list_items, bulletType='bullet', start='circle', bulletFontName='Helvetica', bulletFontSize=8, spaceAfter=8))

    # 4. Projects Section
    projects = facts.get("projects", []) or []
    if projects:
        add_section_divider("Projects")
        for proj in projects:
            tech_stack = ", ".join(proj.get("tech_stack", []) or [])
            proj_name = proj.get("name", "")
            tailored = project_lookup.get(proj_name.strip())

            display_name = tailored["display_name"] if tailored else _smart_title_case(proj_name)
            left_text = f"<b>{display_name}</b>"
            if tech_stack:
                left_text += f" | <i>{tech_stack}</i>"
            
            proj_table = Table(
                [[Paragraph(left_text, styles['CV_Body']), Paragraph("", styles['CV_ItemRight'])]],
                colWidths=[400, 140]
            )
            proj_table.setStyle(TableStyle([('VALIGN', (0,0), (-1,-1), 'TOP'), ('LEFTPADDING', (0,0), (-1,-1), 0)]))
            story.append(proj_table)
            story.append(Spacer(1, 2))

            # Use Agent 3's professionally-rewritten description, matched by
            # project name. Falls back to the raw candidate-typed description
            # if Agent 3 didn't produce a tailored version.
            raw_desc = proj.get("description", "") or ""
            desc = tailored["description"] if tailored else raw_desc
            if desc:
                story.append(Paragraph(desc, styles['CV_Body']))
                story.append(Spacer(1, 6))

    # 5. Skills Section
    # Prefer Agent 3's cleaned/filtered tailored_skills (junk entries like
    # "im cool" removed, capitalization fixed). Falls back to raw facts_json
    # skills if Agent 3 didn't produce a tailored version.
    skills = tailored_skills if tailored_skills else (facts.get("skills", {}) or {})
    if skills:
        add_section_divider("Skills")
        skills_lines = []
        for category, items in skills.items():
            if items:
                formatted_items = ", ".join(items) if isinstance(items, list) else str(items)
                # category is a dict key like "soft_skills" — replace underscore
                # before title-casing, otherwise .title() renders "Soft_Skills".
                category_label = _smart_title_case(category.replace("_", " "))
                skills_lines.append(f"<b>{category_label}:</b> {formatted_items}")
        
        for line in skills_lines:
            story.append(Paragraph(line, styles['CV_Body']))
            story.append(Spacer(1, 3))
        story.append(Spacer(1, 6))

    # 6. Education Section
    education = facts.get("education", []) or []
    if education:
        add_section_divider("Education")
        for edu in education:
            display_degree = _smart_title_case(edu.get('degree', ''))
            display_institution = _smart_title_case(edu.get('institution', ''))
            left_text = f"<b>{display_degree}</b> — {display_institution}"
            right_text = edu.get("graduation_year", "") or ""
            if edu.get("gpa"):
                left_text += f" (GPA: {edu.get('gpa')})"
                
            edu_table = Table(
                [[Paragraph(left_text, styles['CV_Body']), Paragraph(right_text, styles['CV_ItemRight'])]],
                colWidths=[430, 110]
            )
            edu_table.setStyle(TableStyle([
                ('VALIGN', (0,0), (-1,-1), 'TOP'),
                ('LEFTPADDING', (0,0), (-1,-1), 0),
                ('RIGHTPADDING', (0,0), (-1,-1), 0)
            ]))
            story.append(edu_table)
            story.append(Spacer(1, 4))

    # 7. Certifications Section
    # Rendered as-is — short factual titles don't need professional rewriting.
    certifications = facts.get("certifications", []) or []
    if certifications:
        add_section_divider("Certifications")
        list_items = [ListItem(Paragraph(c, styles['CV_Body']), leftIndent=12, bulletColor=colors.HexColor("#1A365D")) for c in certifications]
        story.append(ListFlowable(list_items, bulletType='bullet', start='circle', bulletFontName='Helvetica', bulletFontSize=8, spaceAfter=8))

    # 8. Volunteer Work Section
    # Uses Agent 3's polished phrasing when available (same category of fix
    # as project descriptions — these are free-text entries too).
    raw_volunteer_work = facts.get("volunteer_work", []) or []
    if raw_volunteer_work:
        add_section_divider("Volunteer Work")
        display_volunteer = tailored_volunteer_work if len(tailored_volunteer_work) == len(raw_volunteer_work) else raw_volunteer_work
        list_items = [ListItem(Paragraph(v, styles['CV_Body']), leftIndent=12, bulletColor=colors.HexColor("#1A365D")) for v in display_volunteer]
        story.append(ListFlowable(list_items, bulletType='bullet', start='circle', bulletFontName='Helvetica', bulletFontSize=8, spaceAfter=8))

    # 9. Awards Section
    # Rendered as-is — short factual titles.
    awards = facts.get("awards", []) or []
    if awards:
        add_section_divider("Awards")
        list_items = [ListItem(Paragraph(a, styles['CV_Body']), leftIndent=12, bulletColor=colors.HexColor("#1A365D")) for a in awards]
        story.append(ListFlowable(list_items, bulletType='bullet', start='circle', bulletFontName='Helvetica', bulletFontSize=8, spaceAfter=8))

    # NOTE: there is intentionally no "Additional Information" section anymore.
    # Agent 3 (tailoring_engine.py) now folds anything CV-worthy from the
    # candidate's additional-info box into professional_summary, the relevant
    # project's tailored_description, or tailored_skills — see the
    # "ADDITIONAL INFO PLACEMENT" rule in tailoring_engine.py's prompt.

    doc.build(story)
    logger.info(f"✅ CV PDF saved via ReportLab → {output_path}")
    return output_path


def render_cover_letter_pdf(state: dict) -> str:
    """Renders cover letter to PDF using ReportLab flowables."""
    output_path = os.path.join(OUTPUT_DIR, "cover_letter.pdf")
    
    doc = SimpleDocTemplate(
        output_path, 
        pagesize=letter,
        leftMargin=54, 
        rightMargin=54, 
        topMargin=54, 
        bottomMargin=54
    )
    
    styles = build_pdf_styles()
    story = []
    
    facts = state.get("facts_json", {}) or {}
    personal = facts.get("personal", {}) or {}
    wf = state.get("weight_factors", {}) or {}
    
    # Sender Block
    name = personal.get("name") or "Candidate Name"
    story.append(Paragraph(f"<b>{name}</b>", styles['CV_Body']))
    if personal.get("location"): story.append(Paragraph(personal["location"], styles['CV_Body']))
    if personal.get("email"): story.append(Paragraph(personal["email"], styles['CV_Body']))
    story.append(Spacer(1, 15))
    
    # Date Block
    current_date = date.today().strftime("%B %d, %Y")
    story.append(Paragraph(current_date, styles['CV_Body']))
    story.append(Spacer(1, 15))
    
    # Recipient Block
    company = wf.get("company") or "Company Name"
    job_title = wf.get("job_title") or "Position"
    story.append(Paragraph("Hiring Team", styles['CV_Body_Bold']))
    story.append(Paragraph(company, styles['CV_Body']))
    story.append(Spacer(1, 15))
    
    # Subject Line
    story.append(Paragraph(f"<b>RE: Application for {job_title}</b>", styles['CV_Body']))
    story.append(Spacer(1, 15))
    
    # Salutation
    story.append(Paragraph("Dear Hiring Team,", styles['CV_Body']))
    story.append(Spacer(1, 10))
    
    # Body Paragraphs — guard against None before .split()
    letter_text = state.get("cover_letter_text") or ""
    paragraphs = [p.strip() for p in letter_text.split('\n') if p.strip()]
    
    for para in paragraphs:
        story.append(Paragraph(para, styles['CV_Body']))
        story.append(Spacer(1, 12))
        
    # Sign-off
    story.append(Spacer(1, 8))
    story.append(Paragraph("Sincerely,", styles['CV_Body']))
    story.append(Spacer(1, 20))
    story.append(Paragraph(name, styles['CV_Body_Bold']))
    
    doc.build(story)
    logger.info(f"✅ Cover letter PDF saved via ReportLab → {output_path}")
    return output_path
