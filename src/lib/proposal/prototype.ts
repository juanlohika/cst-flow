/**
 * Phase F.2 prototype — AI-driven proposal generation against the live
 * template, with no template editing required.
 *
 * Approach:
 *   1. Download the configured template .docx from Drive.
 *   2. Extract its text content (via mammoth) so the AI can see what's there.
 *   3. Ask Gemini to read the template + new inputs and produce a list of
 *      structured EDIT OPERATIONS describing how to mutate the template into
 *      the final proposal. Operations are deliberately narrow (replace text,
 *      duplicate table row, set cell text by table index + row + cell).
 *   4. Apply the operations to a copy of the template using pizzip (which
 *      gives us raw access to the underlying XML).
 *   5. Upload the new file to Drive in the per-account folder.
 *
 * This is intentionally a one-shot spike, not production code. It WILL break
 * on edge cases — the goal is to see what quality of output we can get before
 * committing to a larger architecture.
 */
import { db } from "@/db";
import { proposalTemplate as proposalTemplateTable, clientProfiles } from "@/db/schema";
import { eq } from "drizzle-orm";
import PizZip from "pizzip";
import mammoth from "mammoth";
import { loadDriveCtx, fetchTemplateDocx, ensureAccountFolder, uploadProposalDocx } from "./drive";
import { getModelForApp, generateWithRetry } from "@/lib/ai";

export interface PrototypeInputs {
  clientCompanyName: string;
  preparedBy: string;
  submittedTo: string;
  projectTitle: string;          // e.g. "Manpower Costing Module Addendum"
  isAddendum: boolean;
  // Free-form scope description — the AI uses this to write objective + scope sections.
  scopeNotes: string;
  // Cost details — AI uses these to populate the pricing table.
  standardRate?: string;         // e.g. "P100 + VAT"
  discountedRate?: string;       // e.g. "P75 + VAT"
  currentSubscriptionRate?: string; // e.g. "P225"
  combinedRate?: string;         // e.g. "P300 + VAT"
  guaranteedUsers?: string;      // e.g. "30 Users"
  totalCost?: string;            // e.g. "P12,000.00 + VAT"
  // Timeline guidance — AI fills the phase table.
  timelineNotes?: string;
  // Signoff
  clientSignatoryName?: string;
  clientSignatoryTitle?: string;
  moiSignatoryName?: string;
  moiSignatoryTitle?: string;
}

export interface EditOperation {
  /**
   * "replace_paragraph" — find a paragraph that contains the matchText
   *   (case-insensitive, partial) and replace its entire text with newText.
   *   Used for headings, body text, signoff cells with prefix labels.
   *
   * "set_table_cell" — set the text of cell [row, col] in the Nth table
   *   (zero-indexed). Used for hard-to-find cells like the cost table.
   *
   * "duplicate_table_row" — clone the row at [tableIndex, rowIndex] N times.
   *   The cloned rows get the cellTexts array applied (one row per inner array).
   */
  op: "replace_paragraph" | "set_table_cell" | "duplicate_table_row";
  matchText?: string;
  newText?: string;
  tableIndex?: number;
  rowIndex?: number;
  colIndex?: number;
  cellTexts?: string[][];        // for duplicate_table_row
  reason?: string;               // AI's explanation, useful for debugging
}

export interface PrototypeResult {
  ok: boolean;
  driveUrl?: string;
  driveFileId?: string;
  fileName?: string;
  operationsApplied: number;
  operationsSkipped: Array<{ op: EditOperation; reason: string }>;
  aiResponse?: any;
  error?: string;
}

export async function runPrototype(args: {
  inputs: PrototypeInputs;
  clientProfileId?: string | null;
  generatedByUserId: string;
}): Promise<PrototypeResult> {
  // 1. Load template config
  const cfgRows = await db.select().from(proposalTemplateTable).where(eq(proposalTemplateTable.id, "default")).limit(1);
  const cfg = cfgRows[0];
  if (!cfg) return { ok: false, operationsApplied: 0, operationsSkipped: [], error: "No template configured. Set it up in /proposal-maker/settings first." };
  if (!cfg.proposalsRootFolderId) return { ok: false, operationsApplied: 0, operationsSkipped: [], error: "Proposals root folder not configured." };

  // 2. Fetch the template + extract its plain text so the AI can read it.
  const ctx = await loadDriveCtx();
  const fetched = await fetchTemplateDocx(ctx, cfg.driveFileId);
  const templateText = (await mammoth.extractRawText({ buffer: fetched.buffer })).value || "";

  // 3. Ask Gemini what edits to make.
  const aiResponse = await askGeminiForEdits({ templateText, inputs: args.inputs });
  if (!aiResponse.ok) {
    return { ok: false, operationsApplied: 0, operationsSkipped: [], aiResponse, error: aiResponse.error || "AI generation failed" };
  }
  const operations: EditOperation[] = Array.isArray(aiResponse.operations) ? aiResponse.operations : [];

  // 4. Apply the operations to the template.
  const zip = new PizZip(fetched.buffer);
  const applyResult = applyOperations(zip, operations);

  // 5. Serialize + upload.
  const outBuffer = zip.generate({ type: "nodebuffer", compression: "DEFLATE" });

  const accountName = args.inputs.clientCompanyName || "Unknown Account";
  const folder = await ensureAccountFolder(ctx, cfg.proposalsRootFolderId, accountName);
  const today = new Date().toISOString().slice(0, 10);
  const safeTitle = (args.inputs.projectTitle || "Proposal").replace(/[\/\\]+/g, " ").replace(/\s+/g, " ").trim();
  const fileName = `${today} — ${accountName} — ${safeTitle} [PROTOTYPE].docx`;
  const uploaded = await uploadProposalDocx(ctx, { folderId: folder.folderId, name: fileName, buffer: outBuffer });

  return {
    ok: true,
    driveUrl: uploaded.webViewLink,
    driveFileId: uploaded.fileId,
    fileName,
    operationsApplied: applyResult.applied,
    operationsSkipped: applyResult.skipped,
    aiResponse,
  };
}

// ─────────────────────────────────────────────────────────────────────
// AI: ask Gemini for the edit plan
// ─────────────────────────────────────────────────────────────────────

async function askGeminiForEdits(args: { templateText: string; inputs: PrototypeInputs }): Promise<any> {
  const model = await getModelForApp("brd-maker");
  if (!model) return { ok: false, error: "No AI model configured" };

  const prompt = buildPrompt(args.templateText, args.inputs);
  const result = await generateWithRetry(model, {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });
  const raw = (result?.response?.text?.() || "").trim();
  const parsed = tryParseJson(raw);
  if (!parsed) return { ok: false, error: "Couldn't parse AI output as JSON", raw };
  return { ok: true, ...parsed };
}

function buildPrompt(templateText: string, inputs: PrototypeInputs): string {
  return `You are helping generate a client proposal from a Word template. Below is the full text content of the template — read it to understand the structure, then produce a list of EDIT OPERATIONS that transform the template into a new proposal for the client described in the INPUTS section.

You MUST return ONLY valid JSON, no markdown fences, in exactly this shape:
{
  "operations": [
    { "op": "replace_paragraph", "matchText": "...", "newText": "...", "reason": "..." },
    { "op": "set_table_cell", "tableIndex": 0, "rowIndex": 1, "colIndex": 0, "newText": "...", "reason": "..." },
    { "op": "duplicate_table_row", "tableIndex": 1, "rowIndex": 1, "cellTexts": [["row 1 cell A", "row 1 cell B"], ["row 2 cell A", "row 2 cell B"]], "reason": "..." }
  ],
  "summary": "1-2 sentences on what you did"
}

OP DESCRIPTIONS:
- "replace_paragraph" — find a paragraph in the template whose text contains matchText (case-insensitive substring), replace its FULL text with newText. Use this for headings, body prose, and signoff cells with prefix labels like "Name: Wilson Ngo" → "Name: <new name>".
- "set_table_cell" — set the text at tableIndex (0-based) / rowIndex (0-based) / colIndex (0-based). Use for specific table cells.
- "duplicate_table_row" — clone the row at [tableIndex, rowIndex] for each entry in cellTexts. The ORIGINAL row is the first clone source; subsequent clones inherit its styling. Use this for tables that need multiple rows: timeline phases, cost line items, deliverables.

IMPORTANT RULES:
1. Only target text you can SEE in the template below. Don't invent table indices that don't exist.
2. NEVER touch the Confidentiality Clause, the validity section, the purple banner header, the Tarkie logo, or the closing legal sections. Those are immutable.
3. For the Version Tracking table, replace the existing single row's cells (Ver, Date, Prepared By, Submitted To, Description) with the new version's data — don't duplicate it.
4. For the Estimated Timeline table, produce REALISTIC phases. Standard Tarkie rollout: Prerequisites & Config / Development & QA / UAT/Training / Launch / Post-Launch. Adjust dates based on the project scope.
5. For the Cost / Pricing table, you may need to set cells AND duplicate rows. Look at what's there and decide.
6. For the Acceptance / Signoff table, replace the cell contents but PRESERVE the "Signature:" "Name:" "Designation:" "Date:" labels — only update the values after the colon.
7. The client company name appears multiple places (header logo area, signoff table). Update each occurrence.
8. NEVER write tool-call syntax like \`function_name({...})\` in the output. Just the JSON.

═══════════════════════════════════════════════════════════
TEMPLATE TEXT (read this carefully):
═══════════════════════════════════════════════════════════
${templateText}

═══════════════════════════════════════════════════════════
INPUTS for the new proposal:
═══════════════════════════════════════════════════════════
Client: ${inputs.clientCompanyName}
Project title: ${inputs.projectTitle}
Is addendum: ${inputs.isAddendum ? "yes" : "no"}
Prepared by: ${inputs.preparedBy}
Submitted to: ${inputs.submittedTo}

Scope description:
${inputs.scopeNotes}

Cost details:
- Standard rate: ${inputs.standardRate || "(not provided)"}
- Discounted rate: ${inputs.discountedRate || "(not provided)"}
- Current subscription rate: ${inputs.currentSubscriptionRate || "(not provided)"}
- Combined rate: ${inputs.combinedRate || "(not provided)"}
- Guaranteed users: ${inputs.guaranteedUsers || "(not provided)"}
- Total cost: ${inputs.totalCost || "(not provided)"}

Timeline guidance: ${inputs.timelineNotes || "(use standard Tarkie rollout phases)"}

Signoff:
- Client signatory: ${inputs.clientSignatoryName || "(not provided)"} / ${inputs.clientSignatoryTitle || "(not provided)"}
- MOI signatory: ${inputs.moiSignatoryName || "(not provided)"} / ${inputs.moiSignatoryTitle || "(not provided)"}
- Proposal date: ${new Date().toISOString().slice(0, 10)}

Produce the operations now. Return ONLY the JSON object.`;
}

function tryParseJson(raw: string): any | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Apply operations to the docx XML
// ─────────────────────────────────────────────────────────────────────

function applyOperations(zip: PizZip, operations: EditOperation[]): {
  applied: number;
  skipped: Array<{ op: EditOperation; reason: string }>;
} {
  const docXmlFile = zip.file("word/document.xml");
  if (!docXmlFile) {
    return { applied: 0, skipped: operations.map(op => ({ op, reason: "word/document.xml missing from zip" })) };
  }
  let xml = docXmlFile.asText();
  const skipped: Array<{ op: EditOperation; reason: string }> = [];
  let applied = 0;

  for (const op of operations) {
    try {
      if (op.op === "replace_paragraph") {
        const result = replaceParagraphText(xml, op.matchText || "", op.newText || "");
        if (result.changed) {
          xml = result.xml;
          applied++;
        } else {
          skipped.push({ op, reason: `No paragraph matched "${op.matchText}"` });
        }
      } else if (op.op === "set_table_cell") {
        const result = setTableCellText(xml, op.tableIndex ?? -1, op.rowIndex ?? -1, op.colIndex ?? -1, op.newText || "");
        if (result.changed) {
          xml = result.xml;
          applied++;
        } else {
          skipped.push({ op, reason: result.reason });
        }
      } else if (op.op === "duplicate_table_row") {
        const result = duplicateTableRow(xml, op.tableIndex ?? -1, op.rowIndex ?? -1, op.cellTexts || []);
        if (result.changed) {
          xml = result.xml;
          applied++;
        } else {
          skipped.push({ op, reason: result.reason });
        }
      } else {
        skipped.push({ op, reason: `Unknown op: ${op.op}` });
      }
    } catch (e: any) {
      skipped.push({ op, reason: `Exception: ${e?.message || e}` });
    }
  }

  zip.file("word/document.xml", xml);
  return { applied, skipped };
}

// ─────────────────────────────────────────────────────────────────────
// XML manipulation helpers — kept simple/dumb so failures are obvious
// ─────────────────────────────────────────────────────────────────────

/**
 * Find a <w:p> paragraph whose concatenated text contains matchText
 * (case-insensitive substring) and replace the whole paragraph's text. We
 * preserve the paragraph's properties + the first <w:r> run's properties
 * (font, color, bold, etc.) by reusing them around the new text.
 */
function replaceParagraphText(xml: string, matchText: string, newText: string): { xml: string; changed: boolean } {
  if (!matchText) return { xml, changed: false };
  const needle = matchText.toLowerCase().trim();

  const paragraphRe = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  let match: RegExpExecArray | null;
  while ((match = paragraphRe.exec(xml)) !== null) {
    const para = match[0];
    const text = extractTextFromParaOrCell(para).toLowerCase().trim();
    if (text.includes(needle)) {
      // Replace runs' text content with newText. We keep the FIRST run's <w:rPr>
      // (run properties) so styling is preserved, then strip subsequent runs.
      const newPara = swapParagraphRuns(para, newText);
      return { xml: xml.slice(0, match.index) + newPara + xml.slice(match.index + para.length), changed: true };
    }
  }
  return { xml, changed: false };
}

/** Extract concatenated text from a <w:p> or <w:tc> XML snippet. */
function extractTextFromParaOrCell(xmlSnippet: string): string {
  const out: string[] = [];
  const re = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xmlSnippet)) !== null) {
    out.push(decodeXml(m[1]));
  }
  return out.join("");
}

function decodeXml(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}
function encodeXml(s: string): string {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Given a <w:p>...</w:p> snippet, rebuild it so all runs are replaced by a
 * single run containing newText. The first existing run's <w:rPr> (run
 * properties) is preserved so font/style continues. The <w:pPr> (paragraph
 * properties) is preserved as-is.
 */
function swapParagraphRuns(paraXml: string, newText: string): string {
  // Capture paragraph properties block (if any)
  const pPrMatch = paraXml.match(/(<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>)/);
  const pPr = pPrMatch ? pPrMatch[1] : "";
  // Capture first run's run properties
  const rPrMatch = paraXml.match(/<w:r\b[^>]*>\s*(<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>)/);
  const rPr = rPrMatch ? rPrMatch[1] : "";
  // Find the <w:p ...> opening tag
  const openMatch = paraXml.match(/<w:p\b[^>]*>/);
  const open = openMatch ? openMatch[0] : "<w:p>";
  // Find the closing
  const close = "</w:p>";
  // Build new content
  const safeText = encodeXml(newText);
  const newRun = `<w:r>${rPr}<w:t xml:space="preserve">${safeText}</w:t></w:r>`;
  return `${open}${pPr}${newRun}${close}`;
}

/** Locate the nth <w:tbl>...</w:tbl> + return its absolute start/end. */
function locateTable(xml: string, tableIndex: number): { start: number; end: number; xml: string } | null {
  const re = /<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>/g;
  let n = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (n === tableIndex) return { start: m.index, end: m.index + m[0].length, xml: m[0] };
    n++;
  }
  return null;
}

/** Find the rowIndex-th <w:tr> within a table's xml. */
function locateRowInTable(tableXml: string, rowIndex: number): { start: number; end: number; xml: string } | null {
  const re = /<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g;
  let n = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tableXml)) !== null) {
    if (n === rowIndex) return { start: m.index, end: m.index + m[0].length, xml: m[0] };
    n++;
  }
  return null;
}

/** Find the colIndex-th <w:tc> within a row's xml. */
function locateCellInRow(rowXml: string, colIndex: number): { start: number; end: number; xml: string } | null {
  const re = /<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g;
  let n = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rowXml)) !== null) {
    if (n === colIndex) return { start: m.index, end: m.index + m[0].length, xml: m[0] };
    n++;
  }
  return null;
}

function setTableCellText(xml: string, tableIndex: number, rowIndex: number, colIndex: number, newText: string): { xml: string; changed: boolean; reason: string } {
  const table = locateTable(xml, tableIndex);
  if (!table) return { xml, changed: false, reason: `Table index ${tableIndex} not found` };
  const row = locateRowInTable(table.xml, rowIndex);
  if (!row) return { xml, changed: false, reason: `Row ${rowIndex} not found in table ${tableIndex}` };
  const cell = locateCellInRow(row.xml, colIndex);
  if (!cell) return { xml, changed: false, reason: `Cell ${colIndex} not found in row ${rowIndex} of table ${tableIndex}` };

  // Replace the cell's text content. The cell may contain one or more <w:p> blocks.
  // We rebuild it as: <w:tc> + cellProperties + a single <w:p> with the new text + </w:tc>.
  // Preserve <w:tcPr>...</w:tcPr> for cell-level formatting (borders, shading, width).
  const tcPrMatch = cell.xml.match(/(<w:tcPr\b[^>]*>[\s\S]*?<\/w:tcPr>)/);
  const tcPr = tcPrMatch ? tcPrMatch[1] : "";
  // Try to preserve a representative paragraph's pPr + first run's rPr from the existing cell.
  const firstParaMatch = cell.xml.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/);
  let pPr = "";
  let rPr = "";
  if (firstParaMatch) {
    const pPrM = firstParaMatch[0].match(/(<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>)/);
    if (pPrM) pPr = pPrM[1];
    const rPrM = firstParaMatch[0].match(/<w:r\b[^>]*>\s*(<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>)/);
    if (rPrM) rPr = rPrM[1];
  }
  const safeText = encodeXml(newText);
  const newCell = `<w:tc>${tcPr}<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${safeText}</w:t></w:r></w:p></w:tc>`;

  const newRowXml = row.xml.slice(0, cell.start) + newCell + row.xml.slice(cell.end);
  const newTableXml = table.xml.slice(0, row.start) + newRowXml + table.xml.slice(row.end);
  const newXml = xml.slice(0, table.start) + newTableXml + xml.slice(table.end);
  return { xml: newXml, changed: true, reason: "" };
}

function duplicateTableRow(xml: string, tableIndex: number, rowIndex: number, cellTexts: string[][]): { xml: string; changed: boolean; reason: string } {
  const table = locateTable(xml, tableIndex);
  if (!table) return { xml, changed: false, reason: `Table index ${tableIndex} not found` };
  const row = locateRowInTable(table.xml, rowIndex);
  if (!row) return { xml, changed: false, reason: `Row ${rowIndex} not found in table ${tableIndex}` };
  if (cellTexts.length === 0) return { xml, changed: false, reason: "No cellTexts provided" };

  // For each entry in cellTexts, clone the source row, then set each cell's text.
  const clones: string[] = [];
  for (const rowCells of cellTexts) {
    let cloneXml = row.xml;
    for (let i = 0; i < rowCells.length; i++) {
      const cell = locateCellInRow(cloneXml, i);
      if (!cell) break;
      const tcPrMatch = cell.xml.match(/(<w:tcPr\b[^>]*>[\s\S]*?<\/w:tcPr>)/);
      const tcPr = tcPrMatch ? tcPrMatch[1] : "";
      const firstParaMatch = cell.xml.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/);
      let pPr = "";
      let rPr = "";
      if (firstParaMatch) {
        const pPrM = firstParaMatch[0].match(/(<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>)/);
        if (pPrM) pPr = pPrM[1];
        const rPrM = firstParaMatch[0].match(/<w:r\b[^>]*>\s*(<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>)/);
        if (rPrM) rPr = rPrM[1];
      }
      const safeText = encodeXml(rowCells[i]);
      const newCellXml = `<w:tc>${tcPr}<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${safeText}</w:t></w:r></w:p></w:tc>`;
      cloneXml = cloneXml.slice(0, cell.start) + newCellXml + cloneXml.slice(cell.end);
    }
    clones.push(cloneXml);
  }

  // Replace the original row with the joined clones.
  const newTableXml = table.xml.slice(0, row.start) + clones.join("") + table.xml.slice(row.end);
  const newXml = xml.slice(0, table.start) + newTableXml + xml.slice(table.end);
  return { xml: newXml, changed: true, reason: "" };
}
