import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Cairo } from "next/font/google";
import "./globals.css";
import { LangProvider } from "@/lib/language";

/**
 * Font loading.
 *
 * NOTE: the variable name below is intentionally "--font-geist-sans" — that's
 * the same CSS variable your globals.css theme already wires up to the
 * `font-sans` Tailwind utility (from the default Next.js starter). Reusing
 * that exact name means the whole site picks up this font automatically
 * with zero changes to globals.css.
 */
const latinFont = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  weight: ["400", "500", "600", "700", "800"],
});

const arabicFont = Cairo({
  subsets: ["arabic", "latin"],
  variable: "--font-cairo-sans",
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Tarshih | ترشيح",
  description: "AI resume and cover letter tailoring for every job application.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${latinFont.variable} ${arabicFont.variable}`} style={{ fontSize: "17px" }}>
      <body>
        <LangProvider>{children}</LangProvider>
      </body>
    </html>
  );
}
