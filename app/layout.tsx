import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { isClerkIdentityConfigured } from "@/lib/identity-readiness";
import "./studio.css";
import "./auth.css";

export const metadata: Metadata = {
  title: "Obserra Academy Production Studio",
  description: "Enterprise learning content management, production, governance, and publishing for Obserra Academy.",
};

function Document({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const ciMode = process.env.NEXT_PUBLIC_APP_ENV === "ci";
  const identityConfigured = isClerkIdentityConfigured();

  if (ciMode || !identityConfigured) {
    return <Document>{children}</Document>;
  }

  return (
    <ClerkProvider signInUrl="/sign-in" afterSignOutUrl="/sign-in">
      <Document>{children}</Document>
    </ClerkProvider>
  );
}
