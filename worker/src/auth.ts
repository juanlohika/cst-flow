/**
 * Shared-secret auth. CST OS sends X-Worker-Secret with every request;
 * we compare against the WORKER_SECRET env var set on Cloud Run.
 */
import type { Request, Response, NextFunction } from "express";

export function requireSharedSecret(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.WORKER_SECRET;
  if (!expected) {
    // Fail closed — if no secret is set, deny everything.
    res.status(500).json({ error: "Worker not configured (WORKER_SECRET missing)" });
    return;
  }
  const got = req.header("x-worker-secret") || req.header("X-Worker-Secret");
  if (got !== expected) {
    res.status(401).json({ error: "Invalid worker secret" });
    return;
  }
  next();
}
