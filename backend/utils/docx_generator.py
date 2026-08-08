# utils/docx_generator.py
import os
from docx import Document
from docx.shared import Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
from loguru import logger

from utils.cv_context import build_cv_context
from utils.docx_styles import resolve_docx_style
from utils.template_registry import DEFAULT_TEMPLATE_ID

OUTPUT_DIR = "outputs"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Word renders Arabic shaping/bidi natively, so unlike the PDF generator we
# don't need reshaping here — just a complex-script font and the RTL
# paragraph/run flags below.
ARABIC_FONT = "Traditional Arabic"


def _set_rtl_paragraph(paragraph, is_arabic: bool):
    if not is_arabic:
        return
    pPr = paragraph._p.get_or_add_pPr()
    bidi = OxmlElement("w:bidi")
    pPr.append(bidi)
    paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT


def _set_rtl_run(run, is_arabic: bool):
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


def _add_run(paragraph, text, is_arabic, style, size=10.5, bold=False, color=None):
    r = paragraph.add_run(text)
    r.font.size = Pt(size)
    r.font.name = style["font_name"] if not is_arabic else ARABIC_FONT
    r.bold = bold
    if color:
        r.font.color.rgb = color
    _set_rtl_run(r, is_arabic)
    return r


def _add_bottom_border(paragraph, color_hex: str):
    """Adds a single-rule bottom border to a paragraph, in the given accent
    color — gives a heading real visual presence in a format with no CSS.
    See docx_styles.py's module docstring for why this exists."""
    pPr = paragraph._p.get_or_add_pPr()
    pBdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "6")     # eighths of a point
    bottom.set(qn("w:space"), "4")
    bottom.set(qn("w:color"), color_hex.lstrip("#"))
    pBdr.append(bottom)
    pPr.append(pBdr)


def _shade_paragraph(paragraph, color_hex: str):
    """Fills a paragraph's background — used for templates whose PDF
    identity IS a solid color block behind the name (sidebar_dark,
    bold_banner). See docx_styles.py's header_shade docstring."""
    pPr = paragraph._p.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), color_hex.lstrip("#"))
    pPr.append(shd)


def _heading(doc, title, is_arabic, style):
    p = doc.add_heading(title, level=2)
    run = p.runs[0]
    run.font.name = style["font_name"] if not is_arabic else ARABIC_FONT
    run.font.color.rgb = style["heading_color_rgb"]
    run.underline = style["heading_underline"]
    p.paragraph_format.space_before = Pt(10)
    p.paragraph_format.space_after = Pt(4)
    if style.get("heading_border"):
        _add_bottom_border(p, style["accent_color"])
    _set_rtl_paragraph(p, is_arabic)
    _set_rtl_run(run, is_arabic)


def _bullet(doc, text, is_arabic, style):
    p = doc.add_paragraph(text, style=style["bullet_style"])
    p.runs[0].font.size = Pt(10.5)
    p.runs[0].font.name = style["font_name"] if not is_arabic else ARABIC_FONT
    p.paragraph_format.space_after = Pt(2)
    _set_rtl_paragraph(p, is_arabic)
    _set_rtl_run(p.runs[0], is_arabic)


def generate_cv_docx(state: dict, output_path: str, template_id: str | None = None) -> str:
    """
    Generates .docx version of the tailored CV, styled to match the chosen
    template_id (see utils/docx_styles.py for what "match" means for a
    format that can't render arbitrary CSS). Falls back to the default
    style if template_id is None or unrecognized.

    output_path is REQUIRED (no static-filename fallback) — same reasoning
    as pdf_generator.py's render_cv_pdf/render_cover_letter_pdf: a fixed
    default path is exactly the bug that let concurrent users' generations
    overwrite each other. Every caller, including tests, must supply a
    unique per-request/per-call path.
    """
    doc = Document()
    resolved_template_id = template_id or DEFAULT_TEMPLATE_ID
    style = resolve_docx_style(resolved_template_id)

    context = build_cv_context(state, template_id=resolved_template_id)
    is_arabic = context["is_arabic"]
    personal = context["personal"]

    # Header — templates with a header_shade get a filled color block behind
    # the name/contact block (evokes their PDF sidebar/banner identity);
    # header_text_color keeps the text readable against that fill.
    header_shade = style.get("header_shade")
    header_text_rgb = style.get("header_text_color_rgb") or style["heading_color_rgb"]

    name_p = doc.add_heading(personal.get("name", ""), level=1)
    name_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    _set_rtl_paragraph(name_p, is_arabic)
    if name_p.runs:
        name_p.runs[0].font.name = style["font_name"] if not is_arabic else ARABIC_FONT
        name_p.runs[0].font.color.rgb = header_text_rgb if header_shade else style["heading_color_rgb"]
        _set_rtl_run(name_p.runs[0], is_arabic)
        name_p.alignment = WD_ALIGN_PARAGRAPH.CENTER  # keep centered even after RTL flag
    if header_shade:
        _shade_paragraph(name_p, header_shade)

    contact = " · ".join(filter(None, [
        personal.get("email", ""),
        personal.get("location", ""),
        f"linkedin.com/{personal['linkedin']}" if personal.get("linkedin") else "",
        f"github.com/{personal['github']}" if personal.get("github") else "",
    ]))
    cp = doc.add_paragraph()
    cp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    _add_run(cp, contact, is_arabic, style, size=9.5, color=header_text_rgb if header_shade else None)
    _set_rtl_paragraph(cp, is_arabic)
    cp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    if header_shade:
        _shade_paragraph(cp, header_shade)
        cp.paragraph_format.space_after = Pt(10)

    # Summary
    if context["tailored_summary"]:
        _heading(doc, "الملخص المهني" if is_arabic else "Professional Summary", is_arabic, style)
        p = doc.add_paragraph()
        _add_run(p, context["tailored_summary"], is_arabic, style)
        _set_rtl_paragraph(p, is_arabic)

    # Experience — context["experience"][i]["bullets"] is already the
    # resolved (tailored, in original order) list of strings.
    if context["experience"]:
        _heading(doc, "الخبرة العملية" if is_arabic else "Experience", is_arabic, style)
        for exp in context["experience"]:
            p = doc.add_paragraph()
            _add_run(p, f"{exp['title']}   {exp['company']}", is_arabic, style, bold=True)
            _add_run(p, f"    {exp['dates']}", is_arabic, style, size=10, color=style["accent_color_rgb"])
            _set_rtl_paragraph(p, is_arabic)
            for bullet_text in exp["bullets"]:
                _bullet(doc, bullet_text, is_arabic, style)

    # Projects — one tailored description paragraph per project, matching
    # the real tailoring_engine.py output shape (not a bullet list).
    if context["projects"]:
        _heading(doc, "المشاريع" if is_arabic else "Projects", is_arabic, style)
        for proj in context["projects"]:
            p = doc.add_paragraph()
            _add_run(p, proj["name"], is_arabic, style, bold=True)
            tech_stack = ", ".join(proj["tech_stack"])
            if tech_stack:
                _add_run(p, f"    {tech_stack}", is_arabic, style, size=10, color=style["accent_color_rgb"])
            _set_rtl_paragraph(p, is_arabic)
            if proj["description"]:
                dp = doc.add_paragraph()
                _add_run(dp, proj["description"], is_arabic, style, size=10.5)
                _set_rtl_paragraph(dp, is_arabic)

    # Skills
    if context["skills"]:
        _heading(doc, "المهارات" if is_arabic else "Skills", is_arabic, style)
        # Sourced from context["labels"] (utils/cv_context.py) rather than a
        # local dict, so the DOCX and the PDF of the same CV can't disagree
        # about what a section is called — they previously had two separate
        # Arabic wordings for the same skill categories.
        labels = context.get("labels", {})
        label_keys = {
            "languages": "languages", "frameworks": "frameworks", "tools": "tools",
            "soft_skills": "soft_skills", "other": "other_skills",
        }
        for category, items in context["skills"].items():
            if items:
                label = (
                    labels.get(label_keys.get(category, ""), category)
                    if is_arabic
                    else category.replace("_", " ").capitalize()
                )
                p = doc.add_paragraph()
                _add_run(p, f"{label}: ", is_arabic, style, bold=True)
                _add_run(p, ", ".join(items), is_arabic, style)
                p.paragraph_format.space_after = Pt(2)
                _set_rtl_paragraph(p, is_arabic)

    # Volunteer work
    if context["volunteer_work"]:
        _heading(doc, "الأعمال التطوعية" if is_arabic else "Volunteer Work", is_arabic, style)
        for v in context["volunteer_work"]:
            _bullet(doc, v, is_arabic, style)

    # Education
    if context["education"]:
        _heading(doc, "التعليم" if is_arabic else "Education", is_arabic, style)
        for edu in context["education"]:
            p = doc.add_paragraph()
            _add_run(p, f"{edu.get('degree', '')}   {edu.get('institution', '')}", is_arabic, style, bold=True)
            _add_run(p, f"    {edu.get('graduation_year', '')}", is_arabic, style, size=10)
            _set_rtl_paragraph(p, is_arabic)
            if edu.get("gpa"):
                gp = doc.add_paragraph()
                _add_run(gp, f"{'المعدل التراكمي' if is_arabic else 'GPA'}: {edu.get('gpa', '')}", is_arabic, style, size=10, color=style["accent_color_rgb"])
                gp.paragraph_format.space_after = Pt(2)
                _set_rtl_paragraph(gp, is_arabic)

    # Certifications
    if context["certifications"]:
        _heading(doc, "الشهادات" if is_arabic else "Certifications", is_arabic, style)
        for cert in context["certifications"]:
            _bullet(doc, cert, is_arabic, style)

    doc.save(output_path)
    logger.info(f"✅ CV DOCX saved → {output_path} (template: {resolved_template_id})")
    return output_path
