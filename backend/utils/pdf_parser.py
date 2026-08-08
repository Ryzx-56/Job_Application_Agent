import io

import fitz


class UnsupportedCVFormat(ValueError):
    """
    The uploaded file isn't a CV we can read. Raised with a message that is
    safe to show the user directly — main.py turns it into a 400 rather than
    the 500 an unhandled PyMuPDF error used to produce.
    """


def _extract_text_from_docx(file_bytes: bytes) -> str:
    """
    BUG FIX: the upload input accepts ".pdf,.docx" (see the file input in
    components/dashboard.tsx), but this module only ever handled PDF —
    fitz.open(..., filetype="pdf") on a .docx raises FileDataError("Failed
    to open stream"). That propagated out of the endpoint as an unhandled
    500, which is why uploading a Word CV failed every time regardless of
    output language. python-docx is already a dependency (utils/docx_generator.py
    writes .docx with it), so reading one costs nothing extra.

    Pulls paragraph text AND table cell text — plenty of real CVs lay their
    contact block or skills grid out in a table, and paragraphs alone would
    silently drop it.
    """
    from docx import Document  # local import: only needed on the .docx path

    document = Document(io.BytesIO(file_bytes))
    parts = [p.text for p in document.paragraphs]
    for table in document.tables:
        for row in table.rows:
            for cell in row.cells:
                parts.append(cell.text)
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
