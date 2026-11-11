// PDF da agenda (A4 retrato): o mesmo layout no botão de impressão e no e-mail do médico.
// Lê bem no celular e impresso: cada atendimento é um cartão com horário, paciente,
// procedimento e equipe, como na tela da agenda.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import type { AgendaPrint, PrintAgenda, PrintEntry, PrintStatus } from "../agenda/print";

const W = 595.28, H = 841.89, M = 36, FOOTER = 30;
const ink = rgb(.09, .16, .2), teal = rgb(.07, .36, .39), muted = rgb(.38, .45, .5), rule = rgb(.86, .9, .91);
const soft = rgb(.94, .97, .97), blockBg = rgb(.996, .965, .89), blockInk = rgb(.55, .36, .03);
const STATUS: Record<PrintStatus, { fg: RGB; bg: RGB }> = {
  scheduled: { fg: rgb(.6, .39, .02), bg: rgb(1, .95, .83) },
  confirmed: { fg: rgb(.07, .45, .26), bg: rgb(.87, .96, .9) },
  authorized: { fg: rgb(.12, .33, .62), bg: rgb(.89, .93, .99) },
  analysis: { fg: rgb(.42, .25, .62), bg: rgb(.94, .91, .99) },
  realized: { fg: rgb(.33, .38, .42), bg: rgb(.92, .93, .94) },
  other: { fg: rgb(.33, .38, .42), bg: rgb(.92, .93, .94) },
};

// As fontes padrão do PDF só codificam WinAnsi: um nome com caractere fora dele não pode
// derrubar o documento inteiro. Acentos são preservados; o resto vira a letra-base ou "?".
const WIN_ANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
export function pdfSafe(value: string): string {
  return Array.from(String(value ?? "").replace(/[\r\n\t]+/g, " ")).map((ch) => {
    const code = ch.codePointAt(0)!;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.includes(ch)) return ch;
    const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    return base && base !== ch && Array.from(base).every((c) => c.charCodeAt(0) < 0x7f) ? base : "?";
  }).join("");
}
const brDateTime = (iso: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(iso));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

class AgendaPdf {
  private doc!: PDFDocument; private font!: PDFFont; private bold!: PDFFont; private page!: PDFPage;
  private y = 0; private agenda: PrintAgenda | null = null;
  constructor(private readonly model: AgendaPrint) {}
  async render(): Promise<Uint8Array> {
    this.doc = await PDFDocument.create();
    this.doc.setTitle(pdfSafe(`${this.model.title} · ${this.model.periodLabel}`));
    this.doc.setProducer("RN Integra"); this.doc.setCreator("RN Integra");
    this.font = await this.doc.embedFont(StandardFonts.Helvetica);
    this.bold = await this.doc.embedFont(StandardFonts.HelveticaBold);
    if (!this.model.agendas.length) { this.newPage(true); this.empty("Nenhuma agenda selecionada."); }
    this.model.agendas.forEach((agenda) => { this.agenda = agenda; this.newPage(true); this.drawAgenda(agenda); });
    this.footers();
    return this.doc.save();
  }

  // ---- primitivas
  private text(value: string, x: number, y: number, size: number, font = this.font, color: RGB = ink) {
    this.page.drawText(pdfSafe(value), { x, y, size, font, color });
  }
  private width(value: string, size: number, font = this.font) { return font.widthOfTextAtSize(pdfSafe(value), size); }
  private fit(value: string, max: number, size: number, font = this.font) {
    let label = pdfSafe(value);
    if (this.width(label, size, font) <= max) return label;
    while (label.length > 1 && this.width(label + "…", size, font) > max) label = label.slice(0, -1);
    return label.trimEnd() + "…";
  }
  private wrap(value: string, max: number, size: number, font = this.font, lines = 2): string[] {
    const words = pdfSafe(value).split(/\s+/).filter(Boolean), out: string[] = [];
    let current = "";
    for (const word of words) {
      const next = current ? current + " " + word : word;
      if (this.width(next, size, font) <= max) { current = next; continue; }
      if (current) out.push(current);
      current = word;
      if (out.length === lines) break;
    }
    if (current && out.length < lines) out.push(current);
    if (out.length === lines && words.join(" ") !== out.join(" ")) out[lines - 1] = this.fit(out[lines - 1] + " …", max, size, font);
    return out.length ? out.map((l) => this.fit(l, max, size, font)) : ["—"];
  }
  private pill(label: string, right: number, top: number, fg: RGB, bg: RGB) {
    const size = 7, w = this.width(label, size, this.bold) + 12;
    this.page.drawRectangle({ x: right - w, y: top - 14, width: w, height: 14, color: bg });
    this.text(label, right - w + 6, top - 10, size, this.bold, fg);
    return w;
  }
  private ensure(height: number) { if (this.y - height < M + FOOTER) this.newPage(false); }

  // ---- página e cabeçalho
  private newPage(first: boolean) {
    this.page = this.doc.addPage([W, H]);
    this.y = H - M;
    const m = this.model;
    this.text(this.fit(m.organization || "RN Integra", W / 2, 9, this.bold), M, this.y, 9, this.bold, teal);
    const gen = `Gerado em ${brDateTime(m.generatedAt)} por ${m.generatedBy}`;
    const genFit = this.fit(gen, W / 2 - M, 7);
    this.text(genFit, W - M - this.width(genFit, 7), this.y, 7, this.font, muted);
    this.y -= 10;
    this.page.drawLine({ start: { x: M, y: this.y }, end: { x: W - M, y: this.y }, thickness: 1.2, color: teal });
    if (!this.agenda) { this.y -= 26; return; }
    const p = this.agenda.professional;
    if (first) {
      this.y -= 26;
      this.text(m.title, M, this.y, 18, this.bold, ink);
      const per = this.fit(m.periodLabel, W - 2 * M - this.width(m.title, 18, this.bold) - 16, 11);
      this.text(per, W - M - this.width(per, 11), this.y + 1, 11, this.font, teal);
      this.y -= 26;
      // Faixa do profissional com o total do período.
      this.page.drawRectangle({ x: M, y: this.y - 14, width: W - 2 * M, height: 34, color: soft });
      this.text(this.fit(p.name, 300, 12, this.bold), M + 12, this.y + 3, 12, this.bold, ink);
      this.text([p.role, p.crm && `CRM ${p.crm}`].filter(Boolean).join(" · "), M + 12, this.y - 9, 8, this.font, muted);
      const total = [plural(this.agenda.appointments, "atendimento", "atendimentos"), this.agenda.blocks ? plural(this.agenda.blocks, "bloqueio", "bloqueios") : ""].filter(Boolean).join(" · ");
      this.text(total, W - M - 12 - this.width(total, 9, this.bold), this.y - 3, 9, this.bold, teal);
      this.y -= 32;
    } else {
      this.y -= 18;
      const cont = `${m.title} · ${m.periodLabel} · ${p.name} (continuação)`;
      this.text(this.fit(cont, W - 2 * M, 8), M, this.y, 8, this.font, muted);
      this.y -= 14;
    }
  }
  private footers() {
    const pages = this.doc.getPages();
    pages.forEach((page, i) => {
      this.page = page;
      page.drawLine({ start: { x: M, y: M + 10 }, end: { x: W - M, y: M + 10 }, thickness: .5, color: rule });
      this.text("RN Integra · Contém dados de pacientes: uso restrito à equipe da clínica.", M, M, 7, this.font, muted);
      const label = `Página ${i + 1} de ${pages.length}`;
      this.text(label, W - M - this.width(label, 7), M, 7, this.font, muted);
    });
  }
  private empty(message: string) { this.text(message, M, this.y, 9, this.font, muted); this.y -= 20; }

  // ---- conteúdo
  private drawAgenda(agenda: PrintAgenda) {
    if (!agenda.days.length) { this.empty("Nenhum atendimento ou bloqueio no período."); return; }
    for (const day of agenda.days) {
      // O título do dia nunca fica sozinho no fim da página.
      this.ensure(22 + (day.entries.length ? 50 : 20));
      this.page.drawRectangle({ x: M, y: this.y - 18, width: W - 2 * M, height: 20, color: teal });
      this.text(day.label, M + 10, this.y - 12, 10, this.bold, rgb(1, 1, 1));
      const count = day.appointments ? plural(day.appointments, "atendimento", "atendimentos") : "Livre";
      this.text(count, W - M - 10 - this.width(count, 8), this.y - 12, 8, this.font, rgb(.86, .95, .95));
      this.y -= 24;
      if (!day.entries.length) { this.text("Sem atendimentos.", M + 10, this.y - 8, 8, this.font, muted); this.y -= 20; continue; }
      for (const entry of day.entries) this.drawEntry(entry);
      this.y -= 6;
    }
  }
  private drawEntry(entry: PrintEntry) {
    const left = M, right = W - M, timeW = 62, x = left + timeW + 10;
    if (entry.kind === "block") {
      const h = 26; this.ensure(h + 4);
      const top = this.y;
      this.page.drawRectangle({ x: left, y: top - h, width: right - left, height: h, color: blockBg });
      this.page.drawRectangle({ x: left, y: top - h, width: 3, height: h, color: blockInk });
      this.text(`${entry.start}–${entry.end}`, left + 10, top - 16, 9, this.bold, blockInk);
      this.text(this.fit(`Bloqueado · ${entry.reason}`, right - x - 10, 9), x, top - 16, 9, this.font, blockInk);
      this.y = top - h - 4; return;
    }
    const status = STATUS[entry.status];
    const pillW = this.width(entry.statusLabel, 7, this.bold) + 12;
    const textW = right - x - pillW - 14;
    const patient = this.wrap(entry.patient, textW, 10.5, this.bold, 2);
    const procedure = this.wrap(entry.procedure, right - x - 10, 9, this.font, 2);
    const meta = [entry.hospital, entry.partner, entry.insurance, entry.careType, ...entry.flags].filter(Boolean).join("  ·  ");
    const metaLines = meta ? this.wrap(meta, right - x - 10, 8, this.font, 2) : [];
    const h = Math.max(38, 10 + patient.length * 13 + procedure.length * 11 + metaLines.length * 10 + 6);
    this.ensure(h + 4);
    const top = this.y;
    this.page.drawRectangle({ x: left, y: top - h, width: right - left, height: h, borderColor: rule, borderWidth: .6 });
    this.page.drawRectangle({ x: left, y: top - h, width: 3, height: h, color: status.fg });
    this.text(entry.start || "—", left + 10, top - 17, 13, this.bold, ink);
    if (entry.end) this.text(`até ${entry.end}`, left + 10, top - 29, 8, this.font, muted);
    this.pill(entry.statusLabel, right - 8, top - 6, status.fg, status.bg);
    let y = top - 16;
    for (const line of patient) { this.text(line, x, y, 10.5, this.bold, ink); y -= 13; }
    y += 1;
    for (const line of procedure) { this.text(line, x, y, 9, this.font, ink); y -= 11; }
    for (const line of metaLines) { this.text(line, x, y, 8, this.font, muted); y -= 10; }
    this.y = top - h - 4;
  }
}

export function renderAgendaPdf(model: AgendaPrint): Promise<Uint8Array> { return new AgendaPdf(model).render(); }
