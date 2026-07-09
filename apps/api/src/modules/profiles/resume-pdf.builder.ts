import PDFDocument from 'pdfkit';
import { ResumeEducationEntry, ResumeExperienceEntry } from '../../llm/llm.service';

export interface VerifiedSkillEntry {
  skillName: string;
  level: string;
  verifyUrl: string;
}

export interface ResumePdfInput {
  fullName: string;
  headline: string | null;
  location: string | null;
  yearsOfExp: number | null;
  githubUrl: string | null;
  linkedinUrl: string | null;
  summary?: string;
  experience?: ResumeExperienceEntry[];
  education?: ResumeEducationEntry[];
  skills?: string[];
  /** Only currently-valid (VERIFIED, non-revoked) badges — never an invalidated one. */
  verifiedSkills: VerifiedSkillEntry[];
}

const INK = '#141b2d';
const INK_MUTED = '#5b6270';
const VERIFIED_GREEN = '#0b8a5c';
const INDIGO = '#3240b8';

/**
 * Builds a one-page-target PDF resume with pdfkit (see ProfilesService for
 * why pdfkit over puppeteer). Pure layout code, no I/O — takes already-
 * assembled data (profile fields + optional improved content + verified
 * badges) and streams a Buffer. pdfkit paginates naturally if content
 * genuinely doesn't fit one page; nothing here truncates real content to
 * force a fit.
 */
export function buildResumePdf(input: ResumePdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 50, left: 56, right: 56 } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    renderHeader(doc, input);
    if (input.summary) renderSummary(doc, input.summary);
    if (input.experience?.length) renderExperience(doc, input.experience);
    if (input.education?.length) renderEducation(doc, input.education);
    if (input.skills?.length) renderSkills(doc, input.skills);
    renderVerifiedSkills(doc, input.verifiedSkills);
    renderFooterMark(doc);

    doc.end();
  });
}

function renderHeader(doc: PDFKit.PDFDocument, input: ResumePdfInput) {
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(22).text(input.fullName);
  if (input.headline) {
    doc.moveDown(0.2).fillColor(INK_MUTED).font('Helvetica').fontSize(12).text(input.headline);
  }

  const metaParts = [
    input.location,
    input.yearsOfExp != null ? `${input.yearsOfExp} yrs experience` : null,
    input.githubUrl,
    input.linkedinUrl,
  ].filter((v): v is string => !!v);
  if (metaParts.length > 0) {
    doc.moveDown(0.3).fillColor(INK_MUTED).fontSize(9.5).text(metaParts.join('   ·   '));
  }

  doc.moveDown(0.8);
  ruler(doc);
  doc.moveDown(0.6);
}

function renderSummary(doc: PDFKit.PDFDocument, summary: string) {
  sectionHeading(doc, 'Summary');
  doc.fillColor(INK).font('Helvetica').fontSize(10).text(summary, { lineGap: 2 });
  doc.moveDown(0.8);
}

function renderExperience(doc: PDFKit.PDFDocument, experience: ResumeExperienceEntry[]) {
  sectionHeading(doc, 'Experience');
  for (const entry of experience) {
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(10.5).text(`${entry.title} — ${entry.company}`, {
      continued: false,
    });
    doc.fillColor(INK_MUTED).font('Helvetica').fontSize(9).text(entry.dates);
    doc.moveDown(0.2);
    for (const bullet of entry.bullets) {
      doc.fillColor(INK).font('Helvetica').fontSize(9.5).text(`•  ${bullet}`, {
        indent: 10,
        lineGap: 1,
      });
    }
    doc.moveDown(0.5);
  }
}

function renderEducation(doc: PDFKit.PDFDocument, education: ResumeEducationEntry[]) {
  sectionHeading(doc, 'Education');
  for (const entry of education) {
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text(`${entry.degree} — ${entry.institution}`);
    doc.fillColor(INK_MUTED).font('Helvetica').fontSize(9).text(entry.dates);
    doc.moveDown(0.4);
  }
}

function renderSkills(doc: PDFKit.PDFDocument, skills: string[]) {
  sectionHeading(doc, 'Skills');
  doc.fillColor(INK).font('Helvetica').fontSize(9.5).text(skills.join('  ·  '), { lineGap: 2 });
  doc.moveDown(0.8);
}

/**
 * The section a hiring manager can actually click through on — every entry
 * links straight to the public /badges/verify/:hash page so a claimed skill
 * can be independently confirmed, not just taken on faith from the PDF text.
 */
function renderVerifiedSkills(doc: PDFKit.PDFDocument, verifiedSkills: VerifiedSkillEntry[]) {
  if (verifiedSkills.length === 0) return;

  sectionHeading(doc, 'Verified Skills', VERIFIED_GREEN);
  doc.fillColor(INK_MUTED).font('Helvetica').fontSize(8.5).text(
    'Each skill below was independently verified via a proctored SkillProof assessment. Click through to confirm.',
  );
  doc.moveDown(0.3);

  for (const entry of verifiedSkills) {
    // No checkmark glyph — Helvetica's WinAnsi encoding doesn't include one
    // and silently substitutes a stray character. The green "Verified
    // Skills" heading + this bold label already carry the meaning.
    const label = `${entry.skillName} — Level ${entry.level} (Verified)`;
    const y = doc.y;
    doc.fillColor(VERIFIED_GREEN).font('Helvetica-Bold').fontSize(9.5).text(label, { continued: false });
    doc
      .fillColor(INDIGO)
      .font('Helvetica')
      .fontSize(8.5)
      .text(entry.verifyUrl, { link: entry.verifyUrl, underline: true });
    // Make the whole label line clickable too, not just the URL text below it.
    doc.link(doc.page.margins.left, y, doc.page.width - doc.page.margins.left - doc.page.margins.right, 14, entry.verifyUrl);
    doc.moveDown(0.4);
  }
  doc.moveDown(0.4);
}

function renderFooterMark(doc: PDFKit.PDFDocument) {
  doc.moveDown(0.4);
  ruler(doc);
  doc.moveDown(0.4);
  doc
    .fillColor(VERIFIED_GREEN)
    .font('Helvetica-Bold')
    .fontSize(9)
    .text('Verified by SkillProof', { align: 'center' });
  doc
    .fillColor(INK_MUTED)
    .font('Helvetica')
    .fontSize(7.5)
    .text('Skills marked "Verified" above were independently assessed — not self-reported.', {
      align: 'center',
    });
}

function sectionHeading(doc: PDFKit.PDFDocument, title: string, color = INDIGO) {
  doc
    .fillColor(color)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text(title.toUpperCase(), { characterSpacing: 0.5 });
  doc.moveDown(0.3);
}

function ruler(doc: PDFKit.PDFDocument) {
  const y = doc.y;
  doc
    .moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .strokeColor('#d8dae0')
    .lineWidth(0.75)
    .stroke();
}
