"""
The page-overflow guard in utils/fit_to_page.py.

ContentClippedError is FATAL: main.py renders inside the block that refunds
the credit, so a false positive here charges nothing but hands a paying user
a failed generation for a PDF that was fine. Both directions are tested,
because a guard that cannot fire is as wrong as one that fires on good work.
"""
import pytest
from weasyprint import HTML

from utils.fit_to_page import (
    ContentClippedError,
    _assert_nothing_clipped,
    _context_text_length,
    CLIPPING_MIN_RATIO,
    MIN_MEASURABLE_CHARS,
)

# Long enough to be past MIN_MEASURABLE_CHARS on candidate content alone.
_PARAGRAPH = (
    "Led the migration of the ticketing platform to a new provider, cutting "
    "average first-response time from four hours to under forty minutes and "
    "retiring three legacy queues. Trained eleven staff on the new workflow. "
)


def _long_context(paragraphs: int = 6) -> dict:
    return {
        "personal": {"name": "Test Candidate", "email": "t@example.com"},
        "tailored_summary": _PARAGRAPH,
        "experience": [
            {"title": "Support Engineer", "company": "Acme", "dates": "2020 - 2024",
             "bullets": [_PARAGRAPH]}
            for _ in range(paragraphs)
        ],
        # Chrome and duplicated views, which must NOT be counted.
        "labels": {f"label_{i}": f"Section Heading {i}" for i in range(28)},
        "contact_items": [{"value": "t@example.com"}, {"value": "+966500000000"}],
        "contact_lines": ["t@example.com | +966500000000 | Riyadh"],
        "template_id": "07_compact_ats",
        "publications_dir": "ltr",
        "is_arabic": False,
    }


def _pdf(body_html: str, clipping: bool) -> bytes:
    """
    `clipping=True` reproduces the real failure mode this guard exists for:
    a fixed-height container that cannot fragment across pages, so overflow
    is discarded rather than paginated. (A height on html/body alone does
    NOT do it — weasyprint paginates that correctly.)
    """
    page = "@page{size:A4;margin:10mm}body{margin:0}"
    if clipping:
        style = page + "#wrap{height:240mm;overflow:hidden}"
    else:
        style = page + "#wrap{}"
    return HTML(
        string=f"<style>{style}</style><body><div id='wrap'>{body_html}</div></body>"
    ).write_pdf()


def test_chrome_and_duplicate_views_are_not_counted_as_content():
    """The denominator is the candidate's own text, not the render context."""
    ctx = _long_context()
    counted = _context_text_length(ctx)

    # None of the chrome keys may contribute.
    for chrome_key in ("labels", "contact_items", "contact_lines",
                       "template_id", "publications_dir"):
        stripped = dict(ctx)
        stripped.pop(chrome_key)
        assert _context_text_length(stripped) == counted, (
            f"{chrome_key!r} is being counted as candidate content; it is "
            "template chrome or a duplicate view of data already counted."
        )

    # The candidate's actual text is counted.
    assert counted > len(_PARAGRAPH)


def test_short_arabic_cv_is_not_reported_as_clipped():
    """
    THE REGRESSION. A fresh graduate's Arabic CV — little content, full
    template chrome — measured 847 'expected' chars against 280 drawn
    glyphs (33%, floor 50%) and was refunded as a clipped render. The PDF
    was correct; 44% of the expectation was 28 section labels of which five
    were drawn, plus the same contact block counted three times.
    """
    short_ar = {
        "personal": {"name": "عبدالله الحربي", "email": "a@example.com",
                     "phone": "+966500000000", "location": "الرياض"},
        "tailored_summary": "خريج تقنية معلومات، بنى نظام تذاكر للدعم الفني.",
        "education": [{"institution": "جامعة الملك سعود",
                       "degree": "بكالوريوس تقنية المعلومات"}],
        "projects": [{"name": "نظام تذاكر الدعم"}],
        "certifications": ["CompTIA A+"],
        "labels": {f"label_{i}": f"عنوان القسم {i}" for i in range(28)},
        "contact_items": [{"value": "a@example.com"}, {"value": "+966500000000"}],
        "contact_lines": ["a@example.com | +966500000000 | الرياض"],
        "template_id": "07_compact_ats",
        "is_arabic": True,
    }
    pdf = _pdf("<p>خريج تقنية معلومات، بنى نظام تذاكر للدعم الفني.</p>", clipping=False)
    # Must not raise.
    assert _assert_nothing_clipped(pdf, short_ar, "07_compact_ats.html") is pdf


def test_a_genuinely_clipped_render_still_fails():
    """The guard must still catch a template that clips instead of paginating."""
    ctx = _long_context(paragraphs=40)
    assert _context_text_length(ctx) > MIN_MEASURABLE_CHARS

    body = "".join(f"<p>{_PARAGRAPH}</p>" for _ in range(40))
    clipped = _pdf(body, clipping=True)

    with pytest.raises(ContentClippedError):
        _assert_nothing_clipped(clipped, ctx, "broken_template.html")


def test_the_same_content_paginated_passes():
    """Same content, same length — allowed to flow onto more pages."""
    ctx = _long_context(paragraphs=40)
    body = "".join(f"<p>{_PARAGRAPH}</p>" for _ in range(40))
    fine = _pdf(body, clipping=False)

    assert _assert_nothing_clipped(fine, ctx, "good_template.html") is fine
