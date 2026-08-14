import type { Metadata } from "next";
import { LegalPageShell } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Terms & Conditions | Tarshih",
  description: "The terms that govern your access to and use of Tarshih's AI resume and cover letter tailoring service.",
};

export default function TermsPage() {
  return <LegalPageShell docKey="terms" />;
}
