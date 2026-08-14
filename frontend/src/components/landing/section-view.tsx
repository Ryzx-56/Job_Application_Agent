"use client";

import { useSectionView, type Surface } from "@/lib/track";

/* ========================================================================
   SECTION-VIEW WRAPPER

   Fires one section_view event when a section has actually been on screen.

   A WRAPPER RATHER THAN A REF INSIDE EVERY SECTION, because the alternative
   is editing nine components to add an analytics concern none of them are
   about. The wrapper is a plain block div around a full-width <section>,
   which changes nothing about the layout: every section it wraps is already
   a block-level, auto-width element.

   `display: contents` would be tidier still, and is deliberately NOT used —
   an element with no box generates no intersection, so IntersectionObserver
   would never fire on it.
======================================================================== */
export function SectionView({
  name,
  surface = "landing",
  children,
}: {
  name: string;
  surface?: Surface;
  children: React.ReactNode;
}) {
  const ref = useSectionView<HTMLDivElement>(name, surface);
  return <div ref={ref}>{children}</div>;
}
