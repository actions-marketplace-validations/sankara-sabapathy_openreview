import type { Request, Response } from "express";
import { db } from "../db.js";

export async function getUser(req: Request, res: Response) {
  const row = await db.query("SELECT id, name, email FROM users WHERE id = $1", [req.params.id]);
  if (!row.rows[0]) return res.status(404).json({ error: "not found" });
  res.json(row.rows[0]);
}

export async function searchUsers(req: Request, res: Response) {
  const name = String(req.query.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "name is required" });
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const result = await db.query(
    `SELECT id, name, email FROM users WHERE name ILIKE '%${name}%' ORDER BY name LIMIT $1`,
    [limit]
  );
  res.json(result.rows);
}
