import io

import fitz


class UnsupportedCVFormat(ValueError):
    """
    The uploaded file isn't a CV we can read. Raised with a message that is
    safe to show the user directly — main.py turns it into a 400 rather than
    the 500 an unhandled PyMuPDF error used to produce.
    """


# Guards the recursive walk below against a pathological (or hand-crafted)
# nesting depth. Real CVs nest a table two or three deep at most.
_MAX_DOCX_NESTING_DEPTH = 12

# Word writes a text box TWICE for backwards compatibility: once under
# mc:Choice (the modern DrawingML shape) and again under mc:Fallback (the
# legacy VML one), each wrapping an identical w:txbxContent. Reading both
# would emit every text box's contents twice, so the fallback copy is
# skipped — same class of duplication as the merged-cell one below.
_MC_FALLBACK_TAG = "{http://schemas.openxmlformats.org/markup-compatibility/2006}Fallback"


def _inside_mc_fallback(element, stop_at) -> bool:
    """True if `element` sits under an mc:Fallback, walking up to `stop_at`."""
    node = element.getparent()
    while node is not None and node is not stop_at:
        if node.tag == _MC_FALLBACK_TAG:
            return True
        node = node.getparent()
    return False


def _text_box_paragraphs(p_element):
    """The w:p elements inside any text box anchored in this paragraph.

    A text box's content lives in a w:txbxContent buried inside a run, not
    in the paragraph's own runs, so Paragraph.text never sees it. Designed
    Word CVs routinely put the whole contact block in one.
    """
    from docx.oxml.ns import qn

    for txbx in p_element.iter(qn("w:txbxContent")):
        if _inside_mc_fallback(txbx, p_element):
            continue
        yield from txbx.iter(qn("w:p"))


def _collect_paragraph(paragraph, parts: list, seen: set, depth: int) -> None:
    """Append this paragraph's text, then any text boxes anchored in it."""
    from docx.text.paragraph import Paragraph

    if depth > _MAX_DOCX_NESTING_DEPTH or paragraph._p in seen:
        return
    seen.add(paragraph._p)

    if paragraph.text.strip():
        parts.append(paragraph.text)

    # A text box nested inside another text box would otherwise be emitted
    # twice — once by the outer .iter() and once on its own — which is what
    # `seen` above prevents.
    for boxed_p in _text_box_paragraphs(paragraph._p):
        _collect_paragraph(Paragraph(boxed_p, paragraph._parent), parts, seen, depth + 1)


def _collect_block_text(container, parts: list, seen: set, depth: int = 0) -> None:
    """Walk a body / cell / header / footer in reading order.

    iter_inner_content() yields paragraphs and tables interleaved in
    document order, so a CV whose sections alternate between the two comes
    out in the order a human reads it rather than "all prose, then all
    tables".
    """
    from docx.table import Table, _Cell
    from docx.text.paragraph import Paragraph

    if depth > _MAX_DOCX_NESTING_DEPTH:
        return

    for item in container.iter_inner_content():
        if isinstance(item, Paragraph):
            _collect_paragraph(item, parts, seen, depth)
        elif isinstance(item, Table):
            # iter_tcs() yields each w:tc EXACTLY ONCE. Iterating
            # `row.cells` instead — which is what this function used to do —
            # yields one entry per GRID POSITION, so a cell merged across n
            # columns is returned n times and a vertically merged cell is
            # returned again for every row it spans. On a CV laid out as one
            # big 47x4 table that re-emitted the same paragraphs up to 188
            # times, inflating raw_cv_text to ~207k characters and making a
            # perfectly good extraction read as 1% coverage against it (see
            # _pipeline_produced_usable_cv in main.py).
            for tc in item._tbl.iter_tcs():
                _collect_block_text(_Cell(tc, item), parts, seen, depth + 1)


def _header_footer_containers(document, kind: str):
    """Every distinct header (or footer) definition in the document.

    These are separate parts, invisible to the body walk above. Sections
    that inherit rather than define their own (is_linked_to_previous) are
    skipped: their content belongs to an earlier section that was already
    read, and touching ._element on one would make python-docx ADD an empty
    definition to the document rather than just read it.
    """
    emitted = []
    for section in document.sections:
        for attr in (kind, f"first_page_{kind}", f"even_page_{kind}"):
            container = getattr(section, attr, None)
            if container is None or container.is_linked_to_previous:
                continue
            element = container._element
            if any(element is seen_element for seen_element in emitted):
                continue
            emitted.append(element)
            yield container


def _extract_text_from_docx(file_bytes: bytes) -> str:
    """
    BUG FIX: the upload input accepts ".pdf,.docx" (see the file input in
    components/dashboard.tsx), but this module only ever handled PDF —
    fitz.open(..., filetype="pdf") on a .docx raises FileDataError("Failed
    to open stream"). That propagated out of the endpoint as an unhandled
    500, which is why uploading a Word CV failed every time regardless of
    output language. python-docx is already a dependency (utils/docx_generator.py
    writes .docx with it), so reading one costs nothing extra.

    Reads paragraphs, tables (including tables nested inside table cells),
    text boxes, and page headers/footers, in reading order. A Word CV
    commonly puts ALL of its content in a table, its contact block in a
    header or a floating text box, and its skills grid in a table nested
    inside another table's cell — none of which the previous
    paragraphs-plus-top-level-tables read could see.

    Every unit of text is emitted exactly once. See the notes on
    iter_tcs() and mc:Fallback above for the two places Word represents the
    same content more than once.
    """
    from docx import Document  # local import: only needed on the .docx path

    document = Document(io.BytesIO(file_bytes))
    parts: list[str] = []
    seen: set = set()

    # Header first, footer last — that's where they sit on the page, and a
    # contact block in a header belongs at the top of the extracted text.
    for header in _header_footer_containers(document, "header"):
        _collect_block_text(header, parts, seen)
    _collect_block_text(document, parts, seen)
    for footer in _header_footer_containers(document, "footer"):
        _collect_block_text(footer, parts, seen)

    return "\n".join(part for part in parts if part and part.strip()).strip()


def _looks_like_docx(file_bytes: bytes) -> bool:
    """
    .docx is a ZIP archive, so it starts with the "PK" local-file-header
    magic. Sniffing the bytes rather than trusting the filename means a
    correctly-formatted file still works when the extension is wrong or
    missing, which is common with files exported from phones.
    """
    return file_bytes[:2] == b"PK"


def _looks_like_pdf(file_bytes: bytes) -> bool:
    return file_bytes[:5] == b"%PDF-"


def extract_text_from_pdf(pdf_path: str = None, pdf_bytes: bytes = None) -> str:
    '''
    Extracts raw text from an uploaded CV — PDF or DOCX.

    Accepts EITHER a file path (pdf_path) OR raw file bytes (pdf_bytes) —
    pdf_bytes is what you use for an uploaded file straight from FastAPI's
    UploadFile, since it never touches disk.

    Name kept as extract_text_from_pdf for compatibility with existing
    callers/tests; format is detected from the file's own magic bytes rather
    than its extension. Returns a single string with all pages concatenated.
    '''
    if pdf_bytes is None and pdf_path is None:
        raise ValueError("extract_text_from_pdf requires either pdf_path or pdf_bytes")

    if pdf_bytes is None:
        with open(pdf_path, "rb") as handle:
            pdf_bytes = handle.read()

    if not pdf_bytes:
        raise UnsupportedCVFormat("That file appears to be empty. Please upload a PDF or Word CV.")

    if _looks_like_docx(pdf_bytes):
        try:
            text = _extract_text_from_docx(pdf_bytes)
        except UnsupportedCVFormat:
            raise
        except Exception as e:
            raise UnsupportedCVFormat(
                "We couldn't read that Word file. Please re-save it as .docx or PDF and try again."
            ) from e
    elif _looks_like_pdf(pdf_bytes):
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        try:
            text = "".join(doc[page_num].get_text() for page_num in range(len(doc))).strip()
        finally:
            doc.close()
    else:
        raise UnsupportedCVFormat("Please upload your CV as a PDF or Word (.docx) file.")

    # A scanned/image-only PDF parses fine but yields nothing. Catching it
    # here means the user gets told to upload a text CV, instead of the
    # pipeline reserving a credit and then failing several agents later on
    # an empty facts_json.
    if not text.strip():
        raise UnsupportedCVFormat(
            "We couldn't find any text in that file. If it's a scanned CV, "
            "please upload a version with selectable text."
        )

    return text.strip()
