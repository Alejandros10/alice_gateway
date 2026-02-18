/**
 * RaspberryRelayClient — Infraestructura / Cliente HTTP
 *
 * Responsabilidad: hablar con la Raspberry Pi (IO externo).
 * Traduce llamadas lógicas a peticiones HTTP contra la FastAPI.
 *
 * Endpoints del controlador FastAPI:
 *   POST /api/relay/set          body: { name: string, state: boolean }
 *   POST /api/relay/all/on
 *   POST /api/relay/all/off
 *   GET  /api/relay/{name}/state → { relay: string, state: boolean }
 *
 * Configura RASPBERRY_URL en .env (default: http://192.168.1.2:8000)
 */

import axios, { AxiosError } from "axios";

const BASE_URL = process.env.RASPBERRY_URL ?? "http://192.168.1.2:8000";
const TIMEOUT_MS = 5_000;

class RaspberryRelayClient {
  /**
   * Enciende o apaga un relé individual.
   * @param pin  Nombre GPIO ("gpio5", "gpio13", …)
   * @param state true = ON, false = OFF
   */
  async setState(pin: string, state: boolean): Promise<void> {
    try {
      await axios.post(
        `${BASE_URL}/api/relay/set`,
        { name: pin, state },
        { timeout: TIMEOUT_MS }
      );
    } catch (err) {
      throw this.wrapError(err, `setState(${pin}, ${state})`);
    }
  }

  /**
   * Enciende o apaga todos los relés a la vez.
   * @param state true = todos ON, false = todos OFF
   */
  async setAll(state: boolean): Promise<void> {
    const endpoint = state ? "/api/relay/all/on" : "/api/relay/all/off";
    try {
      await axios.post(`${BASE_URL}${endpoint}`, {}, { timeout: TIMEOUT_MS });
    } catch (err) {
      throw this.wrapError(err, `setAll(${state})`);
    }
  }

  /**
   * Consulta el estado actual de un pin directamente en la Raspberry.
   * Útil para sincronizar estado al arrancar el Gateway.
   * @param pin  Nombre GPIO ("gpio5", …)
   */
  async getState(pin: string): Promise<boolean> {
    try {
      const res = await axios.get<{ relay: string; state: boolean }>(
        `${BASE_URL}/api/relay/${pin}/state`,
        { timeout: TIMEOUT_MS }
      );
      return res.data.state;
    } catch (err) {
      throw this.wrapError(err, `getState(${pin})`);
    }
  }

  private wrapError(err: unknown, context: string): Error {
    if (err instanceof AxiosError) {
      const status = err.response?.status ?? "network error";
      return new Error(
        `[RaspberryClient] ${context} → HTTP ${status}: ${err.message}`
      );
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}

export const raspberryRelayClient = new RaspberryRelayClient();
