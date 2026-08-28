import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AppAuthorizationError, requireAppPermission } from "../_shared/authorization.ts";
import { emailCorsHeaders, mustEmailEnv, normalizeEmailAddress } from "../_shared/email.ts";

// Cliente IMAP mínimo, sem dependências npm: os pacotes imapflow+mailparser
// excedem o limite de memória (150MB) e tempo (60s) deste worker sandboxed.
// Só precisamos de LOGIN, SELECT, UID SEARCH e UID FETCH BODY.PEEK[].
class MinimalImapClient {
  #conn: Deno.TlsConn | null = null;
  #buffer = new Uint8Array(0);
  #tagCounter = 0;

  async connect(hostname: string, port: number) {
    this.#conn = await Deno.connectTls({ hostname, port });
    await this.#readLine(); // greeting
  }

  async #fill(): Promise<boolean> {
    if (!this.#conn) throw new Error("Ligação IMAP não estabelecida.");
    const chunk = new Uint8Array(16384);
    const read = await this.#conn.read(chunk);
    if (read === null) return false;
    const next = new Uint8Array(this.#buffer.length + read);
    next.set(this.#buffer, 0);
    next.set(chunk.subarray(0, read), this.#buffer.length);
    this.#buffer = next;
    return true;
  }

  async #readLine(): Promise<string> {
    for (;;) {
      const idx = this.#indexOfCrlf();
      if (idx >= 0) {
        const line = this.#buffer.subarray(0, idx);
        this.#buffer = this.#buffer.subarray(idx + 2);
        return new TextDecoder().decode(line);
      }
      if (!(await this.#fill())) throw new Error("Ligação IMAP fechada inesperadamente.");
    }
  }

  #indexOfCrlf(): number {
    for (let i = 0; i < this.#buffer.length - 1; i += 1) {
      if (this.#buffer[i] === 13 && this.#buffer[i + 1] === 10) return i;
    }
    return -1;
  }

  async #readExact(size: number): Promise<Uint8Array> {
    while (this.#buffer.length < size) {
      if (!(await this.#fill())) throw new Error("Ligação IMAP fechada a meio de uma leitura.");
    }
    const out = this.#buffer.subarray(0, size);
    this.#buffer = this.#buffer.subarray(size);
    return out;
  }

  async #write(text: string) {
    if (!this.#conn) throw new Error("Ligação IMAP não estabelecida.");
    await this.#conn.write(new TextEncoder().encode(text));
  }

  static quote(value: string): string {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }

  // Corre um comando simples (sem literais na resposta) e devolve as linhas até à conclusão marcada.
  async command(cmd: string): Promise<string[]> {
    this.#tagCounter += 1;
    const tag = `A${this.#tagCounter}`;
    await this.#write(`${tag} ${cmd}\r\n`);
    const lines: string[] = [];
    for (;;) {
      const line = await this.#readLine();
      lines.push(line);
      if (line.startsWith(`${tag} `)) {
        if (!/^\w+ OK/i.test(line)) throw new Error(`Comando IMAP falhou: ${cmd} -> ${line}`);
        return lines;
      }
    }
  }

  // FETCH devolve literais ({N}<bytes>); processamos byte a byte para não confundir CRLFs dentro do corpo com fim de linha.
  async fetchUidSource(uid: number): Promise<string | null> {
    this.#tagCounter += 1;
    const tag = `A${this.#tagCounter}`;
    await this.#write(`${tag} UID FETCH ${uid} (BODY.PEEK[])\r\n`);
    let source: string | null = null;
    for (;;) {
      const line = await this.#readLine();
      if (Deno.env.get("IMAP_DEBUG") === "true") console.error("FETCH line:", JSON.stringify(line.slice(0, 200)));
      if (line.startsWith(`${tag} `)) {
        if (!/^\w+ OK/i.test(line)) throw new Error(`UID FETCH falhou: ${line}`);
        return source;
      }
      const literalMatch = line.match(/BODY(?:\.PEEK)?\[\]\s*\{(\d+)\}$/i);
      if (literalMatch) {
        const size = Number(literalMatch[1]);
        const bytes = await this.#readExact(size);
        source = new TextDecoder().decode(bytes);
        // consome o resto da linha de fecho ") \r\n" que se segue ao literal
        await this.#readLine();
      }
    }
  }

  async uidSearchSince(lastUid: number): Promise<number[]> {
    const lines = await this.command(`UID SEARCH UID ${lastUid + 1}:*`);
    const uids: number[] = [];
    for (const line of lines) {
      const match = line.match(/^\*\s+SEARCH(.*)$/i);
      if (!match) continue;
      for (const token of match[1].trim().split(/\s+/)) {
        const n = Number(token);
        if (Number.isFinite(n) && n > lastUid) uids.push(n);
      }
    }
    return Array.from(new Set(uids)).sort((a, b) => a - b);
  }

  async selectInboxUidNext(): Promise<number> {
    const lines = await this.command("SELECT INBOX");
    for (const line of lines) {
      const match = line.match(/UIDNEXT\s+(\d+)/i);
      if (match) return Number(match[1]);
    }
    return 1;
  }

  async logout() {
    try {
      await this.#write("Z1 LOGOUT\r\n");
    } catch {
      // ignora - vamos fechar a ligação de qualquer forma
    }
    this.#conn?.close();
    this.#conn = null;
  }
}

// --- Parser mínimo de MIME, só o suficiente para localizar a parte
// message/delivery-status (RFC 3464) dentro de um relatório de devolução. ---

const parseHeaders = (block: string): Record<string, string> => {
  const headers: Record<string, string> = {};
  const unfolded = block.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const match = line.match(/^([\w-]+):\s*(.*)$/);
    if (match) headers[match[1].toLowerCase()] = match[2];
  }
  return headers;
};

const splitHeaderAndBody = (source: string): { headers: Record<string, string>; body: string } => {
  const idx = source.search(/\r?\n\r?\n/);
  if (idx < 0) return { headers: parseHeaders(source), body: "" };
  const headerBlock = source.slice(0, idx);
  const bodyStart = source.slice(idx).match(/^\r?\n\r?\n/)![0].length;
  return { headers: parseHeaders(headerBlock), body: source.slice(idx + bodyStart) };
};

const extractBoundary = (contentType: string): string | null => {
  const match = contentType.match(/boundary="?([^";]+)"?/i);
  return match ? match[1] : null;
};

// Devolve as partes MIME de nível superior de um multipart body.
const splitMultipart = (body: string, boundary: string): string[] => {
  const marker = `--${boundary}`;
  const segments = body.split(marker);
  // ignora preâmbulo (antes da 1ª ocorrência) e epílogo (após "--" final)
  return segments.slice(1, -1).map((segment) => segment.replace(/^\r?\n/, ""));
};

type BounceCandidate = { email: string; status: string | null; permanent: boolean };

const extractFromDeliveryStatusText = (text: string): BounceCandidate[] => {
  const blocks = text.split(/\r?\n\r?\n/);
  const results: BounceCandidate[] = [];
  for (const block of blocks) {
    const recipientMatch = block.match(/Final-Recipient:\s*rfc822;\s*([^\s]+)/i)
      || block.match(/Original-Recipient:\s*rfc822;\s*([^\s]+)/i);
    if (!recipientMatch) continue;
    const statusMatch = block.match(/Status:\s*([0-9](?:\.[0-9]+){2})/i);
    const actionMatch = block.match(/Action:\s*(\w+)/i);
    const status = statusMatch?.[1] || null;
    const action = actionMatch?.[1]?.toLowerCase() || null;
    if (action && action !== "failed" && action !== "delayed") continue;
    const permanent = status ? status.startsWith("5") : action === "failed";
    results.push({ email: normalizeEmailAddress(recipientMatch[1]), status, permanent: Boolean(permanent) });
  }
  return results;
};

// Procura a parte message/delivery-status num relatório RFC3464; se não a
// encontrar (relay que não segue o standard), tenta extrair diretamente do
// corpo de texto simples da mensagem.
const findDeliveryStatusCandidates = (source: string): BounceCandidate[] => {
  const top = splitHeaderAndBody(source);
  const topContentType = top.headers["content-type"] || "";

  if (/multipart\/report/i.test(topContentType)) {
    const boundary = extractBoundary(topContentType);
    if (boundary) {
      for (const part of splitMultipart(top.body, boundary)) {
        const { headers, body } = splitHeaderAndBody(part);
        if (/message\/delivery-status/i.test(headers["content-type"] || "")) {
          const candidates = extractFromDeliveryStatusText(body);
          if (candidates.length) return candidates;
        }
      }
    }
  }

  return extractFromDeliveryStatusText(top.body || source);
};

const BOUNCE_SENDER_PATTERN = /mailer-daemon|postmaster|mail delivery|mail-daemon/i;
const BOUNCE_SUBJECT_PATTERN = /undeliverable|delivery status notification|delivery has failed|failure notice|returned mail|n[ãa]o (foi )?entregue|falha (na |de )?entrega/i;

const CONFIG_KEY = "email_bounce_check_state";

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...emailCorsHeaders, "Content-Type": "application/json" },
});

const authorize = async (req: Request) => {
  const expected = Deno.env.get("CRON_SECRET")?.trim();
  const supplied = req.headers.get("x-cron-secret")?.trim();
  if (expected && supplied === expected) return;
  await requireAppPermission(req, "emails", "view");
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: emailCorsHeaders });
  const client = new MinimalImapClient();
  try {
    if (req.method !== "POST") throw new AppAuthorizationError("Método não permitido.", 405);
    await authorize(req);

    const supabase = createClient(mustEmailEnv("SUPABASE_URL"), mustEmailEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });

    const host = Deno.env.get("IMAP_HOST") || mustEmailEnv("SMTP_HOST");
    const port = Number.parseInt(Deno.env.get("IMAP_PORT") || "993", 10);
    const username = Deno.env.get("IMAP_USERNAME") || mustEmailEnv("SMTP_USERNAME");
    const password = Deno.env.get("IMAP_PASSWORD") || mustEmailEnv("SMTP_PASSWORD");

    const { data: stateRow } = await supabase.from("app_config").select("value").eq("key", CONFIG_KEY).maybeSingle();
    const hasPriorState = stateRow?.value?.lastUid != null;
    let lastUid = Number(stateRow?.value?.lastUid || 0);

    await client.connect(host, port);
    await client.command(`LOGIN ${MinimalImapClient.quote(username)} ${MinimalImapClient.quote(password)}`);
    const uidNext = await client.selectInboxUidNext();

    if (!hasPriorState) {
      lastUid = Math.max(0, uidNext - 1);
      await supabase.from("app_config").upsert({
        key: CONFIG_KEY,
        value: { lastUid, checkedAt: new Date().toISOString(), baseline: true },
      });
      await client.logout();
      return jsonResponse({ ok: true, checked: 0, bounces: 0, softBounces: 0, suppressed: 0, lastUid, baseline: true });
    }

    const MAX_PER_RUN = 100;
    const candidateUids = (await client.uidSearchSince(lastUid)).slice(0, MAX_PER_RUN);

    let checked = 0;
    let bounces = 0;
    let softBounces = 0;
    let suppressed = 0;
    let highestUid = lastUid;
    const affectedCampaigns = new Set<string>();

    for (const uid of candidateUids) {
      if (uid > highestUid) highestUid = uid;
      const source = await client.fetchUidSource(uid);
      if (!source) continue;
      checked += 1;

      const { headers } = splitHeaderAndBody(source);
      const fromHeader = headers["from"] || "";
      const subject = headers["subject"] || "";
      const isReportType = /multipart\/report/i.test(headers["content-type"] || "");
      if (!isReportType && !BOUNCE_SENDER_PATTERN.test(fromHeader) && !BOUNCE_SUBJECT_PATTERN.test(subject)) continue;

      const candidates = findDeliveryStatusCandidates(source);
      for (const candidate of candidates) {
        if (!candidate.permanent) {
          softBounces += 1;
          continue;
        }

        const { data: recipient } = await supabase
          .from("email_campaign_recipients")
          .select("id,campaign_id,email")
          .eq("email_normalized", candidate.email)
          .eq("status", "accepted")
          .order("accepted_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (recipient) {
          await supabase.from("email_campaign_recipients").update({
            status: "bounced",
            bounced_at: new Date().toISOString(),
            last_error: `Bounce detetado por IMAP (status ${candidate.status || "?"})`,
          }).eq("id", recipient.id);
          await supabase.from("email_delivery_events").insert({
            recipient_id: recipient.id,
            campaign_id: recipient.campaign_id,
            event_type: "bounced",
            payload: { source: "imap_bounce_scan", status: candidate.status, subject },
          });
          affectedCampaigns.add(recipient.campaign_id);
          bounces += 1;
        }

        const { data: existingSuppression } = await supabase
          .from("email_suppressions")
          .select("id")
          .eq("email_normalized", candidate.email)
          .is("lifted_at", null)
          .maybeSingle();
        if (!existingSuppression) {
          await supabase.from("email_suppressions").insert({
            email: candidate.email,
            email_normalized: candidate.email,
            reason: "hard_bounce",
            source: "imap_bounce_scan",
            notes: `Status ${candidate.status || "desconhecido"}; assunto: ${subject}`.slice(0, 1000),
          });
          suppressed += 1;
        }
      }
    }

    await client.logout();

    if (highestUid > lastUid) {
      await supabase.from("app_config").upsert({
        key: CONFIG_KEY,
        value: { lastUid: highestUid, checkedAt: new Date().toISOString() },
      });
    }
    for (const campaignId of affectedCampaigns) {
      await supabase.rpc("refresh_email_campaign", { p_campaign_id: campaignId });
    }

    return jsonResponse({ ok: true, checked, bounces, softBounces, suppressed, lastUid: highestUid });
  } catch (error: any) {
    console.error("check-email-bounces:", error);
    await client.logout().catch(() => undefined);
    return jsonResponse(
      { error: error?.message || "Falha ao verificar devoluções." },
      error instanceof AppAuthorizationError ? error.status : 500,
    );
  }
});
