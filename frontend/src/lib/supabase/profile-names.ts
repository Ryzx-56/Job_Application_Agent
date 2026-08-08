import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

/**
 * The candidate's name in each script. Either side may be null — a user is
 * only required to supply ONE at signup.
 *
 * These are stored separately (rather than one `full_name`) because a
 * personal name is not a translation problem: the same name has several
 * valid Arabic spellings and only its owner knows which is theirs. Arabic
 * CVs print nameAr verbatim, English CVs print nameEn verbatim, and neither
 * is ever machine-transliterated — see backend/core/profile_names.py.
 */
export type ProfileNames = {
  nameEn: string | null;
  nameAr: string | null;
};

export type NameField = "name_en" | "name_ar";

async function authHeader(): Promise<Record<string, string>> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");
  return {
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": "application/json",
  };
}

export async function fetchProfileNames(): Promise<ProfileNames> {
  const res = await fetch(`${API_URL}/api/v1/profile/names`, {
    headers: await authHeader(),
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  const data = await res.json();
  return { nameEn: data.name_en ?? null, nameAr: data.name_ar ?? null };
}

/**
 * PARTIAL update. A key you omit is left untouched server-side — important
 * because the generation-time prompt only ever asks for one of the two, and
 * sending the other as null would wipe it.
 *
 * RLS grants SELECT only on `profiles`, so the write goes through the
 * backend's service_role client — same trust model as updateLocation. The
 * backend rejects an update that would leave the profile with no name at
 * all (`no_name_provided`).
 */
export async function updateProfileNames(names: {
  nameEn?: string | null;
  nameAr?: string | null;
}): Promise<ProfileNames> {
  const body: Record<string, string> = {};
  if (names.nameEn !== undefined && names.nameEn !== null) body.name_en = names.nameEn;
  if (names.nameAr !== undefined && names.nameAr !== null) body.name_ar = names.nameAr;

  const res = await fetch(`${API_URL}/api/v1/profile/names`, {
    method: "PATCH",
    headers: await authHeader(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail?.message ?? body?.detail ?? `Request failed: ${res.status}`);
  }
  const data = await res.json();
  return { nameEn: data.name_en ?? null, nameAr: data.name_ar ?? null };
}

/**
 * Reads a name straight off the uploaded CV so the prompt can open
 * pre-filled instead of blank. A CV already written in Arabic contains the
 * candidate's OWN Arabic spelling, which is authoritative in a way a
 * transliteration never is.
 *
 * Costs nothing (no credits, no LLM) and never throws — a failed suggestion
 * just means the user types their name themselves, which must always work.
 */
export async function suggestNameFromCv(file: File): Promise<ProfileNames> {
  try {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return { nameEn: null, nameAr: null };

    const form = new FormData();
    form.append("cv", file);

    const res = await fetch(`${API_URL}/api/v1/profile/suggest-name`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: form,
    });
    if (!res.ok) return { nameEn: null, nameAr: null };
    const data = await res.json();
    return { nameEn: data.name_en ?? null, nameAr: data.name_ar ?? null };
  } catch {
    return { nameEn: null, nameAr: null };
  }
}
