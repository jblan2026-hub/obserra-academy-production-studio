const APPROVED_CONNECTORS = Object.freeze([
  { id: "lcms", name: "Academy LCMS", description: "Courses, production queues, releases, audit activity, and system health.", env: "OBSERRA_LCMS_URL", defaultUrl: "https://www.obserrallc.com", healthPath: "/api/health", intelligencePath: "/api/obserra/intelligence", credentialKey: "lcmsToken", control: true, aiReporting: true },
  { id: "academy", name: "Obserra Academy", description: "Learners, enrollments, course delivery, assessments, and completion records.", env: "OBSERRA_ACADEMY_URL", defaultUrl: "https://www.obserrallc.com", healthPath: "/api/academy/commerce-health", intelligencePath: "/api/obserra/intelligence", credentialKey: "academyToken", control: true, aiReporting: true },
  { id: "website", name: "Obserra Website", description: "Public website, catalog synchronization, deployments, and application health.", env: "OBSERRA_WEBSITE_URL", defaultUrl: "https://www.obserrallc.com", healthPath: "/api/health", intelligencePath: "/api/obserra/intelligence", credentialKey: "websiteToken", control: true, aiReporting: true },
  { id: "store", name: "Obserra Store", description: "Products, orders, licensing, entitlements, and marketplace synchronization.", env: "OBSERRA_STORE_URL", defaultUrl: "https://www.obserrallc.com", healthPath: "/api/academy/commerce-health", intelligencePath: "/api/obserra/intelligence", credentialKey: "storeToken", control: true, aiReporting: true },
  { id: "stripe", name: "Stripe", description: "Commerce, payments, subscriptions, licensing, and webhook health.", env: "STRIPE_API_URL", defaultUrl: "https://api.stripe.com", healthPath: "/v1/balance", intelligencePath: null, credentialKey: "stripeSecretKey", control: true, aiReporting: false },
  { id: "github", name: "GitHub", description: "Repositories, pull requests, Actions workflows, releases, and deployment source control.", env: "GITHUB_API_URL", defaultUrl: "https://api.github.com", healthPath: "/rate_limit", intelligencePath: null, credentialKey: "githubToken", control: true, aiReporting: false },
  { id: "vercel", name: "Vercel", description: "Website and Academy deployment status, build logs, domains, and project health.", env: "VERCEL_API_URL", defaultUrl: "https://api.vercel.com", healthPath: "/v2/user", intelligencePath: null, credentialKey: "vercelToken", control: true, aiReporting: false },
  { id: "clerk", name: "Clerk", description: "Owner identity, organizations, users, sessions, roles, and access health.", env: "CLERK_API_URL", defaultUrl: "https://api.clerk.com", healthPath: "/v1/users?limit=1", intelligencePath: null, credentialKey: "clerkSecretKey", control: true, aiReporting: false },
  { id: "localAi", name: "Local AI", description: "Private inference, model availability, GPU-backed workloads, and offline reasoning.", env: "OBSERRA_LOCAL_AI_URL", defaultUrl: "http://127.0.0.1:11434", healthPath: "/api/tags", intelligencePath: null, credentialKey: null, control: true, localOnly: true, aiReporting: true }
]);

function normalizeBaseUrl(value) {
  const parsed = new URL(value);
  if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("Unsupported connector protocol");
  if (parsed.protocol === "http:" && !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) throw new Error("Unencrypted connector URLs are allowed only on loopback");
  parsed.pathname = parsed.pathname.replace(/\/$/, "");
  return parsed.toString().replace(/\/$/, "");
}

function resolvedConnectors(store) {
  return APPROVED_CONNECTORS.map((connector) => {
    const stored = store.get(`connectors.${connector.id}.url`);
    const url = normalizeBaseUrl(stored || process.env[connector.env] || connector.defaultUrl);
    return { ...connector, url };
  });
}

module.exports = { APPROVED_CONNECTORS, resolvedConnectors, normalizeBaseUrl };
