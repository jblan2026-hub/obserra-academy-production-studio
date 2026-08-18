import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getClerkIdentityReadiness } from "@/lib/identity-readiness";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/api/health(.*)",
]);

const configuredClerkProxy = clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

function unavailableHeaders(contentType: string) {
  return {
    "cache-control": "no-store, max-age=0",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    "content-type": contentType,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
}

function identityUnavailableResponse(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      {
        service: "obserra-academy-production-studio",
        status: "degraded",
        ready: false,
        dependency: "identity",
        provider: "clerk",
        error: "identity_provider_not_configured",
      },
      {
        status: 503,
        headers: unavailableHeaders("application/json; charset=utf-8"),
      },
    );
  }

  return new NextResponse(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Obserra Academy Production Studio unavailable</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #07111f; color: #f5f7fa; font-family: Arial, sans-serif; }
    main { width: min(680px, calc(100vw - 48px)); padding: 32px; border: 1px solid #8d6b2f; border-radius: 16px; background: #0b1728; }
    p { line-height: 1.6; color: #cbd5e1; }
    strong { color: #f5d58a; }
  </style>
</head>
<body>
  <main>
    <strong>OBSERRA ACADEMY</strong>
    <h1>Production Studio identity service unavailable</h1>
    <p>The Studio is intentionally fail closed because its configured identity provider is not available. No protected authoring, publishing, learner, or administrative data has been exposed.</p>
    <p>Service operators must restore the approved Clerk production configuration before the Studio can accept authenticated requests.</p>
  </main>
</body>
</html>`,
    {
      status: 503,
      headers: unavailableHeaders("text/html; charset=utf-8"),
    },
  );
}

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  const identity = getClerkIdentityReadiness();

  if (!identity.configured) {
    if (isPublicRoute(request)) {
      return NextResponse.next();
    }

    return identityUnavailableResponse(request);
  }

  return configuredClerkProxy(request, event);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
