import type { Request, Response } from "express";
import { db } from "../db.js";

export async function getUser(req: Request, res: Response) {
  const row = await db.query("SELECT id, name, email FROM users WHERE id = $1", [req.params.id]);
  if (!row.rows[0]) return res.status(404).json({ error: "not found" });
  res.json(row.rows[0]);
}
