import type { Metadata } from "next";
import { LegalPageShell } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Refund & Exchange Policy | Tarshih",
  description: "How refunds, cancellations, and plan changes work for Tarshih subscriptions and credit packs.",
};

export default function RefundPolicyPage() {
  return <LegalPageShell docKey="returnPolicy" />;
}
