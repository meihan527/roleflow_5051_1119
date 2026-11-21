import { promises as fs } from "fs";
import path from "path";
import { headlessBrowser } from "../agent/browser";
import type { ResumeData, ResumeLanguage, ResumeTemplateId } from "../types";
import { inferResumeLanguage, resumeTemplates, resumeTitles, type ResumeSection } from "./templates";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const range = (start: string, end: string) => [start, end].filter(Boolean).join(" – ");
const hasText = (items: string[]) => items.some((item) => item.trim());

function section(title: string, body: string) {
  return body.trim() ? `<section><h2>${esc(title)}</h2>${body}</section>` : "";
}

const bullets = (items: string[]) => {
  const visible = items.filter((item) => item.trim());
  return visible.length ? `<ul>${visible.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : "";
};

const linkText = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

// ATS-friendly: single column, real text, no tables or images.
export function resumeHtml(
  r: ResumeData,
  templateId: ResumeTemplateId = "general",
  outputLanguage: ResumeLanguage = inferResumeLanguage(r),
) {
  const template = resumeTemplates[templateId];
  const titles = resumeTitles(templateId, outputLanguage);
  const contact = [
    esc(r.contact.location),
    esc(r.contact.phone),
    r.contact.email && `<a href="mailto:${esc(r.contact.email)}">${esc(r.contact.email)}</a>`,
    ...[r.contact.linkedin, r.contact.github, r.contact.website]
      .filter(Boolean)
      .map((u) => `<a href="${esc(u)}">${esc(linkText(u))}</a>`),
  ]
    .filter(Boolean)
    .join(" &nbsp;|&nbsp; ");

  const skills = r.skills
    .map((g) => ({ ...g, items: g.items.filter((item) => item.trim()) }))
    .filter((g) => g.items.length)
    .map((g) => `<p>${g.category ? `<strong>${esc(g.category)}:</strong> ` : ""}${g.items.map(esc).join(", ")}</p>`)
    .join("");
  const bodies: Record<ResumeSection, string> = {
    summary: r.summary.trim() ? `<p class="summary">${esc(r.summary)}</p>` : "",
    skills: skills ? `<div class="skills">${skills}</div>` : "",
    experience: r.experience
      .filter((e) => hasText([e.title, e.company, e.location, e.start, e.end, ...e.bullets]))
      .map(
        (e) => `<div class="item"><div class="row"><span><span class="role">${esc(e.title)}</span>${e.company ? ` · ${esc(e.company)}` : ""}</span><span class="meta">${esc(range(e.start, e.end))}</span></div>${e.location ? `<div class="sub">${esc(e.location)}</div>` : ""}${bullets(e.bullets)}</div>`,
      )
      .join(""),
    projects: r.projects
      .filter((p) => hasText([p.name, p.link, ...p.tech, ...p.bullets]))
      .map(
        (p) => `<div class="item"><div class="row"><span><span class="role">${esc(p.name)}</span>${p.tech.length ? ` <span class="sub">· ${p.tech.map(esc).join(", ")}</span>` : ""}</span>${p.link ? `<span class="meta"><a href="${esc(p.link)}">${esc(linkText(p.link))}</a></span>` : ""}</div>${bullets(p.bullets)}</div>`,
      )
      .join(""),
    education: r.education
      .filter((e) => hasText([e.school, e.degree, e.field, e.start, e.end, ...e.details]))
      .map(
        (e) => `<div class="item"><div class="row"><span><span class="role">${esc(e.school)}</span>${e.degree || e.field ? ` · ${esc([e.degree, e.field].filter(Boolean).join(", "))}` : ""}</span><span class="meta">${esc(range(e.start, e.end))}</span></div>${bullets(e.details)}</div>`,
      )
      .join(""),
    activities: (r.activities ?? [])
      .filter((a) => hasText([a.organization, a.title, a.start, a.end, ...a.bullets]))
      .map(
        (a) => `<div class="item"><div class="row"><span><span class="role">${esc(a.title)}</span>${a.organization ? ` · ${esc(a.organization)}` : ""}</span><span class="meta">${esc(range(a.start, a.end))}</span></div>${bullets(a.bullets)}</div>`,
      )
      .join(""),
    certifications: bullets(r.certifications),
    achievements: bullets(r.achievements),
  };

  return `<!doctype html><html lang="${outputLanguage}"><head><meta charset="utf-8"><title>${esc(r.name)} — ${outputLanguage === "zh" ? "简历" : "Resume"}</title><style>
  @page { size: A4; margin: 14mm 15mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Arial, Helvetica, sans-serif; color: #1d1d1b; font-size: 10.2pt; line-height: 1.38; margin: 0; }
  h1 { font-size: 21pt; margin: 0; letter-spacing: -0.01em; }
  .headline { font-size: 11pt; color: #3d5f54; margin-top: 2px; font-weight: 600; }
  .contact { margin-top: 5px; font-size: 9.2pt; color: #4a4a46; }
  a { color: inherit; text-decoration: none; }
  section { margin-top: 11px; }
  h2 { font-size: 10pt; letter-spacing: .12em; text-transform: uppercase; color: #3d5f54; border-bottom: 1px solid #cfd8d3; padding-bottom: 2px; margin: 0 0 5px; }
  .item { margin-top: 6px; break-inside: avoid; }
  .row { display: flex; justify-content: space-between; gap: 12px; }
  .role { font-weight: 650; }
  .meta { color: #5d5d58; font-size: 9.3pt; white-space: nowrap; }
  .sub { color: #4a4a46; }
  ul { margin: 3px 0 0; padding-left: 16px; }
  li { margin: 1.5px 0; }
  .skills p { margin: 2px 0; }
  .summary { margin: 0; }
</style></head><body>
<header><h1>${esc(r.name)}</h1>${r.headline ? `<div class="headline">${esc(r.headline)}</div>` : ""}<div class="contact">${contact}</div></header>
${template.sections.map((key) => section(titles[key], bodies[key])).join("\n")}
</body></html>`;
}

function coverLetterHtml(r: ResumeData, letter: string, outputLanguage: ResumeLanguage = inferResumeLanguage(r)) {
  const paras = letter.split(/\n\s*\n/).map((p) => `<p>${esc(p.trim())}</p>`).join("");
  return `<!doctype html><html lang="${outputLanguage}"><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 22mm 22mm; }
  body { font-family: "Segoe UI", Arial, sans-serif; font-size: 11pt; line-height: 1.55; color: #1d1d1b; }
  h1 { font-size: 16pt; margin: 0 0 2px; } .c { color: #555; font-size: 9.5pt; margin-bottom: 22px; } p { margin: 0 0 11px; }
</style></head><body><h1>${esc(r.name)}</h1><div class="c">${esc([r.contact.email, r.contact.phone, r.contact.location].filter(Boolean).join(" | "))}</div>${paras}</body></html>`;
}

async function htmlToPdf(html: string, outPath: string) {
  const browser = await headlessBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await page.pdf({ path: outPath, format: "A4", printBackground: true, preferCSSPageSize: true });
  } finally {
    await page.close();
  }
}

export const renderResumePdf = (
  r: ResumeData,
  outPath: string,
  templateId: ResumeTemplateId = "general",
  outputLanguage?: ResumeLanguage,
) => htmlToPdf(resumeHtml(r, templateId, outputLanguage), outPath);
export const renderCoverLetterPdf = (r: ResumeData, letter: string, outPath: string, outputLanguage?: ResumeLanguage) =>
  htmlToPdf(coverLetterHtml(r, letter, outputLanguage), outPath);
