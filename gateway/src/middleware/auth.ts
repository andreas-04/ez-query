import { Request, Response, NextFunction } from "express";

const TENANT_ID = process.env.TENANT_ID ?? "00000000-0000-0000-0000-000000000001";

export function authMiddleware(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.locals.tenantId = TENANT_ID;
  next();
}
