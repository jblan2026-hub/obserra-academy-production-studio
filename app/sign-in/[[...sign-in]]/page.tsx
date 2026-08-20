import { SignIn } from "@clerk/nextjs";
import { isClerkIdentityConfigured } from "@/lib/identity-readiness";

export default function SignInPage() {
  const identityConfigured = isClerkIdentityConfigured();

  return (
    <main className="auth-shell">
      <section className="auth-brand">
        <p className="eyebrow">OBSERRA ACADEMY</p>
        <h1>Production Studio</h1>
        <p>Secure access to course authoring, expert review, media production, quality validation, publishing, licensing, and release governance.</p>
      </section>
      <section className="auth-card">
        {identityConfigured ? (
          <SignIn routing="path" path="/sign-in" forceRedirectUrl="/" />
        ) : (
          <div role="status" aria-live="polite">
            <p className="eyebrow">IDENTITY SERVICE</p>
            <h2>Secure sign in is temporarily unavailable</h2>
            <p>
              The Production Studio is fail closed until the approved Clerk production configuration is restored. Protected authoring, publishing, and administrative surfaces remain inaccessible.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
