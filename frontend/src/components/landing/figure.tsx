"use client";

import { animate, useInView, useReducedMotion } from "framer-motion";
import { useEffect, useRef } from "react";
import { useLang } from "@/lib/language";
import { formatNumber } from "@/lib/pricing";

/**
 * A number that counts up once per cycle.
 *
 * THE REAL VALUE IS IN THE DOM. An earlier version initialised state at 0 and
 * shipped an ATS score of "0" in the server-rendered HTML — visible to anyone
 * on a slow connection and to every crawler. The true number renders first and
 * the count is layered on top.
 *
 * Writes through a ref rather than state: a counter on state re-renders every
 * frame, and this page already has a main-thread problem. `useInView` without
 * `once` means the loop stops paying for itself when the hero scrolls away.
 */
export function Figure({
  value,
  delay,
  className = "",
  style,
}: {
  value: number;
  delay: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { lang } = useLang();
  const reduced = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { amount: 0.5 });

  useEffect(() => {
    const node = ref.current;
    if (reduced || !inView || !node) return;

    const controls = animate(0, value, {
      duration: 1.6,
      delay,
      ease: [0.16, 1, 0.3, 1],
      repeat: Infinity,
      repeatDelay: Math.max(0, 9 - 1.6 - delay),
      onUpdate: (v) => {
        node.textContent = formatNumber(Math.round(v), lang);
      },
    });
    return () => {
      controls.stop();
      // Leave the true number behind when the loop stops.
      node.textContent = formatNumber(value, lang);
    };
  }, [inView, reduced, value, delay, lang]);

  return (
    <span ref={ref} className={`t-figure ${className}`} style={style}>
      {formatNumber(value, lang)}
    </span>
  );
}
