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
            left_text = f"<b>{exp.get('title', '')}</b> — {exp.get('company', '')}"
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
            
            list_items = [ListItem(Paragraph(b, styles['CV_Body']), leftIndent=12, bulletColor=colors.HexColor("#1A365D")) for b in bullets]
            if list_items:
                story.append(ListFlowable(list_items, bulletType='bullet', start='circle', bulletFontName='Helvetica', bulletFontSize=8, spaceAfter=8))

    # 4. Projects Section
    projects = facts.get("projects", []) or []
    if projects:
        add_section_divider("Projects")
        for proj in projects:
            tech_stack = ", ".join(proj.get("tech_stack", []) or [])
            left_text = f"<b>{proj.get('name', '')}</b>"
            if tech_stack:
                left_text += f" | <i>{tech_stack}</i>"
            
            proj_table = Table(
                [[Paragraph(left_text, styles['CV_Body']), Paragraph("", styles['CV_ItemRight'])]],
                colWidths=[400, 140]
            )
            proj_table.setStyle(TableStyle([('VALIGN', (0,0), (-1,-1), 'TOP'), ('LEFTPADDING', (0,0), (-1,-1), 0)]))
            story.append(proj_table)
            story.append(Spacer(1, 2))
            
            desc = proj.get("description", "") or ""
            if desc:
                story.append(Paragraph(desc, styles['CV_Body']))
                story.append(Spacer(1, 6))

    # 5. Skills Section
    skills = facts.get("skills", {}) or {}
    if skills:
        add_section_divider("Skills")
        skills_lines = []
        for category, items in skills.items():
            if items:
                formatted_items = ", ".join(items) if isinstance(items, list) else str(items)
                skills_lines.append(f"<b>{category.title()}:</b> {formatted_items}")
        
        for line in skills_lines:
            story.append(Paragraph(line, styles['CV_Body']))
            story.append(Spacer(1, 3))
        story.append(Spacer(1, 6))

    # 6. Education Section
    education = facts.get("education", []) or []
    if education:
        add_section_divider("Education")
        for edu in education:
            left_text = f"<b>{edu.get('degree', '')}</b> — {edu.get('institution', '')}"
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