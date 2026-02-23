/**
 * NotifierClient — Cliente HTTP para alice_notifier.
 *
 * El gateway usa este cliente para despachar notificaciones
 * sin conocer los detalles de SMTP, WhatsApp, etc.
 */

import axios, { AxiosInstance } from "axios";

export interface NotifyRequest {
  provider:     string;
  to:           string;
  message:      string;
  subject?:     string;
  attachments?: { filename: string; url: string }[];
}

class NotifierClient {
  private http: AxiosInstance | null = null;

  init(baseUrl: string): void {
    this.http = axios.create({ baseURL: baseUrl, timeout: 15_000 });
    console.log(`[Notifier] Client apuntando a ${baseUrl}`);
  }

  async send(payload: NotifyRequest): Promise<void> {
    if (!this.http) {
      console.warn("[Notifier] Client no inicializado — notificación omitida");
      return;
    }
    await this.http.post("/notify", payload);
  }
}

export const notifierClient = new NotifierClient();
