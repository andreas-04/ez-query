import { Request, Response, NextFunction } from "express";
import { createClerkClient } from "@clerk/backend";

const DEV_TENANT_ID = process.env.DEV_TENANT_ID ?? "00000000-0000-0000-0000-000000000001";

let clerkClient: ReturnType<typeof createClerkClient> | null = null;
function getClerk() {
  if (!clerkClient) {
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) throw new Error("CLERK_SECRET_KEY is not set");
    clerkClient = createClerkClient({ secretKey });
  }
  return clerkClient;
}

/**
 * Express middleware that authenticates the request and sets res.locals.tenantId.
 * When SKIP_AUTH=true, skips Clerk verification and injects the dev tenant.
 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (process.env.SKIP_AUTH === "true") {
    res.locals.tenantId = DEV_TENANT_ID;
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const clerk = getClerk();
    const payload = await clerk.verifyToken(token);
    const orgId = (payload as Record<string, unknown>).org_id as string | undefined;
    if (!orgId) {
      res.status(401).json({ error: "Token missing org_id claim" });
      return;
    }

    // Look up tenant by clerk_org_id via the DB; for now we derive it from
    // the org_id. A production implementation would query the tenants table.
    // We store it as res.locals and let the gateway pass it to gRPC metadata.
    res.locals.tenantId = orgId;
    return next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}
