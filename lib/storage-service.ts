import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { backendConfig } from "@/lib/backend-config";

export type StoredObject = {
  provider: "local" | "supabase";
  key: string;
  bytes: number;
  sha256: string;
  contentType: string;
};

function safeKey(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..") || !/^[A-Za-z0-9._/-]+$/.test(normalized)) {
    throw new Error("Invalid storage key");
  }
  return normalized;
}

function digest(data: Uint8Array): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function serviceKey(): string {
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for server-side Supabase Storage operations");
  return key;
}

function storageEndpoint(key: string): string {
  if (!backendConfig.supabaseUrl) throw new Error("SUPABASE_URL or SUPABASE_PROJECT_REF is required for Supabase Storage");
  return `${backendConfig.supabaseUrl}/storage/v1/object/${encodeURIComponent(backendConfig.supabaseStorageBucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

async function localPath(key: string): Promise<string> {
  const root = path.resolve(process.cwd(), backendConfig.localStorageRoot);
  const target = path.resolve(root, safeKey(key));
  if (!target.startsWith(`${root}${path.sep}`) && target !== root) throw new Error("Storage path escaped configured root");
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  return target;
}

export async function putPrivateObject(key: string, data: Uint8Array, contentType = "application/octet-stream"): Promise<StoredObject> {
  const normalizedKey = safeKey(key);
  const sha256 = digest(data);

  if (backendConfig.storageProvider === "local") {
    const target = await localPath(normalizedKey);
    await fs.writeFile(target, data, { mode: 0o600 });
    return { provider: "local", key: normalizedKey, bytes: data.byteLength, sha256, contentType };
  }

  const keyValue = serviceKey();
  const response = await fetch(storageEndpoint(normalizedKey), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${keyValue}`,
      apikey: keyValue,
      "Content-Type": contentType,
      "x-upsert": "true",
      "cache-control": "no-store",
    },
    body: Buffer.from(data),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase Storage upload failed with ${response.status}: ${body.slice(0, 500)}`);
  return { provider: "supabase", key: normalizedKey, bytes: data.byteLength, sha256, contentType };
}

export async function getPrivateObject(key: string): Promise<Uint8Array> {
  const normalizedKey = safeKey(key);
  if (backendConfig.storageProvider === "local") {
    return new Uint8Array(await fs.readFile(await localPath(normalizedKey)));
  }

  const keyValue = serviceKey();
  const response = await fetch(storageEndpoint(normalizedKey), {
    headers: { Authorization: `Bearer ${keyValue}`, apikey: keyValue, "cache-control": "no-store" },
  });
  if (!response.ok) throw new Error(`Supabase Storage download failed with ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function deletePrivateObject(key: string): Promise<void> {
  const normalizedKey = safeKey(key);
  if (backendConfig.storageProvider === "local") {
    await fs.rm(await localPath(normalizedKey), { force: true });
    return;
  }

  const keyValue = serviceKey();
  const response = await fetch(storageEndpoint(normalizedKey), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${keyValue}`, apikey: keyValue },
  });
  if (!response.ok && response.status !== 404) throw new Error(`Supabase Storage delete failed with ${response.status}`);
}

export async function storageHealth(): Promise<{ provider: string; configured: boolean; detail: string }> {
  if (backendConfig.storageProvider === "local") {
    const root = path.resolve(process.cwd(), backendConfig.localStorageRoot);
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    return { provider: "local", configured: true, detail: root };
  }
  return {
    provider: "supabase",
    configured: Boolean(backendConfig.supabaseUrl && process.env.SUPABASE_SERVICE_ROLE_KEY),
    detail: backendConfig.supabaseStorageBucket,
  };
}
