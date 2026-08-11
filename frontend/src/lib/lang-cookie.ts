/* ========================================================================
   THE LANGUAGE COOKIE — shared by the server and the client.

   This lives in its own module, with no "use client" directive, ON PURPOSE.
   It used to be exported from lib/language.tsx, which is a client module, and
   that silently broke the server: every export of a "use client" module
   becomes a client *reference* when a server component imports it, so
   `cookies().get(LANG_COOKIE)` was looking up a proxy object rather than the
   string "tarshih_lang" and never found anything. The page rendered English
   for an Arabic reader with no error anywhere.

   Anything both sides need has to sit in a neutral module like this one.
======================================================================== */

export const LANG_COOKIE = "tarshih_lang";

/** Language codes the app renders. Kept here rather than in language.tsx so
 *  server components can use the type without importing a client module. */
export type Lang = "en" | "ar";

/** Narrows an untrusted cookie value to a language, defaulting to English. */
export function readLang(value: string | undefined): Lang {
  return value === "ar" ? "ar" : "en";
}
