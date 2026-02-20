/**
 * ScheduleController — Endpoint de recarga de horarios
 *
 * POST /api/schedules/reload
 * El frontend llama este endpoint tras cualquier operación CRUD de horarios.
 * El gateway vuelve a leer los horarios activos desde el frontend y
 * re-registra todos los cron jobs.
 */

import { Router, Request, Response } from "express";
import { schedulerService } from "../services/SchedulerService";

const router = Router();

router.post("/reload", async (_req: Request, res: Response) => {
  const { loaded } = await schedulerService.reload();
  res.json({ ok: true, jobs: loaded });
});

// GET /api/schedules/status — para health checks / debug
router.get("/status", (_req: Request, res: Response) => {
  res.json({ ok: true, activeJobs: schedulerService.count });
});

export default router;
