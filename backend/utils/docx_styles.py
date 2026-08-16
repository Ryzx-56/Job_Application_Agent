# utils/docx_styles.py
"""
DOCX can't consume the HTML/CSS templates PDF uses — Word has no flexbox,
no gradients, no CSS positioning, and no engine to interpret arbitrary CSS
at all. python-docx builds a document out of explicit paragraph/run
properties, so "10 templates" for DOCX means 10 STYLE PRESETS applied to
the same document structure, not 10 different layout engines.

This keeps the visual identity of each template recognizable in Word
(same accent color, same heading treatment, same font family) without
pretending Word can reproduce a sidebar layout or a diagonal gradient
header — it can't, and a preset that tried to fake that with nested tables
would be fragile and look worse than just embracing what Word is good at:
clean single-column documents with strong typography.

Two extra knobs beyond color/font give templates that lean on a strong
PDF-side visual block (a dark sidebar, a bold banner) something to still
read as "themed" in Word, since color alone on a thin heading font reads
as barely different from the next preset over:
  - heading_border: adds a bottom rule under each section heading, in the
    preset's accent color — the cheapest way to give a heading real
    presence in a medium with no CSS.
  - header_shade: fills the name header block with the preset's accent
    color (RGB hex, no "#"), for templates whose PDF identity IS a solid
    color block behind the name. header_text_color pairs with it so the
    name stays readable against whatever shade is chosen (dark shades get
    white text; None means keep the theme's normal heading color).
  None on either knob means "leave that template's Word output plain" —
  deliberately the case for compact_ats, since that template's whole
  purpose is staying as parser-friendly/plain as possible.

Each preset name matches a template_id in utils/template_registry.py so
the same dropdown choice drives both PDF and DOCX output.
"""

from docx.shared import RGBColor

# RGBColor takes an int triplet; keep hex strings here for readability and
# convert at point of use.
def _rgb(hex_str: str) -> RGBColor:
    hex_str = hex_str.lstrip("#")
    return RGBColor(int(hex_str[0:2], 16), int(hex_str[2:4], 16), int(hex_str[4:6], 16))


DOCX_STYLES = {
    "original_classic": {
        "font_name": "Cambria",
        "heading_color": "#000000",
        "heading_underline": True,
        "accent_color": "#4A4A4A",
        "bullet_style": "List Bullet",
        "heading_border": True,
        "header_shade": None,
        "header_text_color": None,
    },
    "classic_serif": {
        "font_name": "Cambria",
        "heading_color": "#000000",
        "heading_underline": True,
        "accent_color": "#4A4A4A",
        "bullet_style": "List Bullet",
        "heading_border": True,
        "header_shade": None,
        "header_text_color": None,
    },
    "modern_minimal": {
        "font_name": "Calibri Light",
        "heading_color": "#777777",
        "heading_underline": False,
        "accent_color": "#B0B0B0",
        "bullet_style": "List Bullet",
        "heading_border": False,
        "header_shade": None,
        "header_text_color": None,
    },
    "navy_executive": {
        "font_name": "Calibri",
        "heading_color": "#1F3864",
        "heading_underline": False,
        "accent_color": "#1F3864",
        "bullet_style": "List Bullet",
        "heading_border": True,
        "header_shade": None,
        "header_text_color": None,
    },
    "sidebar_dark": {
        "font_name": "Segoe UI",
        "heading_color": "#16223A",
        "heading_underline": False,
        "accent_color": "#16223A",
        "bullet_style": "List Bullet",
        "heading_border": True,
        "header_shade": "#16223A",
        "header_text_color": "#FFFFFF",
    },
    "timeline": {
        "font_name": "Segoe UI",
        "heading_color": "#0F172A",
        "heading_underline": False,
        "accent_color": "#0284C7",
        "bullet_style": "List Bullet",
        "heading_border": True,
        "header_shade": None,
        "header_text_color": None,
    },
    "elegant_gold": {
        "font_name": "Garamond",
        "heading_color": "#A9862E",
        "heading_underline": False,
        "accent_color": "#A9862E",
        "bullet_style": "List Bullet",
        "heading_border": True,
        "header_shade": None,
        "header_text_color": None,
    },
    "compact_ats": {
        "font_name": "Arial",
        "heading_color": "#000000",
        "heading_underline": False,
        "accent_color": "#000000",
        "bullet_style": "List Bullet",
        "heading_border": False,
        "header_shade": None,
        "header_text_color": None,
    },
    "bold_banner": {
        "font_name": "Segoe UI",
        "heading_color": "#1C1C1C",
        "heading_underline": False,
        "accent_color": "#F0C419",
        "bullet_style": "List Bullet",
        "heading_border": True,
        "header_shade": "#F0C419",
        "header_text_color": "#1C1C1C",
    },
    "geometric_creative": {
        "font_name": "Century Gothic",
        "heading_color": "#FF6B6B",
        "heading_underline": False,
        "accent_color": "#F0A500",
        "bullet_style": "List Bullet",
        "heading_border": True,
        "header_shade": None,
        "header_text_color": None,
    },
    "letterhead_corporate": {
        "font_name": "Times New Roman",
        "heading_color": "#000000",
        "heading_underline": False,
        "accent_color": "#333333",
        "bullet_style": "List Bullet",
        "heading_border": True,
        "header_shade": None,
        "header_text_color": None,
    },

    # ── Photo templates ───────────────────────────────────────────────────
    # `photo: True` puts the candidate's picture above the name block in the
    # Word file too. Without it, choosing a photo template would produce a
    # PDF with a portrait and a .docx of the same CV without one — the two
    # downloads sit side by side on the results screen, so that mismatch
    # would read as a bug. Word can't reproduce a corner bleed or a circular
    # crop (same limitation this file exists to document), so all five use
    # the one treatment Word does well: a centred picture above the name.
    "portrait_rail": {
        "font_name": "Segoe UI",
        "heading_color": "#2A2622",
        "heading_underline": False,
        "accent_color": "#8C5A3C",
        "bullet_style": "List Bullet",
        "heading_border": True,
        "header_shade": None,
        "header_text_color": None,
        "photo": True,
    },
    "portrait_band": {
        "font_name": "Segoe UI",
        "heading_color": "#14202B",
        "heading_underline": False,
        "accent_color": "#B4694A",
        "bullet_style": "List Bullet",
        "heading_border": True,
        "header_shade": "#14202B",
        "header_text_color": "#FFFFFF",
        "photo": True,
    },
    "portrait_corner": {
        "font_name": "Segoe UI",
        "heading_color": "#2F3E46",
        "heading_underline": False,
        "accent_color": "#D96F32",
        "bullet_style": "List Bullet",
        "heading_border": True,
        "header_shade": "#2F3E46",
        "header_text_color": "#FFFFFF",
        "photo": True,
    },
    "portrait_formal": {
        "font_name": "Georgia",
        "heading_color": "#1A1A1A",
        "heading_underline": False,
        "accent_color": "#6B6B6B",
        "bullet_style": "List Bullet",
        "heading_border": True,
        "header_shade": None,
        "header_text_color": None,
        "photo": True,
    },
    "portrait_card": {
        "font_name": "Segoe UI",
        "heading_color": "#35566E",
        "heading_underline": False,
        "accent_color": "#35566E",
        "bullet_style": "List Bullet",
        "heading_border": True,
        "header_shade": None,
        "header_text_color": None,
        "photo": True,
    },
}

DEFAULT_DOCX_STYLE_ID = "original_classic"


def resolve_docx_style(template_id: str | None) -> dict:
    preset = DOCX_STYLES.get(template_id or "", DOCX_STYLES[DEFAULT_DOCX_STYLE_ID])
    return {
        **preset,
        "heading_color_rgb": _rgb(preset["heading_color"]),
        "accent_color_rgb": _rgb(preset["accent_color"]),
        "header_shade_rgb": _rgb(preset["header_shade"]) if preset.get("header_shade") else None,
        "header_text_color_rgb": _rgb(preset["header_text_color"]) if preset.get("header_text_color") else None,
    }
