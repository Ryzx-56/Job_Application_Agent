# schemas/linkedin_schema.py
#
# The LinkedIn add-on's contract, in three parts:
#   1. CONTENT_LIMITS: LinkedIn's real per-field character maximums.
#   2. The LinkedInContent tree, exactly what agents/linkedin_generator.py
#      returns and what gets stored in linkedin_generations.generated_content
#      and rendered by frontend/src/components/linkedin-results.tsx.
#   3. The two request bodies the /linkedin endpoints accept.
#
# Every text field in the content tree is ENGLISH, always, whatever language
# the source CV was in, see the language rule in linkedin_generator.py. The
# results page's own labels still follow the site's language toggle; only the
# copy-paste output is fixed to English.
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

# ─── LINKEDIN'S REAL FIELD LIMITS ───────────────────────────────────────────
#
# Enforced twice on purpose: named in the prompt so the model aims inside
# them, and clamped server-side after generation (see _clamp in
# linkedin_generator.py) so an over-long field can never reach the user.
# Prompt-only enforcement is a request; the clamp is the guarantee.
#
# "Best range" for the About box is narrower than its hard limit, LinkedIn
# truncates at roughly 300 characters behind a "See more" link, so the
# opening line carries most of the weight.
CONTENT_LIMITS = {
    "headline": 220,
    "about": 2600,
    "experience_description": 2000,
    "position_title": 100,
    "skill": 80,
}

ABOUT_BEST_RANGE = (1800, 2200)
ABOUT_VISIBLE_BEFORE_SEE_MORE = 300

# How many of each the generator produces. Skills and post ideas are fixed
# counts from the spec; experience entries follow the CV.
ABOUT_SKILLS_COUNT = 5
POST_IDEAS_COUNT = 3

# Placeholder for a field the CV genuinely has no data for. The generator is
# instructed to emit this rather than inventing a company, date or title.
NOT_AVAILABLE = "N/A"


# ─── CONTENT TREE ───────────────────────────────────────────────────────────
#
# Every field defaults to empty. A model that omits one section must not
# invalidate the whole payload, the results page renders what's present and
# skips what isn't, which is also how "no Featured section when there's
# nothing to feature" is represented (§3).


class LinkedInIntro(BaseModel):
    """The LinkedIn "Edit intro" modal, field for field. Pulled from
    facts_json rather than written, the one section that must not be
    creative."""
    first_name: str = ""
    last_name: str = ""
    headline: str = ""
    current_position: str = ""
    industry: str = ""
    education: str = ""
    location: str = ""


class LinkedInAbout(BaseModel):
    text: str = ""
    # 5 skills. Taken from the CV's own skills list where it has one, and
    # otherwise inferred from experience/projects under the same
    # evidence-traceable rule the tailoring pipeline uses.
    skills: List[str] = Field(default_factory=list)


class LinkedInFeaturedItem(BaseModel):
    """A link the user already has (GitHub, portfolio, …) that belongs in the
    Featured section. Never invented, if facts_json has no links at all the
    whole Featured section is omitted rather than shown empty."""
    label: str = ""
    url: str = ""
    instruction: str = ""


class LinkedInExperienceEntry(BaseModel):
    """One role, laid out like LinkedIn's "Add experience" modal so the user
    can fill it in top to bottom without re-deriving anything.

    `description` is the single copy-paste block for the role's description
    box; `highlights` is the same content split into the bullets it's built
    from, so the UI can offer either. `NOT_AVAILABLE` fills any field the CV
    doesn't answer."""
    job_title: str = ""
    organization: str = ""
    location: str = ""
    location_type: str = ""      # On-site / Hybrid / Remote / N/A
    employment_type: str = ""    # Full-time / Internship / Freelance / N/A
    start_date: str = ""
    end_date: str = ""
    is_current: bool = False
    description: str = ""
    highlights: List[str] = Field(default_factory=list)
    skills: List[str] = Field(default_factory=list)


class LinkedInPostIdea(BaseModel):
    """A post the person could actually write, tied to a specific thing they
    really did. `draft_hook` is the opening line, which is the part people
    stall on."""
    title: str = ""
    angle: str = ""
    draft_hook: str = ""


class LinkedInEducationEntry(BaseModel):
    school: str = ""
    degree: str = ""
    dates: str = ""


class LinkedInCertificationSuggestion(BaseModel):
    name: str = ""
    issuer: str = ""
    why: str = ""


class LinkedInEducationSection(BaseModel):
    """LinkedIn requires Education and Licenses & Certifications to be typed
    in directly (they're structured, searchable entities, not free text), so
    this section is instructions plus the data to type, not something to
    paste wholesale."""
    instruction: str = ""
    education_entries: List[LinkedInEducationEntry] = Field(default_factory=list)
    certifications_note: str = ""
    # Populated only when the CV lists no certifications at all.
    recommended_certifications: List[LinkedInCertificationSuggestion] = Field(default_factory=list)


class LinkedInProjectEntry(BaseModel):
    name: str = ""
    description: str = ""


class LinkedInProjectIdea(BaseModel):
    name: str = ""
    why: str = ""
    description: str = ""


class LinkedInProjectsSection(BaseModel):
    """Real projects get a written description each. If the CV has none AND
    the person's field normally expects them (engineering, dev, data,
    design), `recommended` carries 2-3 realistic suggestions instead, and
    those are clearly labeled as suggestions in the UI so they can never
    read as something the person has already built."""
    instruction: str = ""
    entries: List[LinkedInProjectEntry] = Field(default_factory=list)
    recommended: List[LinkedInProjectIdea] = Field(default_factory=list)


class LinkedInGrowthPlaybook(BaseModel):
    """The "500+ connections / post consistently" guidance that's teased
    (heading only) before purchase and unlocked at the end of the results
    page. Generated rather than shipped as static frontend copy for two
    reasons: static copy in the JS bundle isn't actually locked, and the
    advice is more useful when it names the person's own field."""
    title: str = ""
    steps: List[str] = Field(default_factory=list)


class LinkedInContent(BaseModel):
    intro: LinkedInIntro = Field(default_factory=LinkedInIntro)
    about: LinkedInAbout = Field(default_factory=LinkedInAbout)
    # None (not an empty object) when facts_json has no links to feature,
    # the UI skips the section entirely on None.
    featured: Optional[List[LinkedInFeaturedItem]] = None
    experience: List[LinkedInExperienceEntry] = Field(default_factory=list)
    post_ideas: List[LinkedInPostIdea] = Field(default_factory=list)
    education_and_certifications: LinkedInEducationSection = Field(default_factory=LinkedInEducationSection)
    projects: LinkedInProjectsSection = Field(default_factory=LinkedInProjectsSection)
    growth_playbook: LinkedInGrowthPlaybook = Field(default_factory=LinkedInGrowthPlaybook)

    # Provenance, for support and for the results page's own header. Always
    # "en" for the content itself; source_cv_language records what the CV was
    # written in, which is the interesting half (an Arabic CV means the agent
    # translated the facts).
    content_language: Literal["en"] = "en"
    source_cv_language: str = "en"


# ─── REQUEST BODIES ─────────────────────────────────────────────────────────


class LinkedInCheckoutRequest(BaseModel):
    tier: Literal["normal", "premium"]
    # Which of the caller's existing resumes to base the generation on.
    # Ownership is verified server-side before a purchase row is created.
    source_cv_id: str
    # Premium only: we phone/WhatsApp the buyer, so the number and the
    # consent that authorizes contacting them are both required. Validated in
    # the endpoint rather than here so the error carries a machine-readable
    # code the frontend can localize.
    contact_phone: Optional[str] = None
    contact_consent: bool = False


class LinkedInGenerateRequest(BaseModel):
    purchase_id: str
    # Normally omitted, the CV is already recorded on the purchase. Only
    # needed when the original CV was deleted after purchase (the purchase's
    # source_cv_id goes null), in which case the buyer picks a replacement
    # rather than losing what they paid for.
    source_cv_id: Optional[str] = None
