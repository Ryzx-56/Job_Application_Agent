import type { Metadata } from "next";
import { LegalPageShell } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy | Tarshih",
  description: "How Tarshih collects, uses, shares, and protects your personal data.",
};

export default function PrivacyPage() {
  return <LegalPageShell docKey="privacy" />;
}
