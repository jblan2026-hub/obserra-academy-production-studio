import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import "./studio.css";

export const metadata: Metadata = {
  title: "Obserra Academy Production Studio",
  description: "Enterprise learning content management, production, governance, and publishing for Obserra Academy.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
