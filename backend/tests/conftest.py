import pytest
from dotenv import load_dotenv

load_dotenv()

from agents.cv_parser import parse_cv

MAIN_CV_PATH = "tests/sample_data/Abdulmalik_Hawsawi_CV.pdf"
MINIMAL_CV_PATH = "tests/sample_data/minimal_cv.pdf"


@pytest.fixture(scope="module")
def parsed_cv():
    """Parse the main CV once per test module — single Gemini call shared by all tests."""
    return parse_cv(MAIN_CV_PATH)


@pytest.fixture(scope="module")
def parsed_minimal_cv():
    """Parse the minimal CV once (second API call; opt in via pytest -m minimal_cv)."""
    return parse_cv(MINIMAL_CV_PATH)
