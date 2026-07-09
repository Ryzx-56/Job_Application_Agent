import fitz


def extract_text_from_pdf(pdf_path: str = None, pdf_bytes: bytes = None) -> str:
    '''
    Extracts raw text from a PDF file.
    Accepts EITHER a file path (pdf_path) OR raw file bytes (pdf_bytes) —
    pdf_bytes is what you use for an uploaded file straight from FastAPI's
    UploadFile, since it never touches disk.
    Returns a single string with all pages concatenated.
    '''
    if pdf_bytes is not None:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    elif pdf_path is not None:
        doc = fitz.open(pdf_path)
    else:
        raise ValueError("extract_text_from_pdf requires either pdf_path or pdf_bytes")

    full_text = ""
    for page_num in range(len(doc)):
        page = doc[page_num]
        full_text += page.get_text()

    doc.close()
    return full_text.strip()