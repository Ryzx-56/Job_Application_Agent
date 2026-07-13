# utils/docx_generator.py
import os
from docx import Document
from docx.shared import Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
from loguru import logger

OUTPUT_DIR = "outputs"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Word renders Arabic shaping/bidi natively, so unlike the PDF generator we
# don't need reshaping here — just a complex-script font and the RTL
# paragraph/run flags below.
ARABIC_FONT = "Traditional Arabic"


def _set_rtl_paragraph(paragraph, is_arabic: bool):
    """Marks a paragraph right-to-left and right-aligned for Arabic output."""
    if not is_arabic:
        return
    pPr = paragraph._p.get_or_add_pPr()
    bidi = OxmlElement("w:bidi")
    pPr.append(bidi)
    paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT


def _set_rtl_run(run, is_arabic: bool):
    """
    Marks a run's complex-script (cs) font and rtl flag so Word renders it
    with Arabic shaping instead of treating it as Latin text with a
    right-aligned paragraph (which alone is not enough — Word decides
    shaping per-run based on these properties, not paragraph direction).
    """
    if not is_arabic:
        return
    run.font.name = ARABIC_FONT
    rPr = run._element.get_or_add_rPr()
    rFonts = rPr.find(qn("w:rFonts"))
    if rFonts is None:
        rFonts = OxmlElement("w:rFonts")
        rPr.append(rFonts)
    rFonts.set(qn("w:cs"), ARABIC_FONT)
    rtl = rPr.find(qn("w:rtl"))
    if rtl is None:
        rtl = OxmlElement("w:rtl")
        rPr.append(rtl)


def _add_run(paragraph, text, is_arabic, size=10.5, bold=False, color=None):
    r = paragraph.add_run(text)
    r.font.size = Pt(size)
    r.bold = bold
    if color:
        r.font.color.rgb = color
    _set_rtl_run(r, is_arabic)
    return r


def _heading(doc, title, is_arabic):
    p = doc.add_heading(title, level=2)
    p.runs[0].font.color.rgb = RGBColor(0, 0, 0)
    p.paragraph_format.space_before = Pt(10)
    p.paragraph_format.space_after = Pt(4)
    _set_rtl_paragraph(p, is_arabic)
    _set_rtl_run(p.runs[0], is_arabic)


def _bullet(doc, text, is_arabic):
    p = doc.add_paragraph(text, style="List Bullet")
    p.runs[0].font.size = Pt(10.5)
    p.paragraph_format.space_after = Pt(2)
    _set_rtl_paragraph(p, is_arabic)
    _set_rtl_run(p.runs[0], is_arabic)


def generate_cv_docx(state: dict) -> str:
    """Generates .docx version of the tailored CV. Returns file path."""
    doc         = Document()
    facts       = state["facts_json"]
    personal    = facts.get("personal", {})
    is_arabic   = state.get("cv_language", "en") == "ar"

    # Header
    name_p = doc.add_heading(personal.get("name", ""), level=1)
    name_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    _set_rtl_paragraph(name_p, is_arabic)
    if name_p.runs:
        _set_rtl_run(name_p.runs[0], is_arabic)
        name_p.alignment = WD_ALIGN_PARAGRAPH.CENTER  # keep centered even after RTL flag

    # Tailored (Agent 3) content, falling back to raw facts_json — mirrors
    # utils/pdf_generator.py's lookup pattern so DOCX and PDF stay in sync.
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

    contact = " · ".join(filter(None, [
        personal.get("email", ""),
        personal.get("location", ""),
        f"linkedin.com/{personal.get('linkedin', '')}" if personal.get("linkedin") else "",
        f"github.com/{personal.get('github', '')}" if personal.get("github") else "",
    ]))
    cp = doc.add_paragraph()
    cp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    _add_run(cp, contact, is_arabic, size=9.5)
    _set_rtl_paragraph(cp, is_arabic)
    cp.alignment = WD_ALIGN_PARAGRAPH.CENTER

    # Summary
    summary = state.get("tailored_summary", "")
    if summary:
        _heading(doc, "الملخص المهني" if is_arabic else "Professional Summary", is_arabic)
        p = doc.add_paragraph()
        _add_run(p, summary, is_arabic)
        _set_rtl_paragraph(p, is_arabic)

    # Experience
    experience = facts.get("experience", [])
    if experience:
        _heading(doc, "الخبرة العملية" if is_arabic else "Experience", is_arabic)
        for exp in experience:
            p = doc.add_paragraph()
            _add_run(p, f"{exp.get('title', '')}   {exp.get('company', '')}", is_arabic, bold=True)
            _add_run(p, f"    {exp.get('dates', '')}", is_arabic, size=10, color=RGBColor(80, 80, 80))
            _set_rtl_paragraph(p, is_arabic)
            for raw_bullet in exp.get("bullets", []) or []:
                text = bullet_lookup.get(raw_bullet.strip(), raw_bullet)
                _bullet(doc, text, is_arabic)

    # Projects
    projects = facts.get("projects", [])
    if projects:
        _heading(doc, "المشاريع" if is_arabic else "Projects", is_arabic)
        for proj in projects:
            name = (proj.get("name") or "").strip()
            tailored = project_lookup.get(name)
            display_name = (tailored.get("display_name") if tailored else None) or name
            desc = (tailored.get("tailored_description") if tailored else None) or proj.get("description", "")

            p = doc.add_paragraph()
            _add_run(p, display_name, is_arabic, bold=True)
            tech_stack = ", ".join(proj.get("tech_stack", []) or [])
            if tech_stack:
                _add_run(p, f"    {tech_stack}", is_arabic, size=10, color=RGBColor(80, 80, 80))
            _set_rtl_paragraph(p, is_arabic)
            if desc:
                dp = doc.add_paragraph()
                _add_run(dp, desc, is_arabic, size=10.5)
                _set_rtl_paragraph(dp, is_arabic)

    # Skills
    if tailored_skills:
        _heading(doc, "المهارات" if is_arabic else "Skills", is_arabic)
        category_labels_ar = {
            "languages": "اللغات البرمجية",
            "frameworks": "أطر العمل",
            "tools": "الأدوات",
            "soft_skills": "المهارات الشخصية",
            "other": "أخرى",
        }
        for category, items in tailored_skills.items():
            if items:
                label = category_labels_ar.get(category, category) if is_arabic else category.replace("_", " ").capitalize()
                p = doc.add_paragraph()
                _add_run(p, f"{label}: ", is_arabic, bold=True)
                _add_run(p, ", ".join(items), is_arabic)
                p.paragraph_format.space_after = Pt(2)
                _set_rtl_paragraph(p, is_arabic)

    # Volunteer work
    raw_volunteer_work = facts.get("volunteer_work", []) or []
    if raw_volunteer_work:
        _heading(doc, "الأعمال التطوعية" if is_arabic else "Volunteer Work", is_arabic)
        display_volunteer = (
            tailored_volunteer_work
            if len(tailored_volunteer_work) == len(raw_volunteer_work)
            else raw_volunteer_work
        )
        for v in display_volunteer:
            _bullet(doc, v, is_arabic)

    # Education
    education = facts.get("education", [])
    if education:
        _heading(doc, "التعليم" if is_arabic else "Education", is_arabic)
        for edu in education:
            p = doc.add_paragraph()
            _add_run(p, f"{edu.get('degree', '')}   {edu.get('institution', '')}", is_arabic, bold=True)
            _add_run(p, f"    {edu.get('graduation_year', '')}", is_arabic, size=10)
            _set_rtl_paragraph(p, is_arabic)
            if edu.get("gpa"):
                gp = doc.add_paragraph()
                _add_run(gp, f"{'المعدل التراكمي' if is_arabic else 'GPA'}: {edu.get('gpa', '')}", is_arabic, size=10, color=RGBColor(80, 80, 80))
                gp.paragraph_format.space_after = Pt(2)
                _set_rtl_paragraph(gp, is_arabic)

    output_path = os.path.join(OUTPUT_DIR, "tailored_cv.docx")
    doc.save(output_path)
    logger.info(f"✅ CV DOCX saved → {output_path}")
    return output_path