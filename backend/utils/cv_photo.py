# utils/cv_photo.py
"""
Pulls the candidate's photo out of an uploaded CV.

NO LLM IS INVOLVED HERE, deliberately. Gemini's CV-parsing call in
agents/cv_parser.py keeps receiving text only (see extract_text_from_pdf in
utils/pdf_parser.py) — a vision call to read a headshot would cost tokens on
every single upload to recover an asset the file already contains verbatim.
Both libraries the parsing layer already uses can hand over embedded images
directly: PyMuPDF for PDF, python-docx for .docx. This module is that
extraction step and nothing else.

WHAT COMES OUT. A `data:` URI (JPEG, base64) or None. A data URI rather than
a file on disk or a Supabase Storage object because of how rendering
actually works in this codebase:

  · WeasyPrint resolves `data:` URIs natively, so a template just does
    <img src="{{ photo }}"> with no base_url, no fetch, no temp file.
  · Rendered documents are NOT stored — main.py saves a small
    generation_snapshot per resume and core/documents.py re-renders on
    demand. A photo living on this backend's local disk would be gone by
    the time someone downloads their CV again (Render's filesystem is
    ephemeral and the instance spins down when idle), so the photo has to
    travel inside the snapshot exactly like every other render input does.
  · No new bucket, no RLS policy, no signed URLs, no orphaned-object
    cleanup job.

The tradeoff is snapshot size, which is why _to_data_uri caps hard: longest
edge MAX_PHOTO_EDGE, JPEG, and a byte ceiling that drops the photo entirely
rather than bloating a row. A typical headshot lands around 25-45 KB.

WHICH IMAGE. A CV can embed several images — a university logo, a QR code,
social icons, a decorative header rule, a signature scan — and only one of
them is the candidate. There is no metadata that says which, so this scores
candidates on what a headshot actually looks like as an image:

  · big enough to be a photo, small enough not to be a scanned page
  · roughly square to portrait (logos and signature scans are wide;
    a full-page scan fails the area test above)
  · genuinely photographic — a resized-with-NEAREST sample of a photo has
    hundreds of distinct colours, while flat art (logo, QR code, icon)
    has a handful. This is the check that removes crisp square logos,
    which pass every geometric test.

Nothing here raises. A CV with no photo, an unreadable image, or a failure
anywhere in this module all mean the same thing to the caller — no photo —
and must never cost a user their generation.
"""

import base64
import io

from loguru import logger

# ── Output normalization ───────────────────────────────────────────────────
MAX_PHOTO_EDGE = 512          # px, longest edge; a CV photo prints ~1 inch
JPEG_QUALITY = 80
MAX_DATA_URI_BYTES = 260_000  # ceiling on the base64 string kept per resume

# ── "Is this a headshot?" heuristics ───────────────────────────────────────
_MIN_PIXEL_EDGE = 90          # below this it's an icon, not a face
_MIN_ASPECT = 0.45            # width / height. Portrait 3:4 = 0.75
_MAX_ASPECT = 1.5             # square-ish is fine; a wide strip is a banner
_MIN_PAGE_AREA = 0.003        # of the page — smaller is a bullet glyph/icon
_MAX_PAGE_AREA = 0.30         # larger is a scanned page, not a portrait
_MIN_DISTINCT_COLORS = 40     # flat art vs. photograph, see module docstring
_COLOR_SAMPLE_EDGE = 64       # sample size for the colour-variety test
_PAGES_TO_SCAN = 2            # a photo is on page 1, occasionally page 2


def _pil():
    """Pillow is imported lazily so importing this module stays cheap and a
    broken Pillow install degrades to 'no photo' instead of breaking every
    import of utils/."""
    from PIL import Image, ImageOps

    return Image, ImageOps


def _distinct_colors(image) -> int:
    """
    How many distinct colours a small sample of the image contains.

    Resampled with NEAREST on purpose: any smooth resampling invents
    intermediate colours along the edges of flat art, which would let a
    two-colour logo score in the hundreds and defeat the whole check.
    """
    Image, _ = _pil()
    sample = image.convert("RGB").resize(
        (_COLOR_SAMPLE_EDGE, _COLOR_SAMPLE_EDGE), Image.NEAREST
    )
    return len(set(sample.getdata()))


def _looks_like_a_photograph(image) -> bool:
    width, height = image.size
    if min(width, height) < _MIN_PIXEL_EDGE:
        return False
    aspect = width / height if height else 0
    if not (_MIN_ASPECT <= aspect <= _MAX_ASPECT):
        return False
    return _distinct_colors(image) >= _MIN_DISTINCT_COLORS


def _open_image(raw: bytes):
    """Decodes image bytes, or None if Pillow can't read them."""
    Image, ImageOps = _pil()
    try:
        image = Image.open(io.BytesIO(raw))
        image.load()
        # Phone-camera photos pasted into a CV carry an EXIF rotation flag;
        # without this the headshot renders on its side.
        return ImageOps.exif_transpose(image)
    except Exception:
        return None


def _to_data_uri(image) -> str | None:
    """
    Downscales to MAX_PHOTO_EDGE and encodes as a base64 JPEG data URI.

    Returns None if the result would still exceed MAX_DATA_URI_BYTES — a
    photo is a nice-to-have and is not worth putting an oversized blob on
    every resumes row (and in every API response) for.
    """
    Image, _ = _pil()
    try:
        rgb = image.convert("RGB")
        rgb.thumbnail((MAX_PHOTO_EDGE, MAX_PHOTO_EDGE), Image.LANCZOS)
        buffer = io.BytesIO()
        rgb.save(buffer, format="JPEG", quality=JPEG_QUALITY, optimize=True)
        encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    except Exception as e:
        logger.warning(f"📷 Could not re-encode the extracted CV photo: {e}")
        return None

    if len(encoded) > MAX_DATA_URI_BYTES:
        logger.warning(
            f"📷 Extracted CV photo is {len(encoded)} base64 bytes, over the "
            f"{MAX_DATA_URI_BYTES} ceiling — skipping it rather than storing it."
        )
        return None
    return f"data:image/jpeg;base64,{encoded}"


# ── PDF ────────────────────────────────────────────────────────────────────

def _pdf_candidates(file_bytes: bytes) -> list[tuple[tuple, object]]:
    """
    Every embedded image on the first few pages that passes the headshot
    tests, paired with a sort key. Lower key sorts first:
      (page index, vertical position, negative area)
    i.e. earliest page, then highest on that page, then largest — which is
    where a CV photo sits in every layout this codebase renders.
    """
    import fitz

    candidates: list[tuple[tuple, object]] = []
    with fitz.open(stream=file_bytes, filetype="pdf") as doc:
        for page_index in range(min(len(doc), _PAGES_TO_SCAN)):
            page = doc[page_index]
            page_area = abs(page.rect.get_area()) or 1.0
            seen_xrefs: set[int] = set()

            # get_image_info gives the PLACED rectangle, not just the stored
            # bitmap — that is what makes the page-area tests meaningful (a
            # 2000px logo scaled down to a 20pt square is an icon on the page,
            # whatever its stored resolution says).
            for info in page.get_image_info(xrefs=True):
                xref = info.get("xref") or 0
                if xref <= 0 or xref in seen_xrefs:
                    continue
                seen_xrefs.add(xref)

                x0, y0, x1, y1 = info.get("bbox", (0, 0, 0, 0))
                placed_area = abs((x1 - x0) * (y1 - y0))
                fraction = placed_area / page_area
                if not (_MIN_PAGE_AREA <= fraction <= _MAX_PAGE_AREA):
                    continue

                try:
                    raw = doc.extract_image(xref).get("image")
                except Exception:
                    continue
                image = _open_image(raw) if raw else None
                if image is None or not _looks_like_a_photograph(image):
                    continue

                candidates.append(((page_index, round(y0), -placed_area), image))

    return candidates


# ── DOCX ───────────────────────────────────────────────────────────────────

def _docx_candidates(file_bytes: bytes) -> list[tuple[tuple, object]]:
    """
    Same idea for Word files. python-docx exposes every embedded image part
    regardless of whether it was placed inline or floating, which matters
    because a photo in a .docx CV is very often anchored/floating and so
    absent from inline_shapes.

    There is no page geometry to test against here (Word has no fixed
    layout until it is rendered), so this leans entirely on the pixel-level
    tests — which is exactly what they exist for. Ordering falls back to
    document part order, then largest.
    """
    from docx import Document

    document = Document(io.BytesIO(file_bytes))
    candidates: list[tuple[tuple, object]] = []

    for order, part in enumerate(document.part.package.image_parts):
        image = _open_image(part.blob)
        if image is None or not _looks_like_a_photograph(image):
            continue
        width, height = image.size
        candidates.append(((0, order, -(width * height)), image))

    return candidates


# ── Public entry point ─────────────────────────────────────────────────────

def extract_candidate_photo(file_bytes: bytes | None) -> str | None:
    """
    Best-effort candidate photo from an uploaded CV, as a JPEG data URI.

    Returns None for: no file, an unrecognized format, a CV with no images,
    a CV whose only images are logos/icons/QR codes, or any failure inside
    this module. Callers treat all of those identically — the photo slot in
    a template is optional and simply doesn't render.
    """
    if not file_bytes:
        return None

    # Same magic-byte sniffing as utils/pdf_parser.py rather than trusting a
    # filename, and for the same reason: extensions are frequently wrong on
    # files exported from phones.
    from utils.pdf_parser import _looks_like_docx, _looks_like_pdf

    try:
        if _looks_like_pdf(file_bytes):
            candidates = _pdf_candidates(file_bytes)
        elif _looks_like_docx(file_bytes):
            candidates = _docx_candidates(file_bytes)
        else:
            return None
    except Exception as e:
        # A CV we can't mine for images is a CV without a photo, never a
        # failed generation. The text extraction that actually matters has
        # already succeeded by the time this runs.
        logger.warning(f"📷 CV photo extraction failed, continuing without a photo: {e}")
        return None

    if not candidates:
        return None

    candidates.sort(key=lambda pair: pair[0])
    photo = _to_data_uri(candidates[0][1])
    if photo:
        logger.info(
            f"📷 Extracted a candidate photo from the uploaded CV "
            f"({len(candidates)} image(s) qualified, {len(photo)} bytes stored, no LLM call)."
        )
    return photo
