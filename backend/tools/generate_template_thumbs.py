"""
Regenerates the CV template preview images used by the dashboard's template
picker (frontend/public/templates/<template_id>.png).

Run it whenever a template's HTML changes, or when a template is added:

    python -m tools.generate_template_thumbs            # every template
    python -m tools.generate_template_thumbs portrait_rail portrait_band

Run from the `backend/` directory. Needs no API keys and makes no network
calls — it renders the real Jinja templates through the real
render_cv_pdf path with the fixed sample candidate below, then rasterises
page 1.

WHY THE SAMPLE IS HARDCODED HERE. Every thumbnail must show the SAME
candidate, or the picker becomes a grid of different people and the user
ends up comparing content instead of layout. SAMPLE below reproduces the
candidate already visible in the eleven original thumbnails, so newly
generated images sit next to the older ones without a visible seam.

The portrait is drawn, not photographed: a generic head-and-shoulders
silhouette with no face, so the preview shows where a photo goes without
putting a real person (or a stock model) in the product.
"""

import io
import os
import sys
from pathlib import Path

import fitz
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from utils.pdf_generator import render_cv_pdf                      # noqa: E402
from utils.template_registry import TEMPLATE_REGISTRY, template_supports_photo  # noqa: E402

OUT_DIR = Path(__file__).resolve().parent.parent.parent / "frontend" / "public" / "templates"

# Matches the existing eleven images exactly: 900px wide, cropped to 1164
# tall from the top. The picker crops further (aspect-[3/4], object-top),
# so the header and the start of the experience section are what actually
# show — which is where templates differ most.
THUMB_WIDTH = 900
THUMB_HEIGHT = 1164

SAMPLE = {
    "personal": {
        "name": "Sarah Al-Amri",
        "email": "sarah.alamri@email.com",
        "phone": "+966 55 123 4567",
        "location": "Jeddah, Saudi Arabia",
        "linkedin": "sarah-alamri",
        "github": "salamri",
    },
    "education": [{
        "institution": "University of Jeddah",
        "degree": "B.Sc. in Artificial Intelligence",
        "gpa": "3.8 / 4.0", "graduation_year": "2025",
        "distinctions": [], "relevant_coursework": [],
    }],
    "experience": [
        {
            "company": "Nexora AI", "title": "Machine Learning Engineer",
            "dates": "Jan 2023 – Present", "metrics": [],
            "bullets": [
                "Built and deployed an NLP pipeline that reduced manual review time by 35%",
                "Led migration of model serving stack to Kubernetes, cutting latency by 40%",
                "Mentored 3 junior engineers on ML best practices and code review",
            ],
        },
        {
            "company": "Falak Analytics", "title": "Data Scientist",
            "dates": "Jun 2021 – Dec 2022", "metrics": [],
            "bullets": [
                "Designed forecasting models improving inventory accuracy by 22%",
                "Automated ETL pipelines processing 2M+ records daily",
            ],
        },
    ],
    "skills": {
        "languages": ["Python", "TypeScript", "SQL"],
        "frameworks": ["PyTorch", "React", "FastAPI"],
        "tools": ["Docker", "AWS", "Git"],
        "soft_skills": [], "other": [],
    },
    "projects": [
        {
            "name": "Arabic Sign Language Translator",
            "tech_stack": ["Python", "PyTorch", "OpenCV"],
            "description": "Real-time gesture recognition system translating Arabic Sign Language to text and speech.",
            "metrics": [], "url": None,
        },
        {
            "name": "CV Tailoring Platform",
            "tech_stack": ["Next.js", "FastAPI", "OpenAI"],
            "description": "AI-powered platform that tailors resumes to job descriptions and scores ATS compatibility.",
            "metrics": [], "url": None,
        },
    ],
    "certifications": ["AWS Certified Machine Learning – Specialty", "DeepLearning.AI TensorFlow Developer"],
    "languages_spoken": [], "volunteer_work": [], "awards": [],
}


def placeholder_portrait() -> str:
    """
    A generic head-and-shoulders silhouette as a JPEG data URI.

    Deliberately faceless and desaturated: the preview needs to show the
    shape and position of the photo slot, and anything more specific would
    put an invented person in front of every user choosing a template.
    """
    width, height = 480, 600
    image = Image.new("RGB", (width, height), (214, 219, 224))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, width, height), fill=(212, 218, 224))
    draw.ellipse((width * 0.30, height * 0.16, width * 0.70, height * 0.56), fill=(168, 178, 189))
    draw.ellipse((width * 0.14, height * 0.62, width * 0.86, height * 1.28), fill=(168, 178, 189))
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=88)
    import base64
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def build_state(template_id: str) -> dict:
    return {
        "facts_json": SAMPLE,
        "cv_language": "en",
        "template_id": template_id,
        "tagline": "Machine Learning Engineer",
        "tailored_summary": (
            "Results-driven Machine Learning Engineer with 4+ years building production ML "
            "pipelines and NLP systems. Proven track record shipping models that improved key "
            "business metrics by 20%+ across two startups."
        ),
        "tailored_bullets": [], "tailored_projects": [], "tailored_volunteer_work": [],
        "tailored_skills": SAMPLE["skills"], "tailored_experience_titles": [],
        "arabic_glossary": {},
        "profile_name_en": SAMPLE["personal"]["name"], "profile_name_ar": "",
        # Only the photo templates read this; the rest get "" from
        # cv_context.resolve_candidate_photo regardless of what is here.
        "candidate_photo": placeholder_portrait(),
    }


def generate(template_id: str) -> None:
    tmp_pdf = f"outputs/_thumb_{template_id}.pdf"
    render_cv_pdf(build_state(template_id), output_path=tmp_pdf, template_id=template_id)
    try:
        with fitz.open(tmp_pdf) as doc:
            page = doc[0]
            # Scale by matrix rather than a target width — get_pixmap has no
            # `width` argument in the pinned PyMuPDF.
            zoom = THUMB_WIDTH / page.rect.width
            pixmap = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
        image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
        image.crop((0, 0, THUMB_WIDTH, min(THUMB_HEIGHT, image.height))).save(
            OUT_DIR / f"{template_id}.png"
        )
    finally:
        if os.path.exists(tmp_pdf):
            os.remove(tmp_pdf)
    flag = " (photo slot)" if template_supports_photo(template_id) else ""
    print(f"  wrote {template_id}.png{flag}")


if __name__ == "__main__":
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    targets = sys.argv[1:] or list(TEMPLATE_REGISTRY)
    unknown = [t for t in targets if t not in TEMPLATE_REGISTRY]
    if unknown:
        sys.exit(f"Unknown template id(s): {', '.join(unknown)}")
    print(f"Writing {len(targets)} thumbnail(s) to {OUT_DIR}")
    for template_id in targets:
        generate(template_id)
