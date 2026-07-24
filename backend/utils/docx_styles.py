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
        "accent_color": "#000000",
        "bullet_style": "List Bullet",
    },
    "classic_serif": {
        "font_name": "Cambria",
        "heading_color": "#000000",
        "heading_underline": True,
        "accent_color": "#000000",
        "bullet_style": "List Bullet",
    },
    "modern_minimal": {
        "font_name": "Calibri Light",
        "heading_color": "#777777",
        "heading_underline": False,
        "accent_color": "#B0B0B0",
        "bullet_style": "List Bullet",
    },
    "navy_executive": {
        "font_name": "Calibri",
        "heading_color": "#1F3864",
        "heading_underline": False,
        "accent_color": "#1F3864",
        "bullet_style": "List Bullet",
    },
    "sidebar_dark": {
        "font_name": "Segoe UI",
        "heading_color": "#16223A",
        "heading_underline": False,
        "accent_color": "#16223A",
        "bullet_style": "List Bullet",
    },
    "timeline": {
        "font_name": "Segoe UI",
        "heading_color": "#0F172A",
        "heading_underline": False,
        "accent_color": "#0284C7",
        "bullet_style": "List Bullet",
    },
    "elegant_gold": {
        "font_name": "Garamond",
        "heading_color": "#A9862E",
        "heading_underline": False,
        "accent_color": "#A9862E",
        "bullet_style": "List Bullet",
    },
    "compact_ats": {
        "font_name": "Arial",
        "heading_color": "#000000",
        "heading_underline": False,
        "accent_color": "#000000",
        "bullet_style": "List Bullet",
    },
    "bold_banner": {
        "font_name": "Segoe UI",
        "heading_color": "#1C1C1C",
        "heading_underline": False,
        "accent_color": "#F0C419",
        "bullet_style": "List Bullet",
    },
    "geometric_creative": {
        "font_name": "Century Gothic",
        "heading_color": "#FF6B6B",
        "heading_underline": False,
        "accent_color": "#F0A500",
        "bullet_style": "List Bullet",
    },
    "letterhead_corporate": {
        "font_name": "Times New Roman",
        "heading_color": "#000000",
        "heading_underline": False,
        "accent_color": "#333333",
        "bullet_style": "List Bullet",
    },
}

DEFAULT_DOCX_STYLE_ID = "original_classic"


def resolve_docx_style(template_id: str | None) -> dict:
    preset = DOCX_STYLES.get(template_id or "", DOCX_STYLES[DEFAULT_DOCX_STYLE_ID])
    return {
        **preset,
        "heading_color_rgb": _rgb(preset["heading_color"]),
        "accent_color_rgb": _rgb(preset["accent_color"]),
    }
