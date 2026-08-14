import { SITE_URL } from "@/lib/site";
import { TIERS, SAR_PER_USD } from "@/lib/pricing";

/* ========================================================================
   SoftwareApplication STRUCTURED DATA (brief §6.1)

   The site carried FAQPage and nothing else, so search engines had no
   machine-readable statement of what Tarshih actually IS — only a set of
   questions about it.

   RENDERED IN THE ROOT LAYOUT, so it appears once per page across the whole
   site. This is a server component with no "use client", so it is in the
   initial HTML with no JavaScript involved.

   EVERY FIGURE IS INTERPOLATED FROM lib/pricing.ts. An offer block is a
   price a search engine may quote back to a user in a result, so a stale
   number here is worse than a stale number in body copy. Nothing is typed.

   WHAT IS DELIBERATELY ABSENT: aggregateRating and review. Both are the
   fields that make a rich result look impressive and both require real
   ratings the product does not have. Inventing them is the exact fabrication
   §3.6 rules out, and Google treats self-serving review markup as a
   structured-data violation.
======================================================================== */

export function SoftwareApplicationJsonLd() {
  const payload = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Tarshih",
    alternateName: "ترشيح",
    url: SITE_URL,
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "Resume Builder",
    operatingSystem: "Web",
    inLanguage: ["ar", "en"],
    description:
      "Paste a job posting and get a CV and cover letter rewritten for it, in Arabic or English, with an ATS score, a gap list and matched openings.",
    featureList: [
      "Tailored CV and cover letter per job posting",
      "Arabic and English output, correctly typeset in both",
      "ATS score with a four-factor breakdown",
      "Job match score and gap analysis",
      "Matched job openings linking to the original listing",
      "PDF and DOCX export",
      "LinkedIn profile content",
      "Interview questions with suggested answers",
    ],
    offers: [
      {
        "@type": "Offer",
        name: "Free",
        price: String(TIERS.free.sar),
        priceCurrency: "SAR",
        description: `${TIERS.free.credits} credits a month, no card required.`,
      },
      {
        "@type": "Offer",
        name: "Pro",
        price: String(TIERS.pro.sar),
        priceCurrency: "SAR",
        description: `${TIERS.pro.credits} credits a month.`,
      },
      {
        "@type": "Offer",
        name: "Elite",
        price: String(TIERS.elite.sar),
        priceCurrency: "SAR",
        description: `${TIERS.elite.credits} credits a month.`,
      },
    ],
    // The riyal is pegged, so this is a constant rather than a rate to fetch.
    // Same source as every price on the site — see lib/pricing.ts.
    additionalProperty: {
      "@type": "PropertyValue",
      name: "SAR per USD",
      value: SAR_PER_USD,
    },
  };

  return (
    <script
      type="application/ld+json"
      // Our own constants, not user input.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }}
    />
  );
}
