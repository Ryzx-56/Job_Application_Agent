"""
An optional section the candidate left empty must not appear at all.

The failure this prevents is small and very visible: a student with no work
history gets a CV with an "Experience" heading and nothing under it, which
reads as an omission rather than as a person early in their career. Checked at
the HTML level, across every template, because it is a template-by-template
property and there are sixteen of them.
"""

import re

import pytest

from utils.cv_context import build_cv_context
from utils.pdf_generator import _jinja_env
from utils.template_registry import TEMPLATE_REGISTRY, resolve_template_path


def _render_html(state, template_id):
    context = build_cv_context(state, template_id=template_id)
    template = _jinja_env.get_template(resolve_template_path(template_id).name)
    return template.render(**context)

MINIMAL = {
    "facts_json": {
        "personal": {"name": "Sara Al-Otaibi", "email": "s@example.com",
                     "phone": "+966500000000", "location": "Riyadh"},
        "education": [{"institution": "KSU", "degree": "Bachelor's Degree in Marketing"}],
        "experience": [], "projects": [], "certifications": [], "awards": [],
        "languages_spoken": [], "publications": [], "training_courses": [],
        "participation": [], "major_achievements": [], "teaching_and_editorial": [],
        "additional_sections": [], "volunteer_work": [],
        "skills": {"languages": [], "frameworks": [], "tools": [],
                   "soft_skills": [], "other": []},
    },
    "cv_language": "en",
    "tailored_summary": "Marketing graduate.",
    "tailored_bullets": [], "tailored_projects": [], "new_projects": [],
}

# Headings that must not appear when their section is empty. Deliberately not
# every label — just the ones a real empty-form CV would expose.
ABSENT_WHEN_EMPTY = ["Experience", "Projects", "Certifications", "Publications",
                     "Volunteer Work", "Key Achievements", "Awards"]


@pytest.mark.parametrize("template_id", sorted(TEMPLATE_REGISTRY))
def test_empty_optional_sections_leave_no_heading_behind(template_id):
    html = _render_html(MINIMAL, template_id)
    # Section headings only — the word may legitimately appear in body text.
    headings = re.findall(r'class="[^"]*section-title[^"]*"[^>]*>([^<]+)<', html)
    headings += re.findall(r"<h[23][^>]*>([^<]+)</h[23]>", html)
    rendered = {h.strip() for h in headings}
    for label in ABSENT_WHEN_EMPTY:
        assert label not in rendered, \
            f"{template_id} printed an empty {label!r} heading"


@pytest.mark.parametrize("template_id", sorted(TEMPLATE_REGISTRY))
def test_the_sections_that_do_have_content_still_render(template_id):
    """A test that passes by rendering an empty document would be worthless."""
    html = _render_html(MINIMAL, template_id)
    assert "Sara Al-Otaibi" in html
    assert "KSU" in html
