# utils/template_registry.py
"""
Central place that maps a template_id (chosen in the dashboard) to its
Jinja/HTML file. docx_generator.py and pdf_generator.py both import this
instead of hardcoding a single cv_template.html path.

Add a new template by dropping a .html file in templates/ and adding one
line here — nothing else in the pipeline needs to change, since every
template uses the same variable contract (personal, tailored_summary,
experience, tailored_bullets, projects, skills, education, certifications).
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
}

DEFAULT_TEMPLATE_ID = "original_classic"


def resolve_template_path(template_id: str) -> Path:
    entry = TEMPLATE_REGISTRY.get(template_id) or TEMPLATE_REGISTRY[DEFAULT_TEMPLATE_ID]
    return TEMPLATES_DIR / entry["file"]


def list_templates_for_frontend() -> list[dict]:
    """Shape consumed by the dashboard's template picker."""
    return [
        {"id": tid, "label": v["label"], "label_ar": v["label_ar"]}
        for tid, v in TEMPLATE_REGISTRY.items()
    ]
