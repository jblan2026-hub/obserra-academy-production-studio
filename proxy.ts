import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicUiRoute = createRouteMatcher([
  "/sign-in(.*)",
]);

// Backend API routes are deliberately excluded from this proxy matcher.
// Every protected API route performs provider-neutral authorization in the route itself,
// allowing Supabase JWT and machine-token authentication without a Clerk dependency.
export default clerkMiddleware(async (auth, request) => {
  if (!isPublicUiRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!api(?:/|$)|_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/__clerk/(.*)",
  ],
};
