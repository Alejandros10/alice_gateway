/**
 * FrigateService — Integración Frigate NVR → Relés via MQTT (por cámara)
 *
 * Flujo principal (encendido de luces):
 *   Frigate detecta persona → MQTT frigate/events
 *     → verifica regla global (enabled + hora activa)
 *     → busca regla específica de la cámara (cameras[camera].enabled + relayIds)
 *     → RelayService enciende los relés de ESA cámara
 *     → auto-apagado independiente por cámara
 *
 * Flujo adicional (modo "Ya volvemos"):
 *   Si house_mode = "away" y la detección pasa los filtros:
 *     → obtiene lista de emails de notificación desde la BD (caché 60s)
 *     → envía correo con captura de Frigate adjunta via alice_notifier
 *     → respeta cooldown por cámara (5 min) para no saturar el correo
 *
 * Cachés (todas con TTL = 60s):
 *   - Regla Frigate   (rule)
 *   - House mode      (houseMode)
 *   - Emails destino  (notifEmails)
 */

import { mqttBus }                                    from "./MqttBus";
import { relayService }                               from "./RelayService";
import { aliceApi }                                   from "./AliceApiClient";
import { notifierClient }                             from "./NotifierClient";
import { DEFAULT_FRIGATE_RULE, FrigateDetectionRule } from "../config/frigateRules";

const TOPIC_EVENTS       = "frigate/events";
const RULE_CACHE_TTL     = 60_000;
const NOTIFY_COOLDOWN_MS = 5 * 60_000; // 5 min entre notificaciones por cámara

const CAMERA_LABELS: Record<string, string> = {
  camara_fronta:  "Cámara Frontal",
  camara_trasera: "Cámara Trasera",
};

interface FrigateAfter {
  id:             string;
  camera:         string;
  label:          string;
  score:          number;
  top_score:      number;
  stationary:     boolean;
  false_positive: boolean;
  end_time:       number | null;
}

interface FrigateEventPayload {
  type:   "new" | "update" | "end";
  before: Record<string, unknown> | null;
  after:  FrigateAfter;
}

class FrigateService {
  private rule: FrigateDetectionRule = { ...DEFAULT_FRIGATE_RULE };
  private ruleLastFetched            = 0;

  private houseMode: "home" | "away" = "home";
  private notifEmails: string[]      = [];
  private modeLastFetched            = 0;

  private autoOffTimers   = new Map<string, NodeJS.Timeout>(); // cameraId → timer
  private notifyCooldowns = new Map<string, number>();          // cameraId → last notified ms

  init(): void {
    mqttBus.addFrigateHandler((topic: string, payload: Buffer) => {
      if (topic === TOPIC_EVENTS) {
        this._handleEvent(payload).catch((err) =>
          console.error("[Frigate] Unhandled error:", err)
        );
      }
    });
    console.log("[Frigate] Service ready — per-camera rules + away-mode notifications");
  }

  // ── Caché de regla ────────────────────────────────────────────────────────

  private async _refreshRule(): Promise<void> {
    const now = Date.now();
    if (now - this.ruleLastFetched < RULE_CACHE_TTL) return;
    try {
      const rule = await aliceApi().getFrigateRule();
      if (rule) this.rule = rule;
      this.ruleLastFetched = now;
    } catch { /* mantiene regla cacheada */ }
  }

  // ── Caché de modo + emails ────────────────────────────────────────────────

  private async _refreshMode(): Promise<void> {
    const now = Date.now();
    if (now - this.modeLastFetched < RULE_CACHE_TTL) return;
    try {
      const [mode, emails] = await Promise.all([
        aliceApi().getHouseMode(),
        aliceApi().getNotificationEmails(),
      ]);
      this.houseMode       = mode;
      this.notifEmails     = emails;
      this.modeLastFetched = now;
    } catch { /* mantiene valores cacheados */ }
  }

  // ── Hora activa ───────────────────────────────────────────────────────────

  private _isActiveHour(): boolean {
    const hourStr = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Bogota",
      hour:     "numeric",
      hour12:   false,
    }).format(new Date());
    return parseInt(hourStr, 10) >= this.rule.activeAfterHour;
  }

  // ── Notificación de alerta ────────────────────────────────────────────────

  private _canNotify(cameraId: string): boolean {
    const last = this.notifyCooldowns.get(cameraId) ?? 0;
    return Date.now() - last > NOTIFY_COOLDOWN_MS;
  }

  private _sendAlert(cameraId: string): void {
    if (this.notifEmails.length === 0) return;
    if (!this._canNotify(cameraId)) return;

    this.notifyCooldowns.set(cameraId, Date.now());

    const FRIGATE_URL = process.env.FRIGATE_URL ?? "http://localhost:5000";
    const label       = CAMERA_LABELS[cameraId] ?? cameraId;
    const timestamp   = new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" });
    const toList      = this.notifEmails.join(", ");

    notifierClient.send({
      provider:    "smtp",
      to:          toList,
      subject:     `⚠️ Movimiento detectado — ${label}`,
      message:     `Se detectó una persona en ${label}.\nFecha: ${timestamp}\n\nNotificación generada por Alice Home en modo "Ya volvemos".`,
      attachments: [{ filename: `${cameraId}.jpg`, url: `${FRIGATE_URL}/api/${cameraId}/latest.jpg` }],
    }).catch((err: Error) => {
      console.error(`[Frigate] Error al enviar alerta (${cameraId}):`, err.message);
    });

    console.log(`[Frigate] Alerta enviada → "${label}" → [${toList}]`);
  }

  // ── Evento principal ──────────────────────────────────────────────────────

  private async _handleEvent(payloadBuf: Buffer): Promise<void> {
    await this._refreshRule();
    await this._refreshMode();

    if (!this.rule.enabled)    return;
    if (!this._isActiveHour()) return;

    let event: FrigateEventPayload;
    try {
      event = JSON.parse(payloadBuf.toString("utf-8")) as FrigateEventPayload;
    } catch {
      console.error("[Frigate] Invalid JSON payload");
      return;
    }

    if (event.type !== "new")           return;
    if (event.after.label !== "person") return;
    if (event.after.false_positive)     return;

    const camera     = event.after.camera;
    const cameraRule = this.rule.cameras[camera];

    if (!cameraRule) {
      console.log(`[Frigate] Camera "${camera}" not in rules — ignored`);
      return;
    }
    if (!cameraRule.enabled || cameraRule.relayIds.length === 0) return;

    const score   = event.after.top_score.toFixed(2);
    const targets = cameraRule.relayIds.join(", ");
    console.log(`[Frigate] Person on "${camera}" (${score}) → ON [${targets}]`);

    // Encender relés
    for (const relayId of cameraRule.relayIds) {
      relayService.turnOn(relayId).catch((err: Error) => {
        console.error(`[Frigate] Error turning on "${relayId}":`, err.message);
      });
    }

    // Auto-apagado independiente por cámara
    if (this.rule.autoOffSec > 0) {
      const existing = this.autoOffTimers.get(camera);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(() => {
        console.log(`[Frigate] Auto-off "${camera}" after ${this.rule.autoOffSec}s`);
        for (const relayId of cameraRule.relayIds) {
          relayService.turnOff(relayId).catch(() => {});
        }
        this.autoOffTimers.delete(camera);
      }, this.rule.autoOffSec * 1_000);

      this.autoOffTimers.set(camera, timer);
    }

    // Notificación si estamos en modo "Ya volvemos"
    if (this.houseMode === "away") {
      this._sendAlert(camera);
    }
  }
}

export const frigateService = new FrigateService();
