# utils/fit_to_page.py
"""
Replaces fit_to_page.js.

Why the .js version doesn't belong in this codebase: it assumed a headless
BROWSER (Puppeteer/Playwright) rendering the page, so it could call
document.querySelector(...).scrollHeight to measure real content height and
adjust a CSS variable in a tight loop, all inside one live DOM.

This backend renders HTML -> PDF with WeasyPrint, a pure-Python library with
no JavaScript engine and no live DOM to query — there is nothing that would
ever execute fit_to_page.js's code. The underlying idea (render, measure,
adjust a --cv-scale CSS variable, re-render, repeat) still applies, it just
has to be redone as a Python loop that measures the actual rendered PDF
instead of a browser DOM.

Measurement here uses page COUNT (via pypdf) rather than exact content
height in px, since WeasyPrint doesn't expose the layout engine's content
height directly. This is a coarser signal than the JS version had, but it's
enough to solve the two real problems: a one-page CV with dead space at the
bottom (scale up until it's about to spill to page 2, then back off one
step), and a CV that spills a few lines onto an almost-empty page 2 (scale
down until it fits on one page).
"""

from io import BytesIO
from weasyprint import HTML
from pypdf import PdfReader
from loguru import logger

MIN_SCALE = 0.82
MAX_SCALE = 1.25
STEP = 0.02
MAX_ITERATIONS = 14

# Rescue pass: MIN_SCALE is a floor chosen for readability on genuinely long
# CVs — going below it would make a dense, content-heavy page uncomfortably
# small. But a CV that only spills a couple of lines onto an otherwise-empty
# final page (e.g. just "Certifications") isn't "genuinely long," it's a
# near-miss, and deserves a bit more squeeze rather than the same 2-page
# fallback as someone with a genuinely overflowing CV. This only ever
# engages after MIN_SCALE has already failed AND the overflow page is
# sparse — a real long CV still stops at MIN_SCALE exactly like before.
RESCUE_MIN_SCALE = 0.76
RESCUE_STEP = 0.01
SPARSE_PAGE_CHAR_THRESHOLD = 300  # ~a section heading plus one or two short lines


def _page_count(pdf_bytes: bytes) -> int:
    return len(PdfReader(BytesIO(pdf_bytes)).pages)


def _trailing_page_char_count(pdf_bytes: bytes) -> int:
    """
    How much real text is on the LAST page of the current render. Used only
    to decide whether a 2-page result is a "near miss" (a handful of
    leftover characters, like a single spilled section) worth rescuing, vs.
    a genuinely long CV where forcing one page would make the text too
    small to read. pypdf's extract_text() is a coarse, whitespace-heavy
    signal, not exact — that's fine here, this only needs to distinguish
    "a little" from "a lot," not measure precisely.
    """
    try:
        reader = PdfReader(BytesIO(pdf_bytes))
        return len((reader.pages[-1].extract_text() or "").strip())
    except Exception as e:
        logger.warning(f"fit_to_page: couldn't measure trailing page content, skipping rescue pass: {e}")
        return SPARSE_PAGE_CHAR_THRESHOLD + 1  # treat as "not sparse" — safe default, no rescue attempted


def _render(html: str, base_url: str | None) -> bytes:
    buf = BytesIO()
    HTML(string=html, base_url=base_url).write_pdf(buf)
    return buf.getvalue()


def render_html_fit_to_page(jinja_env, template_name: str, context: dict,
                             base_url: str | None = None, html_transform=None) -> bytes:
    """
    Renders `template_name` with `context` via `jinja_env`, adjusting
    context["cv_scale"] between attempts until the output is a single,
    well-filled page.

    html_transform, if given, is applied to the rendered HTML string before
    each PDF render (e.g. injecting Arabic RTL/font overrides) so the page
    count measured during the fit search matches the real final layout,
    instead of fitting against an untransformed render and hoping the
    transform doesn't change how much content fits.

    Returns the final PDF bytes. If content is too long to ever fit on one
    page even at MIN_SCALE, returns the MIN_SCALE render as-is (2 dense
    pages beats unreadable 0.8-scale-and-still-overflowing text).

    SPEED: page-count vs. scale is monotonic — a larger scale never fits
    into fewer pages than a smaller one — so the search for "the largest
    scale that still fits on one page" is a textbook binary search over the
    [MIN_SCALE, MAX_SCALE] range, rather than a linear step-by-STEP climb.
    This cuts the typical number of full WeasyPrint render passes (the
    expensive part — each is a fresh HTML->PDF layout) from up to
    MAX_ITERATIONS (14) down to roughly log2(range/STEP) + 2 (~7), which is
    the biggest chunk of the "optimizing" delay users see after every agent
    has already finished. The two boundary checks plus the rescue pass
    behavior (for a near-miss 2-page result at MIN_SCALE) are unchanged.
    """
    template = jinja_env.get_template(template_name)

    def render_at(s: float) -> bytes:
        context["cv_scale"] = round(s, 3)
        html = template.render(**context)
        if html_transform:
            html = html_transform(html)
        return _render(html, base_url)

    # Best case: full-size content already fits in one page — no search needed.
    max_pdf = render_at(MAX_SCALE)
    if _page_count(max_pdf) == 1:
        return max_pdf

    # Floor case: even the smallest allowed scale doesn't fit on one page —
    # this is the "genuinely long CV" (or near-miss) path, same as before.
    min_pdf = render_at(MIN_SCALE)
    pages_at_min = _page_count(min_pdf)
    if pages_at_min > 1:
        sparse_chars = _trailing_page_char_count(min_pdf)
        if sparse_chars <= SPARSE_PAGE_CHAR_THRESHOLD:
            logger.info(
                f"fit_to_page: {pages_at_min} pages at MIN_SCALE ({MIN_SCALE}), but the "
                f"trailing page only has ~{sparse_chars} chars — attempting a rescue "
                f"pass down to {RESCUE_MIN_SCALE} to reclaim it onto one page."
            )
            rescue_scale = MIN_SCALE
            while rescue_scale > RESCUE_MIN_SCALE:
                rescue_scale = round(max(rescue_scale - RESCUE_STEP, RESCUE_MIN_SCALE), 3)
                rescue_pdf = render_at(rescue_scale)
                if _page_count(rescue_pdf) == 1:
                    logger.info(f"fit_to_page: rescue succeeded at scale {rescue_scale}.")
                    return rescue_pdf
            logger.warning(
                f"fit_to_page: rescue pass reached {RESCUE_MIN_SCALE} and still "
                f"didn't fit — returning the {pages_at_min}-page MIN_SCALE result as-is."
            )
        else:
            logger.warning(
                f"fit_to_page: content still spans {pages_at_min} pages at MIN_SCALE "
                f"({MIN_SCALE}), and the trailing page has real content "
                f"(~{sparse_chars} chars) — not a rescue candidate. Returning as-is "
                f"rather than shrinking a genuinely long CV to an unreadable size."
            )
        return min_pdf

    # Normal case: MIN_SCALE fits, MAX_SCALE doesn't — binary search the
    # boundary between them for the largest scale that still fits.
    lo, hi = MIN_SCALE, MAX_SCALE
    best_pdf, best_scale = min_pdf, MIN_SCALE
    for _ in range(MAX_ITERATIONS):
        if hi - lo <= STEP:
            break
        # Snap the midpoint to the STEP grid so results stay consistent with
        # the granularity the rescue pass and MIN/MAX bounds already use.
        raw_mid = (lo + hi) / 2
        mid = round(round(raw_mid / STEP) * STEP, 3)
        if mid <= lo or mid >= hi:
            break
        pdf_bytes = render_at(mid)
        if _page_count(pdf_bytes) == 1:
            lo, best_pdf, best_scale = mid, pdf_bytes, mid
        else:
            hi = mid

    return best_pdf
