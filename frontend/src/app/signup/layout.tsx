/**
 * NOINDEX. These are flows, not content: a bare form in a search result sits
 * ahead of the page that explains the product, and it is the wrong first
 * thing for someone to land on.
 *
 * A layout rather than the page itself because the page is a Client
 * Component, and Next only reads a `metadata` export from a Server
 * Component. robots.txt disallows these too — that stops the fetch; this
 * stops the URL being indexed, which is a different guarantee. See the note
 * in src/app/dashboard/layout.tsx.
 */
export const metadata = {
  robots: { index: false, follow: false },
};

export default function AuthFlowLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
