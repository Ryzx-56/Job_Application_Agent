import fitz 

def extract_text_from_pdf(pdf_path: str) -> str: 
  '''
  Extracts raw text from a PDF File. 
  Returns a single string with all pages concatednated.
  '''
  doc = fitz.open(pdf_path)
  full_text = ""

  for page_num in range(len(doc)):
    page = doc[page_num]
    full_text += page.get_text()

  doc.close()
  return full_text.strip()