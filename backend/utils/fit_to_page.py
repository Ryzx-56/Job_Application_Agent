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


def _page_count(pdf_bytes: bytes) -> int:
    return len(PdfReader(BytesIO(pdf_bytes)).pages)


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
    """
    template = jinja_env.get_template(template_name)
    scale = 1.0
    last_pdf_bytes = None

    def render_at(s: float) -> bytes:
        context["cv_scale"] = round(s, 3)
        html = template.render(**context)
        if html_transform:
            html = html_transform(html)
        return _render(html, base_url)

    for i in range(MAX_ITERATIONS):
        pdf_bytes = render_at(scale)
        pages = _page_count(pdf_bytes)
        last_pdf_bytes = pdf_bytes

        if pages == 1:
            if scale >= MAX_SCALE:
                break
            trial_scale = round(min(scale + STEP, MAX_SCALE), 3)
            trial_pdf = render_at(trial_scale)
            if _page_count(trial_pdf) == 1:
                scale = trial_scale
                last_pdf_bytes = trial_pdf
                continue
            else:
                break
        else:
            if scale <= MIN_SCALE:
                logger.warning(
                    f"fit_to_page: content still spans {pages} pages at MIN_SCALE "
                    f"({MIN_SCALE}). Returning as-is rather than shrinking further."
                )
                break
            scale = round(max(scale - STEP, MIN_SCALE), 3)

    return last_pdf_bytes
