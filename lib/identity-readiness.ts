export type ClerkIdentityEnvironment = Readonly<{
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?: string;
  CLERK_SECRET_KEY?: string;
}>;

export type ClerkIdentityReadiness = Readonly<{
  provider: "clerk";
  configured: boolean;
  publishableKeyPresent: boolean;
  secretKeyPresent: boolean;
  missingRequiredEnvironment: readonly string[];
}>;

function hasConfiguredValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function getClerkIdentityReadiness(
  env: ClerkIdentityEnvironment = process.env,
): ClerkIdentityReadiness {
  const publishableKeyPresent = hasConfiguredValue(
    env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  );
  const secretKeyPresent = hasConfiguredValue(env.CLERK_SECRET_KEY);
  const missingRequiredEnvironment: string[] = [];

  if (!publishableKeyPresent) {
    missingRequiredEnvironment.push("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
  }
  if (!secretKeyPresent) {
    missingRequiredEnvironment.push("CLERK_SECRET_KEY");
  }

  return {
    provider: "clerk",
    configured: publishableKeyPresent && secretKeyPresent,
    publishableKeyPresent,
    secretKeyPresent,
    missingRequiredEnvironment,
  };
}

export function isClerkIdentityConfigured(
  env: ClerkIdentityEnvironment = process.env,
): boolean {
  return getClerkIdentityReadiness(env).configured;
}
