/**
 * Phase F.2 (B7) — Tarkie-branded proposal renderer.
 *
 * Pure component (no hooks, no client APIs) so it can render both:
 *   - In-app preview on /proposal-maker/<id>
 *   - Server-side via renderToStaticMarkup for PDF export
 *
 * Style philosophy:
 *   - Branding lives entirely in this file's CSS-in-JS. To re-brand, edit here.
 *   - Tarkie purple is the primary accent. Discount-red is the only secondary accent.
 *   - Tables are full-width, with cell borders + alternating row backgrounds where helpful.
 *   - Typography: system sans-serif stack — renders cleanly in browser AND when Drive
 *     imports the HTML into a Google Doc for PDF export.
 */
import * as React from "react";
import type { ProposalContent, ProposalBlock } from "@/lib/proposal/types";

/** Tarkie brand colors — single source of truth. Update here for a rebrand. */
const TARKIE = {
  purple: "#7C73E8",
  purpleDeep: "#5A4FCC",
  discountRed: "#D62E2E",
  text: "#1F2937",
  textMuted: "#64748B",
  border: "#1F2937",
  rowBgAlt: "#F8FAFC",
  highlightBg: "#FAFAFA",
};

interface Props {
  content: ProposalContent;
  /** Toggles "aiNotes" sidebar — shown in preview, hidden in PDF export. */
  showAiNotes?: boolean;
}

export default function ProposalDocument({ content, showAiNotes = false }: Props) {
  return (
    <div style={pageWrap}>
      <style dangerouslySetInnerHTML={{ __html: globalCss }} />
      <Header content={content} />
      <Body content={content} />
      {showAiNotes && content.aiNotes && <AiNotes notes={content.aiNotes} />}
    </div>
  );
}

// ─── Header (purple banner + title block) ──────────────────────────

function Header({ content }: { content: ProposalContent }) {
  return (
    <>
      <div style={banner}>
        <div style={bannerInner}>
          <TarkieWordmark />
        </div>
      </div>

      <div style={{ padding: "32px 48px 0 48px" }}>
        <h1 style={titleStyle}>Project Proposal</h1>
        <p style={tagline}>Empowering your business with automation.</p>
        <p style={subTagline}>A Proposal For:</p>

        {/* Client name placeholder — bordered box. Team replaces with the
            client's logo manually before sending if they want. */}
        <div style={clientNameBox}>{content.client.name}</div>
      </div>
    </>
  );
}

function TarkieWordmark() {
  // Inline SVG — placeholder Tarkie wordmark. Easy to swap with the real one.
  return (
    <svg width="120" height="32" viewBox="0 0 120 32" xmlns="http://www.w3.org/2000/svg">
      <text x="0" y="24" fontFamily="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" fontSize="26" fontWeight="800" fill="white" letterSpacing="-0.5">
        tarkie<tspan fill={TARKIE.purple} style={{ filter: "brightness(2)" }}>.</tspan>
      </text>
    </svg>
  );
}

// ─── Body ──────────────────────────────────────────────────────────

function Body({ content }: { content: ProposalContent }) {
  return (
    <div style={{ padding: "32px 48px 64px 48px" }}>
      <VersionTracking content={content} />

      {content.sections.map((s, i) => (
        <Section key={i} heading={s.heading} blocks={s.blocks} />
      ))}

      {content.cost && <CostTable cost={content.cost} />}

      {content.timeline && content.timeline.length > 0 && <TimelineTable phases={content.timeline} />}

      <ConfidentialityClause />
      <ValidityClause />
      <AcceptanceTable content={content} />
    </div>
  );
}

function VersionTracking({ content }: { content: ProposalContent }) {
  const v = content.version;
  return (
    <Section heading="Version Tracking">
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Ver</th>
            <th style={thStyle}>Date Submitted</th>
            <th style={thStyle}>Prepared By</th>
            <th style={thStyle}>Submitted To</th>
            <th style={thStyle}>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={tdStyle}>{v.number}</td>
            <td style={tdStyle}>{formatDate(v.date)}</td>
            <td style={tdStyle}>{v.preparedBy}</td>
            <td style={tdStyle}>{v.submittedTo}</td>
            <td style={tdStyle}>{v.description}</td>
          </tr>
        </tbody>
      </table>
    </Section>
  );
}

function Section({ heading, blocks, children }: { heading: string; blocks?: ProposalBlock[]; children?: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <h2 style={sectionHeading}>{heading}</h2>
      {blocks?.map((block, i) => {
        if (block.kind === "bullets") {
          return (
            <ul key={i} style={bulletList}>
              {block.items.map((item, j) => <li key={j} style={bulletItem}>{item}</li>)}
            </ul>
          );
        }
        return <p key={i} style={paragraphStyle}>{block.text}</p>;
      })}
      {children}
    </div>
  );
}

// ─── Cost table — the one with red discount emphasis ───────────────

function CostTable({ cost }: { cost: NonNullable<ProposalContent["cost"]> }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <h2 style={sectionHeading}>Investment</h2>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={{ ...thStyle, width: "60%" }}>Description</th>
            <th style={thStyle}>Cost</th>
          </tr>
        </thead>
        <tbody>
          {cost.lines.map((line, i) => (
            <tr key={i}>
              <td style={tdStyle}>
                <div style={{ fontWeight: 600 }}>{line.description}</div>
                {line.bullets && line.bullets.length > 0 && (
                  <ul style={{ ...bulletList, marginTop: 8 }}>
                    {line.bullets.map((b, j) => <li key={j} style={bulletItem}>{b}</li>)}
                  </ul>
                )}
              </td>
              <td style={tdStyle}>
                {line.standardRate && (
                  <div>Add-on Standard Rate: {line.standardRate}</div>
                )}
                {line.discountedRate && (
                  <div style={{ color: TARKIE.discountRed, fontWeight: 700, marginTop: 4 }}>
                    Special Discounted Rate:<br/>{line.discountedRate}
                  </div>
                )}
                {line.unit && (
                  <div style={{ marginTop: 4 }}>{line.unit}</div>
                )}
              </td>
            </tr>
          ))}
          {cost.combinedRate && (
            <tr>
              <td style={{ ...tdStyle, fontWeight: 600 }}>Combined Rate per User (Current Subscription + Add-on)</td>
              <td style={tdStyle}>{cost.combinedRate}</td>
            </tr>
          )}
          {cost.guaranteedUsers && (
            <tr>
              <td style={{ ...tdStyle, fontWeight: 600 }}>Guaranteed Number of Users</td>
              <td style={tdStyle}>{cost.guaranteedUsers}</td>
            </tr>
          )}
          <tr>
            <td style={{ ...tdStyle, fontWeight: 700 }}>New Total Monthly Subscription Fees</td>
            <td style={{ ...tdStyle, fontWeight: 700, fontSize: 16 }}>{cost.totalCost}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── Timeline table ────────────────────────────────────────────────

function TimelineTable({ phases }: { phases: NonNullable<ProposalContent["timeline"]> }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <h2 style={sectionHeading}>Estimated Timeline</h2>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Phase</th>
            <th style={thStyle}>Detailed Steps</th>
            <th style={thStyle}>Responsible</th>
            <th style={thStyle}>Target Start/End Date</th>
          </tr>
        </thead>
        <tbody>
          {phases.map((p, i) => (
            <tr key={i} style={i % 2 === 0 ? { background: TARKIE.rowBgAlt } : undefined}>
              <td style={{ ...tdStyle, fontWeight: 700 }}>{p.phase}</td>
              <td style={tdStyle}>{p.detailedSteps}</td>
              <td style={tdStyle}>{p.responsible}</td>
              <td style={tdStyle}>{p.targetDate}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Fixed legal sections ──────────────────────────────────────────

function ConfidentialityClause() {
  return (
    <Section heading="Confidentiality Clause">
      <p style={paragraphStyle}>
        The material contained in this proposal represents proprietary and confidential information pertaining to MobileOptima, Inc. (MOI) products, services and methods. By accepting this proposal, Client hereby agrees that information in this proposal shall not be disclosed outside of the Client and shall not be duplicated, used, or disclosed for any purpose other than to evaluate this proposal. If, however, a contract is awarded to MOI for this proposal as a result of, or in conjunction with, the submission of this information, Client will have the right to duplicate, use or disclose the material contained herein to the extent provided for in the resulting contract.
      </p>
    </Section>
  );
}

function ValidityClause() {
  return (
    <Section heading="Validity">
      <p style={paragraphStyle}>
        This proposal is valid for thirty (30) days from the date of submission. Pricing and timelines beyond that date may be subject to revision based on then-current rates and engagement availability.
      </p>
    </Section>
  );
}

// ─── Acceptance / Signoff table ────────────────────────────────────

function AcceptanceTable({ content }: { content: ProposalContent }) {
  return (
    <div style={{ marginTop: 32 }}>
      <h2 style={sectionHeading}>Acceptance</h2>
      <p style={paragraphStyle}>
        This will serve as a conforme for MobileOptima, Inc. to bill the amount stated above for services rendered to Client.
      </p>
      <table style={{ ...tableStyle, marginTop: 12 }}>
        <tbody>
          <tr>
            <td style={{ ...tdStyle, fontWeight: 700, width: "50%" }}>{content.client.name}</td>
            <td style={{ ...tdStyle, fontWeight: 700 }}>MobileOptima Inc.</td>
          </tr>
          <tr>
            <td style={{ ...tdStyle, height: 56 }}>Signature:</td>
            <td style={{ ...tdStyle, height: 56 }}>Signature:</td>
          </tr>
          <tr>
            <td style={tdStyle}>Name: {content.client.signatory?.name || ""}</td>
            <td style={tdStyle}>Name: {content.moi.signatory.name}</td>
          </tr>
          <tr>
            <td style={tdStyle}>Designation: {content.client.signatory?.title || ""}</td>
            <td style={tdStyle}>Designation: {content.moi.signatory.title}</td>
          </tr>
          <tr>
            <td style={tdStyle}>Date:</td>
            <td style={tdStyle}>Date: {formatDate(content.proposalDate)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── AI notes sidebar (preview-only) ───────────────────────────────

function AiNotes({ notes }: { notes: NonNullable<ProposalContent["aiNotes"]> }) {
  return (
    <div style={{ padding: "16px 48px 32px 48px", background: TARKIE.highlightBg }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, color: TARKIE.textMuted, marginBottom: 8 }}>
        AI NOTES (NOT EXPORTED TO PDF)
      </div>
      {notes.summary && <p style={{ ...paragraphStyle, fontStyle: "italic" }}>{notes.summary}</p>}
      {notes.inferred.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, marginTop: 8 }}>What I inferred:</div>
          <ul style={bulletList}>
            {notes.inferred.map((s, i) => <li key={i} style={bulletItem}>{s}</li>)}
          </ul>
        </>
      )}
      {notes.missing.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, marginTop: 8, color: TARKIE.discountRed }}>What's missing:</div>
          <ul style={bulletList}>
            {notes.missing.map((s, i) => <li key={i} style={{ ...bulletItem, color: TARKIE.discountRed }}>{s}</li>)}
          </ul>
        </>
      )}
    </div>
  );
}

// ─── Utility ──────────────────────────────────────────────────────

function formatDate(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  } catch { return iso; }
}

// ─── Inline styles ────────────────────────────────────────────────

const pageWrap: React.CSSProperties = {
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  color: TARKIE.text,
  fontSize: 13,
  lineHeight: 1.55,
  background: "white",
  maxWidth: 850,
  margin: "0 auto",
};

const banner: React.CSSProperties = {
  background: `linear-gradient(135deg, ${TARKIE.purple} 0%, ${TARKIE.purpleDeep} 100%)`,
  padding: "24px 48px",
};
const bannerInner: React.CSSProperties = { display: "flex", alignItems: "center" };

const titleStyle: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 800,
  margin: "12px 0 4px 0",
};
const tagline: React.CSSProperties = {
  fontSize: 13,
  color: TARKIE.textMuted,
  margin: "0 0 24px 0",
};
const subTagline: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  margin: "0 0 8px 0",
};

const clientNameBox: React.CSSProperties = {
  border: `1px dashed ${TARKIE.textMuted}`,
  padding: "16px 24px",
  textAlign: "center",
  fontSize: 18,
  fontWeight: 700,
  marginBottom: 8,
  background: TARKIE.highlightBg,
};

const sectionHeading: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 800,
  marginTop: 24,
  marginBottom: 12,
  borderBottom: `2px solid ${TARKIE.purple}`,
  paddingBottom: 4,
};

const paragraphStyle: React.CSSProperties = {
  margin: "0 0 12px 0",
  fontSize: 13,
  lineHeight: 1.6,
};

const bulletList: React.CSSProperties = {
  margin: "0 0 12px 0",
  paddingLeft: 20,
};
const bulletItem: React.CSSProperties = {
  marginBottom: 4,
  fontSize: 13,
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  margin: "8px 0 16px 0",
  fontSize: 12.5,
};
const thStyle: React.CSSProperties = {
  border: `1px solid ${TARKIE.border}`,
  padding: "8px 12px",
  textAlign: "left",
  background: "white",
  fontWeight: 800,
  fontSize: 11,
  letterSpacing: 0.5,
  textTransform: "uppercase",
};
const tdStyle: React.CSSProperties = {
  border: `1px solid ${TARKIE.border}`,
  padding: "8px 12px",
  verticalAlign: "top",
};

const globalCss = `
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
`;
