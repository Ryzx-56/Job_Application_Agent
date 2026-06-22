from pydantic import BaseModel, Field
from typing import List, Optional

class PersonalInfo(BaseModel):
    name: str                          
    email: Optional[str] = None
    phone: Optional[str] = None
    linkedin: Optional[str] = None
    github: Optional[str] = None
    location: Optional[str] = None
    portfolio: Optional[str] = None    # designers, freelancers often have this

class Education(BaseModel):
    institution: str
    degree: str
    gpa: Optional[str] = None
    graduation_year: Optional[str] = None
    distinctions: List[str] = []
    relevant_coursework: List[str] = []  # useful for students with no experience

class Experience(BaseModel):
    company: str
    title: str
    dates: Optional[str] = None
    bullets: List[str] = []
    metrics: List[str] = []

class Skills(BaseModel):
    languages: List[str] = []          # not everyone has programming languages
    frameworks: List[str] = []
    tools: List[str] = []
    soft_skills: List[str] = []        # relevant for non-technical roles
    other: List[str] = []              # catch-all for anything that doesn't fit

class Project(BaseModel):
    name: str
    tech_stack: List[str] = []         # empty for non-technical projects
    description: Optional[str] = None
    metrics: List[str] = []
    url: Optional[str] = None          # portfolio links, GitHub, live demos

class FactsJSON(BaseModel):
    personal: PersonalInfo             
    education: List[Education] = []    # optional — some senior CVs drop this
    experience: List[Experience] = []  # optional — students, career changers
    skills: Skills = Field(default_factory=Skills)
    projects: List[Project] = []       # optional — non-technical users
    certifications: List[str] = []
    languages_spoken: List[str] = []   # human languages, not programming
    volunteer_work: List[str] = []     # common on non-technical CVs
    awards: List[str] = []

