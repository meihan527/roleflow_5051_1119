import { expect, test } from "@playwright/test";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { extractText, getDocumentProxy } from "unpdf";
import { headlessBrowser } from "../lib/agent/browser";
import { renderCoverLetterPdf, renderResumePdf, resumeHtml } from "../lib/resume/render";
import { inferResumeLanguage, resumeTemplates, resumeTitles, templateInstructions, type ResumeSection } from "../lib/resume/templates";
import type { ResumeData, ResumeLanguage, ResumeTemplateId } from "../lib/types";

const languages: ResumeLanguage[] = ["zh", "en"];
const templateIds: ResumeTemplateId[] = ["general", "state-owned", "big-tech", "multinational"];
const expectedSectionOrder: Record<ResumeTemplateId, ResumeSection[]> = {
  general: ["summary", "skills", "experience", "projects", "education", "activities", "certifications", "achievements"],
  "state-owned": ["education", "experience", "projects", "activities", "achievements", "certifications", "skills"],
  "big-tech": ["education", "experience", "projects", "skills", "achievements", "certifications", "activities"],
  multinational: ["summary", "education", "experience", "projects", "skills", "activities", "achievements", "certifications"],
};

const expectedTitles: Record<ResumeLanguage, Record<ResumeSection, string>> = {
  zh: {
    summary: "个人概述", skills: "核心技能", experience: "实习与工作经历", projects: "项目经历",
    education: "教育背景", activities: "校园与志愿经历", certifications: "资格证书", achievements: "荣誉奖项",
  },
  en: {
    summary: "Summary", skills: "Skills", experience: "Experience", projects: "Projects",
    education: "Education", activities: "Campus & Volunteer Experience", certifications: "Certifications", achievements: "Achievements",
  },
};

function titlesFor(templateId: ResumeTemplateId, language: ResumeLanguage) {
  return language === "en" && templateId === "multinational"
    ? { ...expectedTitles.en, experience: "Internship & Work Experience", projects: "Relevant Projects", skills: "Skills & Languages" }
    : expectedTitles[language];
}

function fullResume(): ResumeData {
  return {
    name: "虚构候选人",
    headline: "软件工程师 / Fictional Engineer",
    contact: {
      email: "fictional@example.test",
      phone: "000-0000-0000",
      location: "示例城市",
      linkedin: "https://example.test/linkedin",
      github: "https://example.test/github",
      website: "https://www.example.test/",
    },
    summary: "具备端到端交付与协作能力，仅用于测试。",
    skills: [{ category: "工具", items: ["TypeScript", "自动化测试"] }],
    experience: [{
      title: "工程实习生", company: "虚构软件工作室", location: "示例园区",
      start: "2024.01", end: "2024.06", bullets: ["实现离线数据校验，减少重复操作。"],
    }],
    projects: [{
      name: "星河演示系统", tech: ["Node.js", "SQLite"], link: "https://example.test/project",
      bullets: ["完成可复现的查询性能实验。"],
    }],
    education: [{
      school: "虚构理工学院", degree: "本科", field: "计算机科学",
      start: "2020.09", end: "2024.06", details: ["完成分布式系统课程设计。"],
    }],
    activities: [{
      organization: "虚构开源社团", title: "志愿协调员", start: "2022.09", end: "2023.06",
      bullets: ["组织校园技术分享与志愿服务。"],
    }],
    certifications: ["示例软件资格证书"],
    achievements: ["虚构创新挑战赛优胜奖"],
  };
}

function englishResume(): ResumeData {
  // Deliberately keep the Chinese name and contact location: they are not language evidence.
  return {
    ...fullResume(),
    headline: "Software Engineer",
    summary: "Delivered reliable software through documented team collaboration.",
    skills: [{ category: "Tools", items: ["TypeScript", "Automated testing"] }],
    experience: [{
      title: "Engineering Intern", company: "Fictional Software Studio", location: "Example Park",
      start: "2024.01", end: "2024.06", bullets: ["Implemented offline validation to reduce repetitive steps."],
    }],
    projects: [{
      name: "Example Demo System", tech: ["Node.js", "SQLite"], link: "https://example.test/project",
      bullets: ["Completed reproducible query performance experiments."],
    }],
    education: [{
      school: "Fictional Technical College", degree: "Bachelor", field: "Computer Science",
      start: "2020.09", end: "2024.06", details: ["Completed distributed systems coursework."],
    }],
    activities: [{
      organization: "Fictional Open Source Club", title: "Volunteer Coordinator", start: "2022.09", end: "2023.06",
      bullets: ["Organized campus technical talks and volunteer service."],
    }],
    certifications: ["Example software certificate"],
    achievements: ["Fictional innovation challenge award"],
  };
}

function emptyResume(): ResumeData {
  return {
    ...fullResume(), headline: "", summary: "", skills: [], experience: [], projects: [],
    education: [], activities: [], certifications: [], achievements: [],
  };
}

const englishBodyMarkers: Record<ResumeSection, string> = {
  summary: "Delivered reliable software through documented team collaboration.",
  skills: "Automated testing",
  experience: "Implemented offline validation to reduce repetitive steps.",
  projects: "Completed reproducible query performance experiments.",
  education: "Completed distributed systems coursework.",
  activities: "Organized campus technical talks and volunteer service.",
  certifications: "Example software certificate",
  achievements: "Fictional innovation challenge award",
};

const bodyMarkers: Record<ResumeSection, string> = {
  summary: "具备端到端交付与协作能力，仅用于测试。",
  skills: "自动化测试",
  experience: "实现离线数据校验，减少重复操作。",
  projects: "完成可复现的查询性能实验。",
  education: "完成分布式系统课程设计。",
  activities: "组织校园技术分享与志愿服务。",
  certifications: "示例软件资格证书",
  achievements: "虚构创新挑战赛优胜奖",
};

// Keep the original visual rules verbatim, not a snapshot generated by the renderer.
const originalCss = `
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
`;

// Font fallback may extract compatibility radicals (e.g. ⼈ for 人) in English-language PDFs.
const normalizePdfText = (text: string) => text.normalize("NFKC").replace(/\s+/g, "").toUpperCase();

function expectPdfOrder(
  text: string,
  templateId: ResumeTemplateId,
  outputLanguage: ResumeLanguage,
  sourceLanguage: ResumeLanguage = outputLanguage,
) {
  const titles = titlesFor(templateId, outputLanguage);
  const markers = sourceLanguage === "zh" ? bodyMarkers : englishBodyMarkers;
  const normalized = normalizePdfText(text);
  expect(normalized).toContain("虚构候选人");
  let cursor = 0;
  for (const key of expectedSectionOrder[templateId]) {
    for (const value of [titles[key], markers[key]]) {
      const needle = normalizePdfText(value);
      const index = normalized.indexOf(needle, cursor);
      expect(index, `${templateId}/${outputLanguage}: missing or out-of-order PDF text ${value}\nExtracted: ${text}`)
        .toBeGreaterThanOrEqual(cursor);
      cursor = index + needle.length;
    }
  }
}

async function pdfText(buffer: Uint8Array) {
  const document = await getDocumentProxy(new Uint8Array(buffer));
  try {
    const firstPage = await document.getPage(1);
    const viewport = firstPage.getViewport({ scale: 1 });
    expect(Math.abs(viewport.width - 595.28)).toBeLessThan(1);
    expect(Math.abs(viewport.height - 841.89)).toBeLessThan(1);
    return (await extractText(document, { mergePages: true })).text;
  } finally {
    await document.loadingTask.destroy();
  }
}

for (const templateId of templateIds) {
  for (const outputLanguage of languages) {
    test(`${templateId}/${outputLanguage}: configured order, heading language, original body and header`, async ({ page }) => {
      const resume = fullResume();
      const before = structuredClone(resume);
      const sections = expectedSectionOrder[templateId];
      const titles = titlesFor(templateId, outputLanguage);
      expect(resumeTemplates[templateId].sections).toEqual(sections);
      expect(resumeTitles(templateId, outputLanguage)).toEqual(titles);

      // English headings must not translate this Chinese fixture's body or identities.
      await page.setContent(resumeHtml(resume, templateId, outputLanguage));
      await expect(page.locator("html")).toHaveAttribute("lang", outputLanguage);
      await expect(page).toHaveTitle(`${resume.name} — ${outputLanguage === "zh" ? "简历" : "Resume"}`);
      await expect(page.locator("section > h2")).toHaveText(sections.map((key) => titles[key]));
      for (const [index, key] of sections.entries()) {
        await expect(page.locator("section").nth(index)).toContainText(bodyMarkers[key]);
      }
      const activity = page.locator("section").nth(sections.indexOf("activities"));
      await expect(activity.locator(".role")).toHaveText("志愿协调员");
      await expect(activity).toContainText("虚构开源社团");
      await expect(activity.locator(".meta")).toHaveText("2022.09 – 2023.06");
      await expect(activity.locator("li")).toHaveText([bodyMarkers.activities]);
      if (!sections.includes("summary")) await expect(page.locator(".summary")).toHaveCount(0);
      await expect(page.locator("header h1")).toHaveText(resume.name);
      await expect(page.locator("header .headline")).toHaveText(resume.headline);
      await expect(page.locator("header .contact")).toContainText("示例城市");
      await expect(page.locator("header .contact")).toContainText("000-0000-0000");
      await expect(page.locator("header a")).toHaveText([
        "fictional@example.test", "example.test/linkedin", "example.test/github", "example.test",
      ]);
      await expect(page.locator("header a").first()).toHaveAttribute("href", "mailto:fictional@example.test");
      expect(resume).toEqual(before);
    });

    test(`${templateId}/${outputLanguage}: each empty section disappears without disturbing the others`, async ({ page }) => {
      const sections = expectedSectionOrder[templateId];
      const titles = titlesFor(templateId, outputLanguage);
      for (const key of sections) {
        const resume = { ...fullResume(), [key]: key === "summary" ? "" : [] };
        await page.setContent(resumeHtml(resume, templateId, outputLanguage));
        await expect(page.locator("section > h2")).toHaveText(
          sections.filter((section) => section !== key).map((section) => titles[section]),
        );
      }
    });

    test(`${templateId}/${outputLanguage}: old JSON without activities still renders`, async ({ page }) => {
      const resume = fullResume();
      delete resume.activities;
      const oldJson: ResumeData = JSON.parse(JSON.stringify(resume));
      const titles = titlesFor(templateId, outputLanguage);
      expect(inferResumeLanguage(oldJson)).toBe("zh");
      await page.setContent(resumeHtml(oldJson, templateId, outputLanguage));
      await expect(page.locator("section > h2")).toHaveText(
        expectedSectionOrder[templateId].filter((key) => key !== "activities").map((key) => titles[key]),
      );
      await expect(page.locator("header h1")).toHaveText(resume.name);
    });

    test(`${templateId}/${outputLanguage}: real browser PDF preserves content and section order`, async ({ page }) => {
      const resume = outputLanguage === "zh" ? fullResume() : englishResume();
      await page.setContent(resumeHtml(resume, templateId, outputLanguage), { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      const buffer = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
      expectPdfOrder(await pdfText(buffer), templateId, outputLanguage);
    });

    test(`${templateId}/${outputLanguage}: default heading language follows the source, not the template`, async ({ page }) => {
      const resume = outputLanguage === "zh" ? fullResume() : englishResume();
      expect(inferResumeLanguage(resume)).toBe(outputLanguage);
      expect(resumeHtml(resume, templateId)).toBe(resumeHtml(resume, templateId, outputLanguage));
      await page.setContent(resumeHtml(resume, templateId));
      await expect(page.locator("html")).toHaveAttribute("lang", outputLanguage);
      await expect(page.locator("section > h2")).toHaveText(
        expectedSectionOrder[templateId].map((key) => titlesFor(templateId, outputLanguage)[key]),
      );
    });
  }
}

test("general remains the default and all templates retain every original CSS rule in both languages", () => {
  const resume = fullResume();
  expect(resumeHtml(resume)).toBe(resumeHtml(resume, "general"));
  for (const templateId of templateIds) {
    for (const outputLanguage of languages) {
      const html = resumeHtml(resume, templateId, outputLanguage);
      expect(html.match(/<style>([\s\S]*?)<\/style>/)?.[1]).toBe(originalCss);
    }
  }
});

test("template metadata stays intact and shared instructions require an original-language rewrite before translation", () => {
  const labels = { general: "通用", "state-owned": "央国企", "big-tech": "大厂", multinational: "外企" };
  for (const templateId of templateIds) {
    const template = resumeTemplates[templateId];
    const metadataLanguage = templateId === "state-owned" || templateId === "big-tech" ? "zh" : "en";
    expect(template.label).toBe(labels[templateId]);
    expect(template.titles).toEqual(titlesFor(templateId, metadataLanguage));
    const instructions = templateInstructions(templateId);
    expect(instructions).toContain(template.instructions);
    expect(instructions).toContain("Rewrite in the ORIGINAL source resume's language, including headline, summary and all bullets.");
    expect(instructions).toContain("Neither template headings nor JD language determines the rewrite language.");
    expect(instructions).toContain("Preserve exact role titles and organization identities from the source");
    expect(instructions).toContain("Output-language translation happens in a separate, later stage.");
    expect(instructions).not.toContain("如果内容为英文，翻译为中文。");
    expect(instructions).not.toContain("If the content is in Chinese, translate it to English.");
  }
});

test("language inference uses narrative evidence, ignoring name, contact and isolated Han characters", () => {
  const english = englishResume();
  english.name = "虚构候选人姓名".repeat(50);
  english.contact.location = "虚构联系地址".repeat(50);
  english.experience[0].company = "虚构软件工作室".repeat(50);
  english.summary += " Worked with 李 on a documented validation task.";
  const before = structuredClone(english);
  expect(inferResumeLanguage(english)).toBe("en");
  expect(english).toEqual(before);

  const chinese = fullResume();
  chinese.name = "Fictional Candidate ".repeat(50);
  chinese.contact.location = "Example City ".repeat(50);
  chinese.headline = "";
  chinese.summary = "使用 TypeScript、JavaScript、PostgreSQL 和 Playwright 实现离线校验，完成复现实验。";
  chinese.skills = [{ category: "Tools", items: Array(100).fill("TypeScript JavaScript PostgreSQL Playwright") }];
  expect(inferResumeLanguage(chinese)).toBe("zh");
  expect(inferResumeLanguage({ ...emptyResume(), summary: "中" })).toBe("en");
  expect(inferResumeLanguage({ ...emptyResume(), summary: "1234 / --" })).toBe("en");
  expect(inferResumeLanguage(emptyResume())).toBe("en");
  const legacy = emptyResume();
  delete legacy.activities;
  expect(inferResumeLanguage(legacy)).toBe("en");
});

test("language inference recognizes sparse narrative sections and falls back to roles or qualifications", () => {
  for (const language of languages) {
    const source = language === "zh" ? fullResume() : englishResume();
    for (const key of ["headline", "summary", "experience", "projects", "education", "activities", "certifications", "achievements"] as const) {
      expect(inferResumeLanguage({ ...emptyResume(), [key]: source[key] }), `${language}/${key}`).toBe(language);
    }
  }
  const roleOnly = {
    ...emptyResume(),
    experience: [{ title: "软件工程实习生", company: "Example Studio", location: "", start: "", end: "", bullets: [] }],
  };
  expect(inferResumeLanguage(roleOnly)).toBe("zh");
  expect(inferResumeLanguage({ ...emptyResume(), skills: [{ category: "技术技能", items: ["TypeScript"] }] })).toBe("zh");
  expect(inferResumeLanguage({ ...emptyResume(), skills: [{ category: "Tools", items: ["TypeScript"] }] })).toBe("en");
});

test("empty arrays and whitespace-only placeholder records never create empty headings", async ({ page }) => {
  const empty = emptyResume();
  const whitespace: ResumeData = {
    ...empty,
    summary: " \n\t ",
    skills: [{ category: "Empty category", items: [] }, { category: " ", items: ["", " \t"] }],
    experience: [{ title: " ", company: "", location: "", start: "", end: "", bullets: [" "] }],
    projects: [{ name: " ", tech: [" "], link: "", bullets: ["\t"] }],
    education: [{ school: " ", degree: "", field: "", start: "", end: "", details: [" "] }],
    activities: [{ organization: " ", title: "", start: "", end: "", bullets: ["\n"] }],
    certifications: ["", " "], achievements: ["\n", "\t"],
  };
  for (const templateId of templateIds) {
    for (const resume of [empty, whitespace]) {
      for (const outputLanguage of languages) {
        await page.setContent(resumeHtml(resume, templateId, outputLanguage));
        await expect(page.locator("section, h2, .skills, li")).toHaveCount(0);
        await expect(page.locator("header h1")).toHaveText(resume.name);
        await expect(page.locator(".headline")).toHaveCount(0);
      }
      expect(resumeHtml(resume, templateId)).toContain('<html lang="en">');
    }
  }
});

test("HTML escapes all text and attributes, including contact values starting with an anchor", async ({ page }) => {
  const payload = `<a data-injected="yes">&'\"><script>globalThis.injected = true</script></a>`;
  const resume: ResumeData = JSON.parse(JSON.stringify(fullResume(), (_key, value) =>
    typeof value === "string" ? payload : value));
  await page.route("**/*", (route) => route.abort());
  for (const templateId of templateIds) {
    for (const outputLanguage of languages) {
      const html = resumeHtml(resume, templateId, outputLanguage);
      for (const entity of ["&amp;", "&lt;", "&gt;", "&quot;", "&#39;"]) expect(html).toContain(entity);
      await page.setContent(html);
      await expect(page).toHaveTitle(`${payload} — ${outputLanguage === "zh" ? "简历" : "Resume"}`);
      await expect(page.locator("script, [data-injected], img, [onerror]")).toHaveCount(0);
      await expect(page.locator("h1")).toHaveText(payload);
      await expect(page.locator(".headline")).toHaveText(payload);
      await expect(page.locator(".contact")).toContainText(payload);
      for (const element of await page.locator(".role, .meta, .sub, li, .skills p, .summary").all()) {
        await expect(element).toContainText(payload);
      }
      const links = page.locator("a");
      await expect(links.first()).toHaveAttribute("href", `mailto:${payload}`);
      for (const link of (await links.all()).slice(1)) await expect(link).toHaveAttribute("href", payload);
      for (const section of await page.locator("section").all()) await expect(section).toContainText(payload);
    }
  }
});

test("PDF entry points forward template and language, infer source defaults and preserve cover letters", async () => {
  const previousChannel = process.env.BROWSER_CHANNEL;
  process.env.BROWSER_CHANNEL = process.env.PW_CHANNEL || "chromium";
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "roleflow-resume-render-"));
  let browser: Awaited<ReturnType<typeof headlessBrowser>> | undefined;
  try {
    browser = await headlessBrowser();
    for (const outputLanguage of languages) {
      // Opposite-language content proves that the explicit fourth argument is forwarded.
      const sourceLanguage = outputLanguage === "zh" ? "en" : "zh";
      const resume = sourceLanguage === "zh" ? fullResume() : englishResume();
      for (const templateId of templateIds) {
        const output = path.join(directory, "nested", `${templateId}-${outputLanguage}.pdf`);
        await renderResumePdf(resume, output, templateId, outputLanguage);
        expectPdfOrder(await pdfText(await fs.readFile(output)), templateId, outputLanguage, sourceLanguage);

        const inferredOutput = path.join(directory, `${templateId}-${sourceLanguage}-inferred.pdf`);
        await renderResumePdf(resume, inferredOutput, templateId);
        expectPdfOrder(await pdfText(await fs.readFile(inferredOutput)), templateId, sourceLanguage);
      }
      const defaultOutput = path.join(directory, `default-${sourceLanguage}.pdf`);
      await renderResumePdf(resume, defaultOutput);
      expectPdfOrder(await pdfText(await fs.readFile(defaultOutput)), "general", sourceLanguage);
    }

    for (const language of languages) {
      const resume = language === "zh" ? fullResume() : englishResume();
      const letter = language === "zh"
        ? "尊敬的示例招聘团队：\n\n我曾完成离线数据校验。保留原文 <标签> & 测试。\n\n此致\n虚构候选人"
        : "Dear Example Team,\n\nI implemented offline validation. Preserve <tags> & original text.\n\nRegards,\nFictional Candidate";
      const coverOutput = path.join(directory, `cover-${language}.pdf`);
      // Keep the legacy call covered as well as the explicit language argument.
      if (language === "zh") await renderCoverLetterPdf(resume, letter, coverOutput);
      else await renderCoverLetterPdf(resume, letter, coverOutput, language);
      const coverText = normalizePdfText(await pdfText(await fs.readFile(coverOutput)));
      expect(coverText).toContain(normalizePdfText(resume.name));
      expect(coverText).toContain(normalizePdfText(resume.contact.email));
      expect(coverText).toContain(normalizePdfText(resume.contact.phone));
      expect(coverText).toContain(normalizePdfText(resume.contact.location));
      expect(coverText).toContain(normalizePdfText(letter));
    }
    expect(browser.contexts()).toHaveLength(0);
  } finally {
    await browser?.close();
    await fs.rm(directory, { recursive: true, force: true });
    if (previousChannel === undefined) delete process.env.BROWSER_CHANNEL;
    else process.env.BROWSER_CHANNEL = previousChannel;
  }
});
