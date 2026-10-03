// WebSocket link to the game server. Messages are queued and applied by the game loop at the
// start of each simulation tick; pings are answered right away so the measured latency is real.
import type { SkinInfo } from '../../sim/player';
import { PROTOCOL_VERSION, roomPath, type ClientMessage, type RoomMode, type ServerMessage } from '../../net/protocol';
import { t } from '../../i18n';

export type WelcomeMessage = Extract<ServerMessage, { t: 'welcome' }>;

/** The room of this mode on the server the page comes from. */
export function defaultServerUrl(mode: RoomMode = 'dm'): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${roomPath(mode)}`;
}

export class Connection {
  private readonly ws: WebSocket;
  private readonly queue: ServerMessage[] = [];
  private closed = false;
  /** Called once when the link drops (not when we close it ourselves). */
  onClose?: (reason: string) => void;
  /** Bytes received, for the debug overlay. */
  bytesIn = 0;
  /** Round trip to the server in ms, as the server last measured it (0 until known). */
  rtt = 0;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      this.bytesIn += ev.data.length;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data) as ServerMessage;
      } catch {
        return;
      }
      if (msg.t === 'ping') {
        if (typeof msg.rtt === 'number') this.rtt = msg.rtt;
        this.send({ t: 'pong', id: msg.id });
        return;
      }
      this.queue.push(msg);
    };
    ws.onclose = (ev) => {
      if (this.closed) return;
      this.closed = true;
      // 1001: the server is restarting (GameServer.stop); 4001: the admin removed us (GameServer.kick)
      this.onClose?.(ev.code === 1001 ? t('net.restarting') : ev.code === 4001 ? t('net.kicked') : t('net.lost'));
    };
  }

  /** Connects, introduces the player and resolves with the server's welcome. */
  static open(url: string, name: string, skin: SkinInfo, token?: string, timeoutMs = 10000): Promise<{ conn: Connection; welcome: WelcomeMessage }> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        reject(e);
        return;
      }
      const conn = new Connection(ws);
      const fail = (reason: string) => {
        if (settled) return;
        settled = true;
        conn.closed = true;
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        reject(new Error(reason));
      };
      const timer = setTimeout(() => fail(t('net.noAnswer')), timeoutMs);
      ws.onopen = () => conn.send({ t: 'hello', v: PROTOCOL_VERSION, name, skin, token });
      ws.onerror = () => fail(t('net.cantConnect'));
      const baseOnMessage = ws.onmessage;
      ws.onmessage = (ev) => {
        baseOnMessage?.call(ws, ev);
        if (settled) return;
        const first = conn.queue.find((m) => m.t === 'welcome' || m.t === 'reject');
        if (!first) return;
        conn.queue.splice(conn.queue.indexOf(first), 1);
        clearTimeout(timer);
        if (first.t === 'reject') {
          fail(first.code === 'version' ? t('net.version') : first.code === 'full' ? t('net.full') : first.reason);
          return;
        }
        settled = true;
        ws.onerror = null;
        resolve({ conn, welcome: first });
      };
    });
  }

  get isOpen(): boolean {
    return !this.closed && this.ws.readyState === WebSocket.OPEN;
  }

  send(msg: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Messages received since the last call. */
  drain(): ServerMessage[] {
    return this.queue.splice(0, this.queue.length);
  }

  close(): void {
    this.closed = true;
    try {
      this.ws.close(1000);
    } catch {
      /* ignore */
    }
  }
}
