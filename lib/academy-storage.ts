import "server-only";

const allowedBuckets = new Set([
  "academy-videos",
  "academy-materials",
  "academy-certificates",
]);

function normalizedBaseUrl(): string {
  const value = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  if (!value) throw new Error("SUPABASE_URL is required for Academy asset delivery");
  return value;
}

function serviceRoleKey(): string {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!value) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for Academy asset delivery");
  return value;
}

function encodedObjectPath(storageKey: string): string {
  return storageKey
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export async function signAcademyStorageObject(
  bucket: string | null,
  storageKey: string | null,
): Promise<string | null> {
  if (!bucket || !storageKey) return null;
  if (!allowedBuckets.has(bucket)) throw new Error("Academy asset bucket is not permitted");

  const baseUrl = normalizedBaseUrl();
  const apiKey = serviceRoleKey();
  const configuredTtl = Number.parseInt(process.env.ACADEMY_STORAGE_SIGNED_URL_TTL_SECONDS ?? "900", 10);
  const expiresIn = Number.isInteger(configuredTtl)
    ? Math.min(Math.max(configuredTtl, 60), 3600)
    : 900;

  const response = await fetch(
    `${baseUrl}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodedObjectPath(storageKey)}`,
    {
      method: "POST",
      headers: {
        apikey: apiKey,
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ expiresIn }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Unable to sign Academy asset ${bucket}/${storageKey}: ${response.status} ${detail}`);
  }

  const payload = await response.json() as { signedURL?: string; signedUrl?: string };
  const signedPath = payload.signedURL ?? payload.signedUrl;
  if (!signedPath) throw new Error("Supabase Storage did not return a signed URL");
  if (/^https?:\/\//i.test(signedPath)) return signedPath;
  return `${baseUrl}/storage/v1${signedPath.startsWith("/") ? "" : "/"}${signedPath}`;
}
