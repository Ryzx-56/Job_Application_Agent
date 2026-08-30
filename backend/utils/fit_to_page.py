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
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import url2pathname

import fitz  # PyMuPDF — already used by utils/pdf_parser.py
from weasyprint import HTML, default_url_fetcher
from pypdf import PdfReader
from loguru import logger

# The only directories a rendered document may read files from. Both hold
# assets we ship: the CV templates and the bundled Arabic fonts.
_BACKEND_DIR = Path(__file__).resolve().parent.parent
_ALLOWED_ASSET_ROOTS = (
    (_BACKEND_DIR / "templates").resolve(),
    (_BACKEND_DIR / "assets").resolve(),
)

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


# ─── CLIPPING GUARD ────────────────────────────────────────────────────────
# A template whose CSS pins the document to one page box makes WeasyPrint
# CLIP the overflow instead of paginating it. The result is a short PDF that
# every check here reads as a perfect fit: 04_sidebar_dark.html did exactly
# this, returning one page holding 4 of a CV's 16 jobs, and the search below
# returned it at MAX_SCALE — the largest type, so the fewest entries — on the
# very first pass. Nothing logged, nothing failed, the user got a gutted CV.
#
# WHAT THIS COMPARES, AND WHY NOT THE OBVIOUS THING. The first version of
# this guard compared renders at two scales, on the theory that shrinking the
# type would reveal content a clipping template had dropped. It does not: the
# clip box is `height: 100%` and `--cv-scale` is applied with `zoom`, so the
# box shrinks with the text and exactly as much content survives at 0.82 as at
# 1.25. Measured on the real bug — 4 of 16 entries at both scales — so that
# guard would have sat there catching nothing. It is replaced by a comparison
# against the CONTENT WE ASKED FOR, which is the only reference that cannot
# itself be clipped.
#
# Glyphs drawn vs. characters in the context. Measured, not guessed:
#
#   0.29  04_sidebar_dark.html WITH the bug, long CV, at MAX_SCALE
#   0.70  healthy floor — a one-job CV in sidebar_dark, the template whose
#         fixed chrome is the largest share of a small document
#   0.86  healthy floor for an ordinary short CV
#   0.96-1.00  every template, long CV, both languages
#
# 0.5 sits in the empty band between the broken case and the healthy floor
# with roughly equal margin either side. Counting DRAWN GLYPHS rather than
# extracted text is deliberate: extraction is not trustworthy here (Arabic
# PDFs decode badly, see pdf_generator.py), while glyph counting never
# decodes anything and so behaves identically in both languages — the Arabic
# ratios above are in the same band as the English ones for that reason.
CLIPPING_MIN_RATIO = 0.5

# Below this the ratio gets noisy (fixed template chrome dominates) and there
# is no meaningful amount of content to lose.
MIN_MEASURABLE_CHARS = 500


class ContentClippedError(RuntimeError):
    """
    Raised when the rendered PDF is missing a large fraction of the content
    it was given.

    Deliberately fatal rather than a warning. main.py renders inside the try
    block that refunds the credit and returns an error to the user, so
    raising turns a silently gutted CV into a refunded failure — which is the
    entire point of the brief's rule that page-fitting must never drop real
    content. A logged warning would leave the broken document in the user's
    hands, which is the bug, not the fix.
    """


def _page_count(pdf_bytes: bytes) -> int:
    return len(PdfReader(BytesIO(pdf_bytes)).pages)


def _glyph_count(pdf_bytes: bytes) -> int:
    """
    How many glyphs the PDF actually draws.

    get_texttrace() reports the glyph ids handed to the text operators, so
    this counts marks on the page rather than characters recovered from a
    ToUnicode table. Returns -1 if it cannot measure, which the caller
    treats as "no opinion" rather than as a failure — a guard that breaks
    rendering when it cannot run is worse than the bug it guards against.
    """
    try:
        with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
            return sum(
                len(span.get("chars", ()))
                for page in doc
                for span in page.get_texttrace()
            )
    except Exception as e:
        logger.warning(f"fit_to_page: couldn't count glyphs, clipping guard inactive: {e}")
        return -1


# Context keys that hold EMBEDDED ASSETS rather than text the reader sees.
#
# `photo` is a base64 JPEG data URI (see utils/cv_photo.py) — tens of
# thousands of characters that draw zero glyphs. Counting it as "content
# we asked for" would push `expected` far past what any template could
# possibly draw, dropping the ratio below CLIPPING_MIN_RATIO and raising
# ContentClippedError on a perfectly good CV. That error is fatal by design:
# it refunds the credit and hands the user a failure. So a photo template
# would have failed 100% of the time for anyone who has a photo, which is
# precisely the population it exists for.
_NON_CONTENT_CONTEXT_KEYS = {"photo"}


def _context_text_length(context: dict) -> int:
    """
    Rough size of the readable content being rendered, straight off the
    context. Embedded assets are excluded — see _NON_CONTENT_CONTEXT_KEYS.
    """
    total = 0
    stack = [context]
    while stack:
        item = stack.pop()
        if isinstance(item, str):
            # Belt-and-braces alongside the key check below: any future
            # context value carrying an inline asset is skipped on sight,
            # wherever in the tree it turns up.
            if not item.startswith("data:"):
                total += len(item)
        elif isinstance(item, dict):
            stack.extend(
                value for key, value in item.items()
                if key not in _NON_CONTENT_CONTEXT_KEYS
            )
        elif isinstance(item, (list, tuple)):
            stack.extend(item)
    return total


def _assert_nothing_clipped(pdf_bytes: bytes, context: dict, template_name: str) -> bytes:
    """
    Fails the render if the PDF drew far less than the context contained.

    Returns the PDF unchanged when it can't measure (a broken guard must not
    break rendering) or when there is too little content to judge.
    """
    expected = _context_text_length(context)
    if expected < MIN_MEASURABLE_CHARS:
        return pdf_bytes

    drawn = _glyph_count(pdf_bytes)
    if drawn < 0:
        return pdf_bytes

    ratio = drawn / expected
    if ratio < CLIPPING_MIN_RATIO:
        raise ContentClippedError(
            f"{template_name} rendered only {drawn} glyphs for {expected} characters of "
            f"content ({ratio:.0%}, floor {CLIPPING_MIN_RATIO:.0%}) across "
            f"{_page_count(pdf_bytes)} page(s) — the template is clipping overflow instead of "
            f"paginating it, so most of this CV is missing. A fixed height on html/body, or a "
            f"container that cannot fragment across pages, causes this."
        )
    logger.debug(f"fit_to_page: {template_name} drew {drawn} glyphs for {expected} chars ({ratio:.0%}).")
    return pdf_bytes


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


class BlockedResourceError(Exception):
    """Raised when a rendered document asks for a resource we refuse to load."""


def _local_only_url_fetcher(url: str):
    """
    The only resources a CV may load: `data:` URIs, and files that live inside
    the templates directory.

    WHY. WeasyPrint resolves every url() and every <img src> it finds, over
    the network, from the render process. Any content that reaches the
    document can therefore make the SERVER issue a request — that was a
    confirmed SSRF here, reachable by putting a tag in a CV field, and
    verified against a local listener before this was added.

    Escaping the templates closes the injection. This closes the CAPABILITY,
    so a future template or a missed escape cannot reopen it. Both are worth
    having: the escaping is the fix, this is the thing that stays true when
    someone edits a template a year from now.

    The candidate photo is a base64 `data:` URI (see utils/cv_photo.py) and
    the Arabic fonts are loaded as `file:` URIs from assets/, so nothing
    legitimate needs the network.
    """
    if url.startswith("data:"):
        return default_url_fetcher(url)

    if url.startswith("file:"):
        try:
            path = Path(url2pathname(urlparse(url).path)).resolve()
        except Exception as err:
            raise BlockedResourceError(f"Unresolvable local resource: {url}") from err
        for allowed in _ALLOWED_ASSET_ROOTS:
            if path == allowed or allowed in path.parents:
                return default_url_fetcher(url)
        raise BlockedResourceError(f"Local resource outside the allowed roots: {path}")

    # http, https, ftp, and anything else. This is the SSRF door.
    raise BlockedResourceError(f"Blocked remote resource request from a rendered document: {url}")


def _render(html: str, base_url: str | None) -> bytes:
    buf = BytesIO()
    HTML(string=html, base_url=base_url, url_fetcher=_local_only_url_fetcher).write_pdf(buf)
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

    # Every return below goes through _assert_nothing_clipped. The check reads
    # the context, not a second render, so it costs nothing extra and — unlike
    # the page-count tests around it — it cannot be fooled by a template that
    # clips its overflow into a tidy one-page PDF.
    check = lambda pdf: _assert_nothing_clipped(pdf, context, template_name)

    # Best case: full-size content already fits in one page — no search needed.
    # This is the exact line that shipped the gutted CV: a clipped render is
    # one page, so it returned here on the very first pass, at the largest
    # scale and therefore with the least content.
    max_pdf = render_at(MAX_SCALE)
    if _page_count(max_pdf) == 1:
        return check(max_pdf)

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
                    return check(rescue_pdf)
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
        return check(min_pdf)

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

    return check(best_pdf)
