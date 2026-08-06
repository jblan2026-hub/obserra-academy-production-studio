import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="auth-shell">
      <section className="auth-brand">
        <p className="eyebrow">OBSERRA ACADEMY</p>
        <h1>Production Studio</h1>
        <p>Secure access to course authoring, expert review, media production, quality validation, publishing, licensing, and release governance.</p>
      </section>
      <section className="auth-card">
        <SignIn routing="path" path="/sign-in" forceRedirectUrl="/" />
      </section>
    </main>
  );
}
