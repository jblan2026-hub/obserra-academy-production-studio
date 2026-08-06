import { OrganizationSwitcher } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function SelectOrganizationPage() {
  const { userId, orgId } = await auth();
  if (!userId) redirect("/sign-in");
  if (orgId) redirect("/");

  return (
    <main className="auth-shell">
      <section className="auth-brand">
        <p className="eyebrow">ORGANIZATION CONTEXT</p>
        <h1>Select your Obserra workspace.</h1>
        <p>Studio actions are organization scoped. Select or create the authorized organization that owns the courses, sources, releases, licenses, and audit records you will manage.</p>
      </section>
      <section className="auth-card organization-card">
        <OrganizationSwitcher
          hidePersonal
          afterCreateOrganizationUrl="/"
          afterSelectOrganizationUrl="/"
          afterLeaveOrganizationUrl="/select-organization"
        />
      </section>
    </main>
  );
}
