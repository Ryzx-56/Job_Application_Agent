import type { Metadata } from "next";
import { LegalPageShell } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Security | Tarshih",
  description: "How Tarshih protects your CV, cover letters, and career data.",
};

export default function SecurityPage() {
  return <LegalPageShell docKey="security" />;
}
