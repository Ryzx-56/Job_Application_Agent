# schemas/manual_cv_request.py
from pydantic import BaseModel
from typing import List, Optional


class PersonalInfo(BaseModel):
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    linkedin: Optional[str] = None
    github: Optional[str] = None
    location: Optional[str] = None
    portfolio: Optional[str] = None


class EducationEntry(BaseModel):
    institution: str = ""
    degree: str = ""
    gpa: Optional[str] = None
    graduation_year: Optional[str] = None
    distinctions: List[str] = []
    relevant_coursework: List[str] = []


class ExperienceEntry(BaseModel):
    company: str = ""
    title: str = ""
    dates: Optional[str] = None
    bullets: List[str] = []


class ProjectEntry(BaseModel):
    name: str = ""
    tech_stack: List[str] = []
    description: Optional[str] = None
    metrics: List[str] = []
    url: Optional[str] = None


class SkillsInput(BaseModel):
    languages: List[str] = []
    frameworks: List[str] = []
    tools: List[str] = []
    soft_skills: List[str] = []
    other: List[str] = []


class ManualCVRequest(BaseModel):
    personal: PersonalInfo
    education: List[EducationEntry] = []
    experience: List[ExperienceEntry] = []
    projects: List[ProjectEntry] = []
    skills: SkillsInput = SkillsInput()
    certifications: List[str] = []
    languages_spoken: List[str] = []
    awards: List[str] = []
    additional_info: Optional[str] = ""
    job_description: str
    cv_language: Optional[str] = "en"  # "en" or "ar" — output language for the generated CV/cover letter
    template_id: Optional[str] = None  # which of the 11 CV templates to render with — see utils/template_registry.py