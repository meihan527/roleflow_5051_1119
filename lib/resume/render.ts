import { promises as fs } from "fs";
import path from "path";
import { headlessBrowser } from "../agent/browser";
import type { ResumeData } from "../types";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const range = (start: string, end: string) => [start, end].filter(Boolean).join(" – ");

function section(title: string, body: string) {
  return body.trim() ? `<section><h2>${title}</h2>${body}</section>` : "";
}

const bullets = (items: string[]) =>
  items.length ? `<ul>${items.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : "";

const linkText = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

// ATS-friendly: single column, real text, no tables or images.
export function resumeHtml(r: ResumeData, language?: "en" | "zh-CN") {
  const chinese = language ? language === "zh-CN" : /\p{Script=Han}/u.test(JSON.stringify(r));
  const titles = chinese
    ? { summary: "个人简介", skills: "专业技能", experience: "工作与实习经历", projects: "项目经历", education: "教育经历", certifications: "资格证书", achievements: "荣誉与成果" }
    : { summary: "Summary", skills: "Skills", experience: "Experience", projects: "Projects", education: "Education", certifications: "Certifications", achievements: "Achievements" };
  const contact = [
    r.contact.location,
    r.contact.phone,
    r.contact.email && `<a href="mailto:${esc(r.contact.email)}">${esc(r.contact.email)}</a>`,
    ...[r.contact.linkedin, r.contact.github, r.contact.website]
      .filter(Boolean)
      .map((u) => `<a href="${esc(u)}">${esc(linkText(u))}</a>`),
  ]
    .filter(Boolean)
    .map((x) => (x!.startsWith("<a") ? x : esc(x!)))
    .join(" &nbsp;|&nbsp; ");

  return `<!doctype html><html lang="${chinese ? "zh-CN" : "en"}"><head><meta charset="utf-8"><title>${esc(r.name)} — ${chinese ? "简历" : "Resume"}</title><style>
  @page { size: A4; margin: 14mm 15mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", Arial, sans-serif; color: #1d1d1b; font-size: 10.2pt; line-height: 1.48; margin: 0; overflow-wrap: anywhere; }
  h1 { font-size: 21pt; margin: 0; letter-spacing: -0.01em; }
  .headline { font-size: 11pt; color: #3d5f54; margin-top: 2px; font-weight: 600; }
  .contact { margin-top: 5px; font-size: 9.2pt; color: #4a4a46; }
  a { color: inherit; text-decoration: none; }
  section { margin-top: 11px; }
  h2 { font-size: 10pt; letter-spacing: ${chinese ? ".04em" : ".12em"}; text-transform: uppercase; color: #3d5f54; border-bottom: 1px solid #cfd8d3; padding-bottom: 2px; margin: 0 0 5px; }
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
${section(titles.summary, r.summary ? `<p class="summary">${esc(r.summary)}</p>` : "")}
${section(
  titles.skills,
  `<div class="skills">${r.skills
    .map((g) => `<p>${g.category ? `<strong>${esc(g.category)}:</strong> ` : ""}${g.items.map(esc).join(", ")}</p>`)
    .join("")}</div>`,
)}
${section(
  titles.experience,
  r.experience
    .map(
      (e) => `<div class="item"><div class="row"><span><span class="role">${esc(e.title)}</span>${e.company ? ` · ${esc(e.company)}` : ""}</span><span class="meta">${esc(range(e.start, e.end))}</span></div>${e.location ? `<div class="sub">${esc(e.location)}</div>` : ""}${bullets(e.bullets)}</div>`,
    )
    .join(""),
)}
${section(
  titles.projects,
  r.projects
    .map(
      (p) => `<div class="item"><div class="row"><span><span class="role">${esc(p.name)}</span>${p.tech.length ? ` <span class="sub">· ${p.tech.map(esc).join(", ")}</span>` : ""}</span>${p.link ? `<span class="meta"><a href="${esc(p.link)}">${esc(linkText(p.link))}</a></span>` : ""}</div>${bullets(p.bullets)}</div>`,
    )
    .join(""),
)}
${section(
  titles.education,
  r.education
    .map(
      (e) => `<div class="item"><div class="row"><span><span class="role">${esc(e.school)}</span>${e.degree || e.field ? ` · ${esc([e.degree, e.field].filter(Boolean).join(", "))}` : ""}</span><span class="meta">${esc(range(e.start, e.end))}</span></div>${bullets(e.details)}</div>`,
    )
    .join(""),
)}
${section(titles.certifications, bullets(r.certifications))}
${section(titles.achievements, bullets(r.achievements))}
</body></html>`;
}

function coverLetterHtml(r: ResumeData, letter: string, language?: "en" | "zh-CN") {
  const paras = letter.split(/\n\s*\n/).map((p) => `<p>${esc(p.trim())}</p>`).join("");
  return `<!doctype html><html${language ? ` lang="${language}"` : ""}><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 22mm 22mm; }
  body { font-family: "Segoe UI", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", Arial, sans-serif; font-size: 11pt; line-height: 1.55; color: #1d1d1b; overflow-wrap: anywhere; }
  h1 { font-size: 16pt; margin: 0 0 2px; } .c { color: #555; font-size: 9.5pt; margin-bottom: 22px; } p { margin: 0 0 11px; }
</style></head><body><h1>${esc(r.name)}</h1><div class="c">${esc([r.contact.email, r.contact.phone, r.contact.location].filter(Boolean).join(" | "))}</div>${paras}</body></html>`;
}

async function htmlToPdf(html: string, outPath: string) {
  const browser = await headlessBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await page.pdf({ path: outPath, format: "A4", printBackground: true, preferCSSPageSize: true });
  } finally {
    await page.close();
  }
}

export const renderResumePdf = (r: ResumeData, outPath: string, language?: "en" | "zh-CN") => htmlToPdf(resumeHtml(r, language), outPath);
export const renderCoverLetterPdf = (r: ResumeData, letter: string, outPath: string, language?: "en" | "zh-CN") =>
  htmlToPdf(coverLetterHtml(r, letter, language), outPath);
