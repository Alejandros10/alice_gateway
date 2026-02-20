/**
 * SchedulerService — Gestión de horarios programados
 *
 * Responsabilidad:
 *  - Cargar horarios desde el frontend (Next.js API) al arrancar y al recargar
 *  - Registrar cron jobs usando node-cron (zona horaria: America/Bogota)
 *  - Ejecutar relayService.turnOn/Off() cuando dispara cada cron
 *  - Registrar cada ejecución en la BD via endpoint interno del frontend
 *
 * Formato days: "mon,tue,wed,thu,fri" (comma-separated)
 * Formato time: "HH:MM" 24h
 * Conversión → cron: "30 8 * * 1,3,5" (min hora * * días)
 */

import cron from "node-cron";
import axios from "axios";
import { relayService } from "./RelayService";

const TIMEZONE = "America/Bogota";

export interface ScheduleEntry {
  id: string;
  relayId: string;
  action: "on" | "off";
  days: string;   // "mon,tue,wed"
  time: string;   // "HH:MM"
  label: string | null;
}

const DAY_TO_NUM: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

function toCron(days: string, time: string): string {
  const [h, m] = time.split(":").map(Number);
  const dayNums = days
    .split(",")
    .map((d) => DAY_TO_NUM[d.trim()])
    .filter((n) => n !== undefined)
    .join(",");
  return `${m} ${h} * * ${dayNums}`;
}

class SchedulerService {
  private jobs = new Map<string, cron.ScheduledTask>();
  private frontendUrl = "http://localhost:3000";

  init(frontendUrl: string) {
    this.frontendUrl = frontendUrl;
  }

  /**
   * Carga todos los horarios activos desde el frontend y registra los cron jobs.
   * Llamar al arrancar el servidor y cuando llega un /api/schedules/reload.
   */
  async reload(): Promise<{ loaded: number }> {
    try {
      const { data } = await axios.get<{ schedules: ScheduleEntry[] }>(
        `${this.frontendUrl}/api/internal/schedules`,
        { timeout: 5_000 }
      );

      this._cancelAll();

      for (const schedule of data.schedules) {
        this._register(schedule);
      }

      console.log(
        `[Scheduler] ${data.schedules.length} horario(s) cargado(s) desde ${this.frontendUrl}`
      );
      return { loaded: data.schedules.length };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Scheduler] Error al cargar horarios: ${msg}`);
      return { loaded: 0 };
    }
  }

  /** Número de cron jobs activos actualmente. */
  get count(): number {
    return this.jobs.size;
  }

  // ── Privado ───────────────────────────────────────────────────────────────

  private _register(schedule: ScheduleEntry): void {
    const cronExpr = toCron(schedule.days, schedule.time);

    if (!cron.validate(cronExpr)) {
      console.warn(
        `[Scheduler] Expresión cron inválida para horario "${schedule.id}": ${cronExpr}`
      );
      return;
    }

    const task = cron.schedule(
      cronExpr,
      async () => {
        const label = schedule.label ?? schedule.id;
        console.log(
          `[Scheduler] ▶ Ejecutando "${label}" → ${schedule.relayId} ${schedule.action.toUpperCase()}`
        );

        try {
          if (schedule.action === "on") {
            await relayService.turnOn(schedule.relayId);
          } else {
            await relayService.turnOff(schedule.relayId);
          }

          // Log asincrónico a BD (fire-and-forget, no crítico)
          axios
            .post(
              `${this.frontendUrl}/api/internal/relay-events`,
              { relayId: schedule.relayId, action: schedule.action, source: "schedule" },
              { timeout: 3_000 }
            )
            .catch(() => {/* ignorar errores de log */});
        } catch (err) {
          console.error(`[Scheduler] Error ejecutando horario "${label}":`, err);
        }
      },
      { timezone: TIMEZONE }
    );

    this.jobs.set(schedule.id, task);
    console.log(
      `[Scheduler] ✓ "${schedule.label ?? schedule.id}" → cron: ${cronExpr} (${schedule.relayId} ${schedule.action})`
    );
  }

  private _cancelAll(): void {
    for (const task of this.jobs.values()) {
      task.stop();
    }
    this.jobs.clear();
  }
}

export const schedulerService = new SchedulerService();
