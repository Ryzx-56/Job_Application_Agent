import type { ManualCvData } from "@/components/manual-cv-form";

/* ========================================================================
   THE /build-cv DRAFT — what carries a visitor's CV across the account wall.

   /build-cv lets someone fill in the whole form before creating an account;
   the account wall only appears when they click Generate (see
   components/build-cv/build-cv-page.tsx). Supabase's signUp() does not
   always hand back a live session — with email confirmation on, it doesn't,
   and the visitor only reaches /dashboard after clicking a link in their
   inbox, possibly in a different tab. A server-side "resume token" cannot
   survive that gap for someone who isn't a user yet, so this is stored in
   the browser instead: localStorage survives the redirect to /signup, the
   wait for a confirmation email, and the redirect back to /dashboard, as
   long as it happens in the same browser.

   WHAT IT DOES NOT COVER: a confirmation link opened on a different device
   or browser finds no draft. That is an honest limitation of client-side
   storage, not a hidden failure — dashboard/page.tsx falls back to its
   ordinary empty form, exactly as if the visitor had landed there directly.

   READ FAILURES RETURN null, NEVER THROW OR GUESS. Malformed JSON, a
   missing field, or an expired draft are all "no usable draft" — the same
   outcome as never having saved one (see CLAUDE.md's rule on this). A
   half-parsed draft applied anyway would show the visitor a corrupted guess
   at their own CV, which is worse than an empty form and harder to notice.
======================================================================== */

const STORAGE_KEY = "tarshih_build_cv_draft_v1";

/** A day is generous for "sign up, confirm by email, come back", and short
 *  enough that a shared or library computer doesn't hand the next visitor a
 *  stranger's half-typed CV weeks later. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Above this, an uploaded file is dropped from the draft rather than risk
 *  localStorage's quota (typically 5-10 MB per origin, shared with cookie
 *  consent, analytics and the onboarding tour). Base64 inflates a file by
 *  about a third, so this covers the MAX_CV_UPLOAD_BYTES = 5 MB case the
 *  upload form already enforces, with headroom. Losing the file over this
 *  is reported honestly (see BuildCvDraft.uploadOmitted) rather than
 *  silently producing a draft with a hole in it. */
const MAX_DRAFT_FILE_CHARS = 4_000_000;

export type BuildCvDraft = {
  savedAt: number;
  cvMode: "upload" | "manual";
  manualData: ManualCvData;
  additionalInfo: string;
  jobDescription: string;
  cvLanguage: "en" | "ar";
  candidatePhoto: string | null;
  /** Present only in "upload" mode, and only when the encoded file fit
   *  under MAX_DRAFT_FILE_CHARS. A File object cannot survive localStorage
   *  or a page navigation, so this carries its bytes as a data: URL. */
  uploadedFile: { name: string; type: string; dataUrl: string } | null;
  /** True when the visitor was in "upload" mode but the file was too large
   *  to carry over — dashboard shows an honest "please re-attach your CV"
   *  notice instead of silently restoring nothing and saying nothing. */
  uploadOmitted: boolean;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Best-effort. A write that fails (private browsing, quota exceeded) is
 *  logged and skipped rather than thrown — Generate still proceeds to the
 *  account wall, it just has nothing to restore afterward, which is the
 *  same honest fallback as an expired or never-saved draft. */
export function saveBuildCvDraft(draft: Omit<BuildCvDraft, "savedAt">): void {
  try {
    const payload: BuildCvDraft = { ...draft, savedAt: Date.now() };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.error("saveBuildCvDraft failed — continuing without a saved draft:", err);
  }
}

/** Returns the draft, or null if there isn't a usable one. Expired,
 *  malformed and never-saved are all the same "nothing to restore" case to
 *  every caller — see the header note above. */
export function readBuildCvDraft(): BuildCvDraft | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) return null;
    if (typeof parsed.savedAt !== "number" || Date.now() - parsed.savedAt > MAX_AGE_MS) return null;
    if (parsed.cvMode !== "upload" && parsed.cvMode !== "manual") return null;
    if (!isPlainObject(parsed.manualData)) return null;
    return parsed as BuildCvDraft;
  } catch (err) {
    console.error("readBuildCvDraft failed — treating as no draft:", err);
    return null;
  }
}

export function clearBuildCvDraft(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do — worst case a stale draft sits there until MAX_AGE_MS
    // makes readBuildCvDraft() ignore it anyway.
  }
}

/** Reads a File as a data: URL, for embedding an uploaded CV in the draft. */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(file);
  });
}

/** The inverse of fileToDataUrl: turns a restored draft's upload back into a
 *  real File the rest of the upload flow already knows how to use. Returns
 *  null on any decode failure rather than throwing — the caller treats that
 *  exactly like uploadOmitted, since the effect on the visitor is the same:
 *  ask them to re-attach the file. */
export function dataUrlToFile(dataUrl: string, name: string, type: string): File | null {
  try {
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    if (!base64) return null;
    const bytes = atob(base64);
    const buffer = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) buffer[i] = bytes.charCodeAt(i);
    return new File([buffer], name, { type });
  } catch (err) {
    console.error("dataUrlToFile failed:", err);
    return null;
  }
}

/** Builds the upload half of a draft from the selected file. Encodes it,
 *  then drops it (honestly — see uploadOmitted) if it's too big to carry. */
export async function buildUploadedFileField(
  file: File | null
): Promise<Pick<BuildCvDraft, "uploadedFile" | "uploadOmitted">> {
  if (!file) return { uploadedFile: null, uploadOmitted: false };
  try {
    const dataUrl = await fileToDataUrl(file);
    if (dataUrl.length > MAX_DRAFT_FILE_CHARS) {
      return { uploadedFile: null, uploadOmitted: true };
    }
    return { uploadedFile: { name: file.name, type: file.type, dataUrl }, uploadOmitted: false };
  } catch (err) {
    console.error("buildUploadedFileField failed — draft will note the file needs re-attaching:", err);
    return { uploadedFile: null, uploadOmitted: true };
  }
}
