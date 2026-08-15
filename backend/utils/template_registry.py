# utils/template_registry.py
"""
Central place that maps a template_id (chosen in the dashboard) to its
Jinja/HTML file. docx_generator.py and pdf_generator.py both import this
instead of hardcoding a single cv_template.html path.

Add a new template by dropping a .html file in templates/ and adding one
line here — nothing else in the pipeline needs to change, since every
template uses the same variable contract (personal, tailored_summary,
experience, tailored_bullets, projects, skills, education, certifications).

`photo: True` marks a template that has a dedicated candidate-photo slot.
That flag is the single switch for the whole feature, read in three places:

  · utils/cv_context.py     — only a photo template gets `photo` in its
                              render context, so the other templates are
                              byte-for-byte unchanged by this feature.
  · utils/pdf_generator.py  — the cover letter carries the same photo when,
                              and only when, the CV beside it does.
  · main.py                 — the photo is persisted into the resume's
                              generation_snapshot only when the chosen
                              template actually renders it, which keeps
                              every other row the size it was and avoids
                              storing someone's face for no reason.

A photo template renders perfectly well with no photo on file — the slot is
`{% if photo %}` in every one of them and the layout closes up around it.
"""

from pathlib import Path

TEMPLATES_DIR = Path(__file__).parent.parent / "templates"

TEMPLATE_REGISTRY = {
    "original_classic":     {"file": "cv_template.html",           "label": "Classic (Default)",     "label_ar": "الكلاسيكي (الافتراضي)"},
    "classic_serif":        {"file": "01_classic_serif.html",        "label": "Classic Serif",        "label_ar": "كلاسيكي"},
    "modern_minimal":       {"file": "02_modern_minimal.html",       "label": "Modern Minimal",       "label_ar": "بسيط عصري"},
    "navy_executive":       {"file": "03_navy_executive.html",       "label": "Navy Executive",        "label_ar": "تنفيذي كحلي"},
    "sidebar_dark":         {"file": "04_sidebar_dark.html",         "label": "Sidebar Dark",          "label_ar": "شريط جانبي داكن"},
    "timeline":             {"file": "05_timeline.html",             "label": "Timeline",              "label_ar": "الجدول الزمني"},
    "elegant_gold":         {"file": "06_elegant_gold.html",         "label": "Elegant Gold",          "label_ar": "أنيق ذهبي"},
    "compact_ats":          {"file": "07_compact_ats.html",          "label": "Compact ATS-Safe",      "label_ar": "متوافق مع الأنظمة الآلية"},
    "bold_banner":          {"file": "08_bold_banner.html",          "label": "Bold Banner",           "label_ar": "شريط جريء"},
    "geometric_creative":   {"file": "09_geometric_creative.html",   "label": "Geometric Creative",    "label_ar": "إبداعي هندسي"},
    "letterhead_corporate": {"file": "10_letterhead_corporate.html", "label": "Corporate Letterhead",  "label_ar": "ترويسة رسمية"},

    # ── Templates with a candidate photo slot ──────────────────────────────
    "portrait_rail":        {"file": "11_portrait_rail.html",        "label": "Portrait Rail",         "label_ar": "عمود جانبي بصورة",  "photo": True},
    "portrait_band":        {"file": "12_portrait_band.html",        "label": "Portrait Band",         "label_ar": "ترويسة بصورة",      "photo": True},
    "portrait_corner":      {"file": "13_portrait_corner.html",      "label": "Corner Portrait",       "label_ar": "صورة في الزاوية",   "photo": True},
    "portrait_formal":      {"file": "14_portrait_formal.html",      "label": "Formal Portrait",       "label_ar": "رسمي بصورة",        "photo": True},
    "portrait_card":        {"file": "15_portrait_card.html",        "label": "Portrait Card",         "label_ar": "بطاقة بصورة",       "photo": True},
}

DEFAULT_TEMPLATE_ID = "original_classic"


def resolve_template_path(template_id: str) -> Path:
    entry = TEMPLATE_REGISTRY.get(template_id) or TEMPLATE_REGISTRY[DEFAULT_TEMPLATE_ID]
    return TEMPLATES_DIR / entry["file"]


def template_supports_photo(template_id: str | None) -> bool:
    """
    Does the chosen template have a photo slot?

    Falls back to the DEFAULT template's answer for an unknown id, matching
    resolve_template_path — so an id that renders as Classic can't claim to
    support a photo Classic has nowhere to put.
    """
    entry = TEMPLATE_REGISTRY.get(template_id or "") or TEMPLATE_REGISTRY[DEFAULT_TEMPLATE_ID]
    return bool(entry.get("photo"))


def list_templates_for_frontend() -> list[dict]:
    """Shape consumed by the dashboard's template picker."""
    return [
        {"id": tid, "label": v["label"], "label_ar": v["label_ar"], "photo": bool(v.get("photo"))}
        for tid, v in TEMPLATE_REGISTRY.items()
    ]
