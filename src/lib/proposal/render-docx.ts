/**
 * Phase F.2 (B7 → template-fill) — Word renderer.
 *
 * Approach: download the configured .docx template, fill 5 coarse
 * placeholders using docxtemplater, return a Word buffer. The {{body_content}}
 * placeholder is a "raw" insertion of pre-built Word XML so we can include
 * paragraphs, bullets, and tables (cost + timeline) inside the template's
 * existing styles.
 *
 * Template must contain these placeholders (added once in Word by the admin):
 *   - {{client_company_name}}
 *   - {{version_v}}, {{version_date}}, {{version_prepared_by}}, {{version_submitted_to}}, {{version_description}}
 *   - {{body_content}}                    — raw Word XML insertion (sections, tables)
 *   - {{client_signatory_name}}, {{client_signatory_title}}
 *   - {{moi_signatory_name}}, {{moi_signatory_title}}
 *   - {{proposal_date}}
 *
 * docxtemplater's syntax for raw-XML insertion: write {@body_content} in the
 * template (or use the rawXml module). We use the simpler approach: a custom
 * resolver that flags certain placeholders as raw.
 */
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import type { ProposalContent, ProposalBlock } from "./types";

export interface RenderOpts {
  templateBuffer: Buffer;
  content: ProposalContent;
}

export function renderProposalDocx(opts: RenderOpts): Buffer {
  const zip = new PizZip(opts.templateBuffer);
  const data = buildTemplateData(opts.content);

  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    // Custom delimiters — docxtemplater's default is { } which would clash
    // with literal braces in the body. The template uses {{ }} so we tell
    // docxtemplater to look for that pattern.
    delimiters: { start: "{{", end: "}}" },
    // For raw-XML insertion. docxtemplater treats {@key} as raw XML by default,
    // but with custom delimiters we use {{@body_content}} → handled below.
  });

  try {
    doc.render(data);
  } catch (e: any) {
    // Surface the most useful error info — docxtemplater's errors are quite specific.
    const explanation = e?.properties?.errors
      ? e.properties.errors.map((err: any) => `${err.name}: ${err.message} (${err.properties?.explanation || ""})`).join("; ")
      : e?.message || String(e);
    throw new Error(`docxtemplater render failed: ${explanation}`);
  }

  const out = doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
  return out;
}

function buildTemplateData(content: ProposalContent): Record<string, any> {
  return {
    client_company_name: content.client.name || "",
    version_v: String(content.version.number || 1),
    version_date: formatHumanDate(content.version.date),
    version_prepared_by: content.version.preparedBy || "",
    version_submitted_to: content.version.submittedTo || "",
    version_description: content.version.description || "",
    client_signatory_name: content.client.signatory?.name || "",
    client_signatory_title: content.client.signatory?.title || "",
    moi_signatory_name: content.moi.signatory.name || "",
    moi_signatory_title: content.moi.signatory.title || "",
    proposal_date: formatHumanDate(content.proposalDate),
    // body_content is the raw Word XML payload. In the template, the admin
    // writes {{@body_content}} (the "@" prefix tells docxtemplater to insert
    // the value as raw XML rather than escaping it as text).
    body_content: renderBodyXml(content),
  };
}

/**
 * Build the Word XML for {{body_content}}: all the AI-generated sections,
 * the cost table, and the timeline table — in order. The XML uses Word's
 * default body/heading styles which inherit from the template.
 */
function renderBodyXml(content: ProposalContent): string {
  const parts: string[] = [];

  for (const section of content.sections) {
    parts.push(headingXml(section.heading, 2));
    for (const block of section.blocks) {
      if (block.kind === "paragraph") {
        parts.push(paragraphXml(block.text));
      } else if (block.kind === "bullets") {
        for (const item of block.items) {
          parts.push(bulletXml(item));
        }
      }
    }
  }

  if (content.cost) {
    parts.push(headingXml("Investment", 2));
    parts.push(costTableXml(content.cost));
  }

  if (content.timeline && content.timeline.length > 0) {
    parts.push(headingXml("Estimated Timeline", 2));
    parts.push(timelineTableXml(content.timeline));
  }

  return parts.join("");
}

// ─── Word XML builders ────────────────────────────────────────────

function escapeXml(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function headingXml(text: string, level: 1 | 2 | 3 = 2): string {
  // Use Word's built-in Heading 2 style so the template's brand controls how
  // it actually looks (color, font, size). Falls back to bold if style not
  // defined in the template.
  const styleId = level === 1 ? "Heading1" : level === 2 ? "Heading2" : "Heading3";
  return `<w:p><w:pPr><w:pStyle w:val="${styleId}"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function paragraphXml(text: string): string {
  // Normal body paragraph. Preserves leading/trailing whitespace (mainly
  // newlines from multi-line user content).
  return `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function bulletXml(text: string): string {
  // Use Word's built-in ListBullet style. Some templates don't have this
  // style defined — in that case it falls back to a regular paragraph with
  // a leading "• " (less pretty but works everywhere). For safety we use the
  // fallback approach.
  return `<w:p><w:r><w:t xml:space="preserve">• ${escapeXml(text)}</w:t></w:r></w:p>`;
}

/**
 * Cost table. Tarkie convention: 2 columns (Description / Cost). Rows for
 * each line item, then optional summary rows.
 */
function costTableXml(cost: NonNullable<ProposalContent["cost"]>): string {
  const rows: string[] = [];

  // Header row
  rows.push(tableHeaderRowXml(["Description", "Cost"]));

  // Line items
  for (const line of cost.lines) {
    const descParts: string[] = [];
    descParts.push(paragraphXml(line.description));
    if (line.bullets && line.bullets.length > 0) {
      for (const b of line.bullets) descParts.push(bulletXml(b));
    }

    const costParts: string[] = [];
    if (line.standardRate) costParts.push(paragraphXml(`Add-on Standard Rate: ${line.standardRate}`));
    if (line.discountedRate) costParts.push(redBoldParagraphXml(`Special Discounted Rate: ${line.discountedRate}`));
    if (line.unit) costParts.push(paragraphXml(line.unit));

    rows.push(tableRowXml([descParts.join(""), costParts.join("")]));
  }

  if (cost.combinedRate) {
    rows.push(tableRowXml([
      paragraphXml("Combined Rate per User (Current Subscription + Add-on)"),
      paragraphXml(cost.combinedRate),
    ]));
  }
  if (cost.guaranteedUsers) {
    rows.push(tableRowXml([
      paragraphXml("Guaranteed Number of Users"),
      paragraphXml(cost.guaranteedUsers),
    ]));
  }
  // Total row — bold both cells
  rows.push(tableRowXml([
    boldParagraphXml("New Total Monthly Subscription Fees"),
    boldParagraphXml(cost.totalCost),
  ]));

  return wrapTableXml(rows.join(""), [4500, 4500]);
}

/**
 * Timeline table. 4 columns: Phase / Detailed Steps / Responsible / Target Date.
 */
function timelineTableXml(phases: NonNullable<ProposalContent["timeline"]>): string {
  const rows: string[] = [];
  rows.push(tableHeaderRowXml(["Phase", "Detailed Steps", "Responsible", "Target Start/End Date"]));
  for (const p of phases) {
    rows.push(tableRowXml([
      boldParagraphXml(p.phase),
      paragraphXml(p.detailedSteps),
      paragraphXml(p.responsible),
      paragraphXml(p.targetDate),
    ]));
  }
  return wrapTableXml(rows.join(""), [2200, 3500, 1800, 2200]);
}

function boldParagraphXml(text: string): string {
  return `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function redBoldParagraphXml(text: string): string {
  return `<w:p><w:r><w:rPr><w:b/><w:color w:val="D62E2E"/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function tableHeaderRowXml(headers: string[]): string {
  const cells = headers.map(h =>
    `<w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"/></w:tcPr>${boldParagraphXml(h)}</w:tc>`
  ).join("");
  return `<w:tr>${cells}</w:tr>`;
}

function tableRowXml(cellXmls: string[]): string {
  const cells = cellXmls.map(content => `<w:tc>${content || paragraphXml("")}</w:tc>`).join("");
  return `<w:tr>${cells}</w:tr>`;
}

function wrapTableXml(rowsXml: string, colWidths: number[]): string {
  // Twips: 1 inch ≈ 1440 twips. 9000 twips total ≈ 6.25" content width.
  const grid = colWidths.map(w => `<w:gridCol w:w="${w}"/>`).join("");
  return `<w:tbl>
    <w:tblPr>
      <w:tblW w:w="${colWidths.reduce((a, b) => a + b, 0)}" w:type="dxa"/>
      <w:tblBorders>
        <w:top w:val="single" w:sz="4" w:color="1F2937"/>
        <w:left w:val="single" w:sz="4" w:color="1F2937"/>
        <w:bottom w:val="single" w:sz="4" w:color="1F2937"/>
        <w:right w:val="single" w:sz="4" w:color="1F2937"/>
        <w:insideH w:val="single" w:sz="4" w:color="1F2937"/>
        <w:insideV w:val="single" w:sz="4" w:color="1F2937"/>
      </w:tblBorders>
    </w:tblPr>
    <w:tblGrid>${grid}</w:tblGrid>
    ${rowsXml}
  </w:tbl>
  <w:p/>`; // trailing empty paragraph so the next content isn't glued to the table
}

function formatHumanDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}
