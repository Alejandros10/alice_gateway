/**
 * SchedulerService — Motor de horarios programados
 *
 * Responsabilidad:
 *  - Cargar horarios activos vía AliceApiClient.getSchedules()
 *  - Registrar cron jobs con node-cron (zona: America/Bogota)
 *  - Ejecutar relayService.turnOn/Off() en cada disparo
 *  - Registrar ejecuciones vía AliceApiClient.logRelayEvent() (fire-and-forget)
 *
 * Conversión días → cron:
 *   "mon,wed,fri"  +  "08:30"  →  "30 8 * * 1,3,5"
 */

import cron from "node-cron";
import { aliceApi, type ScheduleDto } from "./AliceApiClient";
import { relayService } from "./RelayService";

const TIMEZONE = "America/Bogota";

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

  /**
   * Recarga horarios desde el API de Next.js y re-registra todos los cron jobs.
   * Llamar al arrancar y cuando llega POST /api/schedules/reload.
   */
  async reload(): Promise<{ loaded: number }> {
    try {
      const schedules = await aliceApi().getSchedules();

      this._cancelAll();

      for (const schedule of schedules) {
        this._register(schedule);
      }

      console.log(`[Scheduler] ${schedules.length} horario(s) activo(s) cargado(s)`);
      return { loaded: schedules.length };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Scheduler] Error al cargar horarios: ${msg}`);
      return { loaded: 0 };
    }
  }

  get count(): number {
    return this.jobs.size;
  }

  // ── Privado ────────────────────────────────────────────────────────────────

  private _register(schedule: ScheduleDto): void {
    const cronExpr = toCron(schedule.days, schedule.time);

    if (!cron.validate(cronExpr)) {
      console.warn(
        `[Scheduler] Expresión cron inválida para "${schedule.id}": ${cronExpr}`
      );
      return;
    }

    const task = cron.schedule(
      cronExpr,
      async () => {
        const tag = schedule.label ?? `${schedule.relayId}:${schedule.action}`;
        console.log(`[Scheduler] ▶ "${tag}" → ${schedule.action.toUpperCase()}`);

        try {
          if (schedule.action === "on") {
            await relayService.turnOn(schedule.relayId);
          } else {
            await relayService.turnOff(schedule.relayId);
          }
          // Registro en BD: fire-and-forget, no interrumpe el flujo
          aliceApi().logRelayEvent(schedule.relayId, schedule.action);
        } catch (err) {
          console.error(`[Scheduler] Error ejecutando "${tag}":`, err);
        }
      },
      { timezone: TIMEZONE }
    );

    this.jobs.set(schedule.id, task);
    console.log(
      `[Scheduler] ✓ "${schedule.label ?? schedule.id}" cron: ${cronExpr}`
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
