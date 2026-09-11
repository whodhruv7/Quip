// Quip V3 — documents toolkit (Skales "Documents" + "pdf-extract" parity).
// ─────────────────────────────────────────────────────────────────────────────
// Real file capabilities, zero new dependencies:
//   pdf_read    — extract text from a PDF on disk (FlateDecode streams,
//                 Tj/TJ operators; honest "scanned images" failure).
//   doc_read    — text out of a .docx (OOXML zip reader).
//   doc_create  — create REAL .docx / .xlsx / .pptx files from text/rows/
//                 slides via a minimal OOXML (stored-ZIP) writer. Opens in
//                 Word/Excel/PowerPoint/LibreOffice.
//
// The zip writer emits STORED entries (no compression) — valid ZIP per the
// spec (method 0), small for text documents, and immune to deflate edge
// cases. Everything is pure Node and regression-testable.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import zlib from "node:zlib";

// ─── CRC32 ───────────────────────────────────────────────────────────────────

const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ─── ZIP writer (STORED entries) ─────────────────────────────────────────────

interface ZipEntry {
  name: string;
  data: Buffer;
}

/** Build a valid ZIP file with STORED (uncompressed) entries. */
export function buildZip(entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0, 12); // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18); // compressed
    local.writeUInt32LE(size, 22); // uncompressed
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra len
    chunks.push(local, nameBuf, entry.data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); // central dir signature
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0, 8); // flags
    cd.writeUInt16LE(0, 10); // method
    cd.writeUInt16LE(0, 12); // time
    cd.writeUInt16LE(0, 14); // date
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(size, 20);
    cd.writeUInt32LE(size, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // extra
    cd.writeUInt16LE(0, 32); // comment
    cd.writeUInt16LE(0, 34); // disk start
    cd.writeUInt16LE(0, 36); // internal attrs
    cd.writeUInt32LE(0, 38); // external attrs
    cd.writeUInt32LE(offset, 42); // local header offset
    central.push(cd, nameBuf);

    offset += 30 + nameBuf.length + size;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16); // central dir offset
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, centralBuf, eocd]);
}

// ─── ZIP reader (stored + deflate) — used by doc_read ───────────────────────

interface ZipReadEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

function findEocd(buf: Buffer): number {
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66_000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error("not a zip file");
}

function readCentralDirectory(buf: Buffer): Map<string, ZipReadEntry> {
  const eocd = findEocd(buf);
  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, ZipReadEntry>();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) break;
    const method = buf.readUInt16LE(ptr + 10);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const uncompressedSize = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.slice(ptr + 46, ptr + 46 + nameLen).toString("utf8");
    out.set(name, { name, method, compressedSize, uncompressedSize, localOffset });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Extract one file's bytes from a zip buffer (stored or deflate). */
export function zipExtract(buf: Buffer, wantedName: string): Buffer | null {
  const dir = readCentralDirectory(buf);
  const entry = dir.get(wantedName);
  if (!entry) return null;
  // Local header: variable name/extra lengths live HERE, not in central dir.
  const lh = entry.localOffset;
  if (buf.readUInt32LE(lh) !== 0x04034b50) throw new Error("corrupt zip entry");
  const nameLen = buf.readUInt16LE(lh + 26);
  const extraLen = buf.readUInt16LE(lh + 28);
  const dataStart = lh + 30 + nameLen + extraLen;
  const raw = buf.slice(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) return zlib.inflateRawSync(raw);
  throw new Error(`unsupported zip method ${entry.method}`);
}

// ─── XML helpers ─────────────────────────────────────────────────────────────

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// ─── OOXML builders ──────────────────────────────────────────────────────────

const CT_ROOT =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `{OVERWRIDES}</Types>`;

const RELS_ROOT =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="{MAIN}"/>` +
  `</Relationships>`;

function docProps(app: string): ZipEntry[] {
  return [
    {
      name: "docProps/core.xml",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
          `xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Quip</dc:creator><cp:lastModifiedBy>Quip</cp:lastModifiedBy></cp:coreProperties>`,
        "utf8"
      ),
    },
    {
      name: "docProps/app.xml",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>${app}</Application></Properties>`,
        "utf8"
      ),
    },
  ];
}

// ─── .docx ───────────────────────────────────────────────────────────────────

function docxParagraphs(text: string): string {
  const paras = text.split(/\r?\n/);
  return paras
    .map((p) => {
      const runs = p.length
        ? `<w:r><w:t xml:space="preserve">${xmlEscape(p)}</w:t></w:r>`
        : "";
      return `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr>${runs}</w:p>`;
    })
    .join("");
}

function makeDocx(title: string, text: string): Buffer {
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${docxParagraphs(text)}` +
    `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>` +
    `</w:body></w:document>`;
  const overrides =
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
    `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>`;
  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: Buffer.from(CT_ROOT.replace("{OVERWRIDES}", overrides), "utf8") },
    { name: "_rels/.rels", data: Buffer.from(RELS_ROOT.replace("{MAIN}", "word/document.xml"), "utf8") },
    ...docProps("Quip Writer"),
    { name: "word/document.xml", data: Buffer.from(documentXml, "utf8") },
  ];
  void title;
  return buildZip(entries);
}

// ─── .xlsx ───────────────────────────────────────────────────────────────────

function colLetter(i: number): string {
  let s = "";
  let n = i;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function xlsxSheet(rows: string[][]): string {
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          const num = value !== "" && !Number.isNaN(Number(value)) && /^-?\d+(\.\d+)?$/.test(value.trim());
          const ref = `${colLetter(c)}${r + 1}`;
          return num
            ? `<c r="${ref}"><v>${Number(value)}</v></c>`
            : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>${body}</sheetData></worksheet>`
  );
}

function makeXlsx(rows: string[][]): Buffer {
  const sheet = xlsxSheet(rows.length ? rows : [[""]]);
  const overrides =
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
    `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>`;
  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: Buffer.from(CT_ROOT.replace("{OVERWRIDES}", overrides), "utf8") },
    { name: "_rels/.rels", data: Buffer.from(RELS_ROOT.replace("{MAIN}", "xl/workbook.xml"), "utf8") },
    ...docProps("Quip Sheets"),
    {
      name: "xl/workbook.xml",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
          `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
          `<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
        "utf8"
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
          `</Relationships>`,
        "utf8"
      ),
    },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheet, "utf8") },
  ];
  return buildZip(entries);
}

// ─── .pptx ───────────────────────────────────────────────────────────────────

function pptxSlide(title: string, body: string, slideId: number): { xml: string; rels: string } {
  const paras = body
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map(
      (line) =>
        `<a:p><a:r><a:rPr lang="en-US" sz="1600"/><a:t>${xmlEscape(line)}</a:t></a:r></a:p>`
    )
    .join("");
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr/><p:sp>` +
    `<p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="7489750" cy="1325563"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="3200" b="1"/><a:t>${xmlEscape(title)}</a:t></a:r></a:p></p:txBody>` +
    `</p:sp><p:sp>` +
    `<p:nvSpPr><p:cNvPr id="3" name="Content"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="838200" y="1825625"/><a:ext cx="7489750" cy="4088950"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/>${paras}</p:txBody>` +
    `</p:sp></p:spTree></p:cSld></p:sld>`;
  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
    `</Relationships>`;
  void slideId;
  return { xml, rels };
}

function makePptx(slides: { title: string; body: string }[]): Buffer {
  const safeSlides = slides.length ? slides : [{ title: "Untitled", body: "" }];
  const entries: ZipEntry[] = [];

  const overrides: string[] = [
    `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>`,
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`,
    `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>`,
  ];
  safeSlides.forEach((_, i) => {
    overrides.push(
      `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
    );
  });
  entries.push({ name: "[Content_Types].xml", data: Buffer.from(CT_ROOT.replace("{OVERWRIDES}", overrides.join("")), "utf8") });
  entries.push({ name: "_rels/.rels", data: Buffer.from(RELS_ROOT.replace("{MAIN}", "ppt/presentation.xml"), "utf8") });
  entries.push(...docProps("Quip Slides"));

  entries.push({
    name: "ppt/presentation.xml",
    data: Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ` +
        `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" saveSubsetFonts="1">` +
        `<p:sldIdLst>` +
        safeSlides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join("") +
        `</p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
      "utf8"
    ),
  });
  entries.push({
    name: "ppt/_rels/presentation.xml.rels",
    data: Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        safeSlides
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`
          )
          .join("") +
        `</Relationships>`,
      "utf8"
    ),
  });

  safeSlides.forEach((s, i) => {
    const { xml, rels } = pptxSlide(s.title, s.body, i + 1);
    entries.push({ name: `ppt/slides/slide${i + 1}.xml`, data: Buffer.from(xml, "utf8") });
    entries.push({ name: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: Buffer.from(rels, "utf8") });
  });

  return buildZip(entries);
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface DocResult {
  ok: boolean;
  summary: string;
  evidence: string[];
}

export type DocKind = "docx" | "xlsx" | "pptx";

/** Create a real Office document at an absolute path. */
export function createDocument(
  kind: DocKind,
  filePath: string,
  content: { text?: string; rows?: string[][]; slides?: { title: string; body: string }[] }
): DocResult {
  try {
    if (!filePath) return { ok: false, summary: "I need a path to save the file to.", evidence: [] };
    const ext = filePath.toLowerCase().split(".").pop();
    if (ext !== kind) {
      return { ok: false, summary: `The path must end with ".${kind}" (you asked for a ${kind} file).`, evidence: [] };
    }
    let buf: Buffer;
    if (kind === "docx") {
      const text = (content.text ?? "").trim();
      if (!text) return { ok: false, summary: "Give me the text to put in the document.", evidence: [] };
      buf = makeDocx(filePath, text);
    } else if (kind === "xlsx") {
      const rows = content.rows ?? [];
      if (rows.length === 0) return { ok: false, summary: "Give me the rows for the spreadsheet.", evidence: [] };
      buf = makeXlsx(rows);
    } else {
      const slides = content.slides ?? [];
      if (slides.length === 0) return { ok: false, summary: "Give me at least one slide (title + content).", evidence: [] };
      buf = makePptx(slides);
    }
    fs.mkdirSync(filePath.replace(/[\\/][^\\/]+$/, ""), { recursive: true });
    fs.writeFileSync(filePath, buf);
    return {
      ok: true,
      summary: `Created ${filePath} (${(buf.length / 1024).toFixed(1)} KB) — a real ${kind.toUpperCase()} file you can open.`,
      evidence: ["ooxml writer", kind],
    };
  } catch (e: any) {
    return { ok: false, summary: `I couldn't create the ${kind} file — ${e?.message ?? e}.`, evidence: ["doc create failed"] };
  }
}

/** Extract text from a PDF file (FlateDecode streams, Tj/TJ operators). */
export function pdfRead(filePath: string): DocResult {
  try {
    const buf = fs.readFileSync(filePath);
    const head = buf.slice(0, 1024).toString("latin1");
    if (!head.startsWith("%PDF")) {
      return { ok: false, summary: "That file doesn't look like a PDF.", evidence: [] };
    }
    if (/\/Encrypt\b/.test(buf.toString("latin1"))) {
      return { ok: false, summary: "That PDF is password-protected — I can't read it without the password.", evidence: ["encrypted pdf"] };
    }

    const texts: string[] = [];
    const latin = buf.toString("latin1");
    const streamRe = /stream\r?\n?/g;
    let m: RegExpExecArray | null;
    while ((m = streamRe.exec(latin)) !== null) {
      const start = m.index + m[0].length;
      const end = latin.indexOf("endstream", start);
      if (end === -1) continue;
      streamRe.lastIndex = end;
      // Look back for the stream's dict to detect FlateDecode.
      const dictStart = Math.max(0, m.index - 600);
      const dict = latin.slice(dictStart, m.index);
      const raw = buf.slice(start, end);
      let content = "";
      if (/\/FlateDecode/.test(dict)) {
        try {
          content = zlib.inflateSync(raw).toString("utf8");
        } catch {
          try {
            content = zlib.inflateRawSync(raw).toString("utf8");
          } catch {
            continue;
          }
        }
      } else if (/\/DCTDecode|\/JPXDecode|\/CCITTFaxDecode|\/Image\b/.test(dict)) {
        continue; // image stream — no text
      } else {
        content = raw.toString("utf8");
      }
      if (!/(Tj|TJ)\s*$|\)\s*Tj/.test(content) && !content.includes("TJ")) continue;
      texts.push(extractPdfTextOps(content));
      if (texts.join(" ").length > 60_000) break;
    }

    const joined = texts
      .join("\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (joined.replace(/\s/g, "").length < 8) {
      return {
        ok: false,
        summary:
          "I opened the PDF but found no extractable text — it's probably scanned images. OCR isn't in my toolkit yet.",
        evidence: ["no text layer"],
      };
    }
    const trimmed = joined.length > 12_000 ? `${joined.slice(0, 12_000)}\n… (truncated)` : joined;
    return {
      ok: true,
      summary: `Text from ${filePath.split(/[\\/]/).pop()}:\n${trimmed}`,
      evidence: ["pdf text extraction", `${joined.length} chars`],
    };
  } catch (e: any) {
    return { ok: false, summary: `PDF read failed — ${e?.message ?? e}.`, evidence: ["pdf extract failed"] };
  }
}

/** Pull literal strings out of PDF content-stream text operators. */
function extractPdfTextOps(content: string): string {
  const out: string[] = [];
  // (text) Tj  and  [(a) -12 (b)] TJ  and  <hex> Tj
  const re = /\((?:\\.|[^\\()])*\)\s*Tj|<[^>]+>\s*Tj|\[(?:\\.|[^\]])*\]\s*TJ|T\*|1?\d*\.?\d+\s+(?:Td|TD)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const token = m[0];
    if (token === "T*") {
      out.push("\n");
      continue;
    }
    if (/Td|TD$/.test(token.trim())) {
      out.push("\n");
      continue;
    }
    const strings = token.match(/\((?:\\.|[^\\()])*\)|<[^>]+>/g) ?? [];
    let line = "";
    for (const s of strings) {
      if (s.startsWith("(")) {
        line += s
          .slice(1, -1)
          .replace(/\\([nrtbf()\\])/g, (_x, c: string) =>
            c === "n" ? "\n" : c === "r" ? "" : c === "t" ? "\t" : c === "b" || c === "f" ? "" : c
          )
          .replace(/\\([0-7]{1,3})/g, (_y, oct: string) => String.fromCharCode(parseInt(oct, 8)));
      } else {
        const hex = s.slice(1, -1).replace(/\s/g, "");
        let decoded = "";
        try {
          if (hex.length % 4 === 0 && /[\u0000]/.test("")) {
            // UTF-16BE heuristic for hex strings
            decoded = hex.match(/.{4}/g)!.map((h) => String.fromCharCode(parseInt(h, 16))).join("");
            if (/[\u0000-\u001f]/.test(decoded[0] ?? "")) decoded = "";
          }
          if (!decoded) {
            decoded = hex.match(/.{2}/g)!.map((h) => String.fromCharCode(parseInt(h, 16))).join("");
          }
        } catch {
          decoded = "";
        }
        line += decoded;
      }
    }
    if (line.trim()) out.push(line);
  }
  return out.join(" ");
}

/** Read text out of a .docx file. */
export function docxRead(filePath: string): DocResult {
  try {
    const buf = fs.readFileSync(filePath);
    const xmlBuf = zipExtract(buf, "word/document.xml");
    if (!xmlBuf) {
      return { ok: false, summary: "That .docx doesn't contain a document body — is it really a Word file?", evidence: [] };
    }
    const xml = xmlBuf.toString("utf8");
    const text = xml
      .replace(/<\/w:p>/g, "\n")
      .replace(/<w:tab[^>]*\/>/g, "\t")
      .replace(/<[^>]+>/g, "")
      .split("\n")
      .map((l) => decodeEntities(l).trim())
      .filter((l) => l.length > 0)
      .join("\n");
    if (!text) {
      return { ok: false, summary: "That document appears to be empty.", evidence: ["docx read"] };
    }
    const trimmed = text.length > 12_000 ? `${text.slice(0, 12_000)}\n… (truncated)` : text;
    return {
      ok: true,
      summary: `Text from ${filePath.split(/[\\/]/).pop()}:\n${trimmed}`,
      evidence: ["docx reader", `${text.length} chars`],
    };
  } catch (e: any) {
    return { ok: false, summary: `Reading that .docx failed — ${e?.message ?? e}.`, evidence: ["docx read failed"] };
  }
}
