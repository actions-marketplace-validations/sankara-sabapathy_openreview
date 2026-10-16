import type { Request, Response, NextFunction } from "express";

export type User = { id: string; roles: string[] };

export function requireLogin(req: Request, res: Response, next: NextFunction) {
  if (!(req as any).user) return res.status(401).json({ error: "login required" });
  next();
}
