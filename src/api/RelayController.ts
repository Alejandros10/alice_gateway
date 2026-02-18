/**
 * RelayController — Express Routes (Adaptador HTTP)
 *
 * Responsabilidad: exponer endpoints HTTP para la app Next.js.
 * No contiene lógica de negocio — delega todo a RelayService.
 *
 * Endpoints:
 *   GET  /api/relays          → lista completa con estado actual
 *   GET  /api/relays/state    → snapshot { id: boolean }
 *   POST /api/relays/:id/on   → encender relé
 *   POST /api/relays/:id/off  → apagar relé
 *
 * Códigos de respuesta:
 *   200  → acción exitosa
 *   404  → relé no existe en el catálogo
 *   502  → la Raspberry no respondió / error de hardware
 */

import { Router, Request, Response } from "express";
import { relayService } from "../services/RelayService";

const router = Router();

// ── GET /api/relays ──────────────────────────────────────────────────────────
// Lista todos los relés del catálogo con su estado actual
router.get("/", (_req: Request, res: Response) => {
  res.json({ relays: relayService.getAll() });
});

// ── GET /api/relays/state ────────────────────────────────────────────────────
// Snapshot plano { cocina: false, sala: true, … }
// Útil para sincronización rápida de la UI al cargar
router.get("/state", (_req: Request, res: Response) => {
  res.json(relayService.getSnapshot());
});

// ── POST /api/relays/all/on ──────────────────────────────────────────────────
// Debe estar ANTES de /:id/on para evitar que Express interprete "all" como :id
router.post("/all/on", async (_req: Request, res: Response) => {
  try {
    await relayService.setAll(true);
    res.json({ ok: true, state: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ ok: false, error: message });
  }
});

// ── POST /api/relays/all/off ─────────────────────────────────────────────────
router.post("/all/off", async (_req: Request, res: Response) => {
  try {
    await relayService.setAll(false);
    res.json({ ok: true, state: false });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ ok: false, error: message });
  }
});

// ── POST /api/relays/:id/on ──────────────────────────────────────────────────
router.post("/:id/on", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await relayService.turnOn(id);
    res.json({ ok: true, relay: id, state: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 502;
    res.status(status).json({ ok: false, error: message });
  }
});

// ── POST /api/relays/:id/off ─────────────────────────────────────────────────
router.post("/:id/off", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await relayService.turnOff(id);
    res.json({ ok: true, relay: id, state: false });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 502;
    res.status(status).json({ ok: false, error: message });
  }
});

export default router;
