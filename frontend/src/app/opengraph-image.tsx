import { ImageResponse } from "next/og";

/* ========================================================================
   THE SOCIAL CARD (brief §6.1)

   Every route was declaring `twitter: { card: "summary_large_image" }` and an
   openGraph block with no image behind any of it. A large-image card with no
   image renders as a bare link, which is worse than declaring a summary card,
   so the metadata was writing a cheque the site could not cash.

   GENERATED, NOT DRAWN. next/og renders this JSX to a PNG, so the card is a
   real asset produced from the same brand values as the site rather than a
   binary someone re-exports by hand whenever the wording changes. Next serves
   it at /opengraph-image and wires it into the metadata of every route that
   inherits from the root layout.

   ── WHY THERE IS NO ARABIC ON THIS CARD ─────────────────────────────────
   This was built bilingual first, loading Noto Naskh Arabic (the family the
   backend already ships for Arabic PDFs). It fails the build outright:

       Error: lookupType: 5 - substFormat: 3 is not yet supported

   That is satori, the renderer behind next/og, refusing a GSUB lookup format
   the font needs — and Arabic depends on exactly those contextual
   substitution tables to join letters at all. It is not a missing-glyph
   problem that a different weight would fix; satori cannot shape this script,
   and a card showing unjoined Arabic would be a worse advertisement for an
   Arabic-first product than a card with no Arabic on it.

   So this renders in Latin, and a proper Arabic card is a real outstanding
   item: it needs a PNG designed once, exported, and served from /public,
   selected per language in generateMetadata. Flagged rather than faked.
======================================================================== */

export const runtime = "nodejs";
export const alt = "Tarshih: every job gets its own CV";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BG = "#09090b";
const INK = "#fafafa";
const INK_SOFT = "#b4b4be";
const ACCENT = "#2563eb";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: BG,
          padding: "72px 80px",
        }}
      >
        {/* The accent tick and wordmark: the standing head every section of
            the site opens with, at poster size. */}
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 6, height: 44, borderRadius: 3, background: ACCENT }} />
          <div style={{ fontSize: 40, fontWeight: 700, color: INK }}>Tarshih</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              fontSize: 72,
              fontWeight: 700,
              color: INK,
              lineHeight: 1.08,
              letterSpacing: "-0.02em",
              maxWidth: 960,
            }}
          >
            Every job gets its own CV
          </div>
          <div style={{ fontSize: 30, color: INK_SOFT, maxWidth: 900, lineHeight: 1.4 }}>
            Rewritten for the posting you paste, in Arabic or English, with the score to prove it.
          </div>
        </div>

        {/* A rule rather than a row of feature pills. */}
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 96, height: 2, background: ACCENT }} />
          <div style={{ fontSize: 24, color: INK_SOFT }}>
            ATS score · gap analysis · job & internship search
          </div>
        </div>
      </div>
    ),
    size
  );
}
