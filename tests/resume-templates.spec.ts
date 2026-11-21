import { expect, test } from "@playwright/test";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import path from "path";
import { NextRequest } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { POST } from "../app/api/jobs/[id]/tailor/route";
import { GET } from "../app/api/resume/[id]/route";
import { headlessBrowser } from "../lib/agent/browser";
import { config, dataPath } from "../lib/config";
import { resumeDigest } from "../lib/jobs/match";
import { structureResume } from "../lib/resume/parse";
import { resumeSchema, tailorRequestSchema } from "../lib/resume/schema";
import { restoreResumeFacts } from "../lib/resume/tailor";
import { resumeTemplates, templateInstructions, templateOutputLanguage } from "../lib/resume/templates";
import { resumeToText } from "../lib/resume/text";
import { emptyPreferences, getProfile, getResumeVersion, listResumeVersions, saveJobs, saveProfile } from "../lib/store";
import type { Job, ResumeData, ResumeTailorDraft, ResumeTemplateId, ResumeVersion } from "../lib/types";

const resume: ResumeData = {
  name: "测试候选人",
  headline: "数据分析实习生",
  contact: { email: "candidate@example.com", phone: "", location: "北京", linkedin: "", github: "", website: "" },
  summary: "使用 Python 处理数据。",
  education: [{ school: "示例大学", degree: "本科", field: "数学", start: "2021", end: "2025", details: [] }],
  experience: [{ company: "示例企业", title: "实习生", start: "2024.06", end: "2024.08", location: "北京", bullets: ["整理 200 条测试记录。"] }],
  projects: [{ name: "数据分析项目", tech: ["Python"], link: "", bullets: ["清洗 200 条记录。"] }],
  skills: [{ category: "技能", items: ["Python"] }],
  activities: [
    { organization: "示例学院", title: "班委", start: "2022", end: "2023", bullets: ["协助组织 3 场活动。"] },
    { organization: "示例社区", title: "志愿者", start: "2023", end: "2024", bullets: ["协助物资登记。"] },
  ],
  achievements: ["示例荣誉"],
  certifications: ["示例证书"],
};

const job: Job = {
  id: "template-fixture-job", source: "web", title: "数据分析实习生", company: "测试企业", location: "北京",
  url: "https://example.com/jobs/test", applyUrl: "https://example.com/jobs/test", description: "使用 Python 处理数据，参与团队协作。",
  fetchedAt: "2026-11-19T00:00:00.000Z",
};

for (const templateId of Object.keys(resumeTemplates) as ResumeTemplateId[]) {
  test(`${templateId} has matching request validation, prompt and layout metadata`, () => {
    expect(tailorRequestSchema.parse({ templateId }).templateId).toBe(templateId);
    const template = resumeTemplates[templateId];
    const prompt = templateInstructions(templateId);
    expect(prompt).toContain(template.label);
    expect(prompt).toContain(template.sections.map((key) => template.titles[key]).join(" → "));
    expect(prompt).toContain("Template-specific output language is applied only in the later translation stage");
    expect(prompt).toContain("Simulated or expected results must not become realized business results");
    expect(new Set(template.sections).size).toBe(template.sections.length);
  });
}

for (const sourceLanguage of ["zh", "en"] as const) {
  test(`templates determine output language for ${sourceLanguage} sources`, () => {
    expect(templateOutputLanguage("general", sourceLanguage)).toBe(sourceLanguage);
    expect(templateOutputLanguage("state-owned", sourceLanguage)).toBe("zh");
    expect(templateOutputLanguage("big-tech", sourceLanguage)).toBe("zh");
    expect(templateOutputLanguage("multinational", sourceLanguage)).toBe("en");
  });
}

test("missing template uses general; invalid values and language overrides are rejected", () => {
  expect(tailorRequestSchema.parse({})).toEqual({ templateId: "general" });
  for (const value of [{ templateId: "unknown" }, { templateId: null }, { templateId: 1 }, { arbitrary: true }, { outputLanguage: "fr" }, { outputLanguage: null }, { outputLanguage: "en" }, { templateId: "multinational", outputLanguage: "zh" }, null, []]) {
    expect(tailorRequestSchema.safeParse(value).success).toBe(false);
  }
  expect(resumeSchema.parse(resume).activities).toEqual(resume.activities);
});

test("campus-only evidence reaches matching and application context without changing the source", () => {
  const campusOnly = { ...resume, summary: "", skills: [], experience: [], projects: [], education: [] };
  const before = structuredClone(campusOnly);
  for (const serialize of [resumeDigest, resumeToText]) {
    const text = serialize(campusOnly);
    for (const activity of campusOnly.activities!) {
      for (const fact of [activity.organization, activity.title, activity.start, activity.end, ...activity.bullets]) {
        expect(text).toContain(fact);
      }
    }
    expect(serialize({ ...campusOnly, activities: undefined })).toBe(serialize({ ...campusOnly, activities: [] }));
  }
  expect(campusOnly).toEqual(before);
});

test("campus activities retain source identity and dates while allowing grounded rewording", () => {
  const proposed = structuredClone(resume);
  proposed.activities = [
    { ...resume.activities![1], start: "2099", end: "2099", bullets: ["参与社区物资登记工作。"] },
    { organization: "虚构机构", title: "主任", start: "2025", end: "2026", bullets: ["虚构经历。"] },
    { ...resume.activities![1] },
  ];
  const result = restoreResumeFacts(resume, "Python", proposed);
  expect(result.resume.activities).toEqual([
    { ...resume.activities![1], bullets: ["参与社区物资登记工作。"] },
    resume.activities![0],
  ]);
  expect(result.changes.some((change) => change.section === "Activities")).toBe(true);
});

test("old profiles do not acquire invented campus activities", () => {
  const old = { ...resume, activities: undefined };
  const result = restoreResumeFacts(old, "Python", resume);
  expect(result.resume.activities).toEqual([]);
  expect(old.activities).toBeUndefined();
});

test("ambiguous repeated campus roles fall back to source rather than merging", () => {
  const source = structuredClone(resume);
  source.activities = [resume.activities![0], { ...resume.activities![0], start: "2024", end: "2025" }];
  const proposed = structuredClone(source);
  proposed.activities = [{ ...source.activities[0], start: "2099", end: "2099", bullets: ["来源不明。"] }];
  expect(restoreResumeFacts(source, "Python", proposed).resume.activities).toEqual(source.activities);
});

test("template API validates input, generates and stores separate versions, and serves Chinese filenames", async () => {
  test.setTimeout(90_000);
  const directory = await fs.mkdtemp(path.join(tmpdir(), "roleflow-template-test-"));
  const previousDataDir = config.dataDir;
  const envKeys = ["AI_PROVIDER", "HKUST_API_KEY", "HKUST_MODEL", "BROWSER_CHANNEL"] as const;
  const previousEnv = envKeys.map((key) => [key, process.env[key]] as const);
  const originalFetch = globalThis.fetch;
  const prompts: string[] = [];
  let corruptTranslation = false;
  let sourceResume = resume;
  const english: Record<string, string> = {
    "测试候选人": "Test Candidate", "示例大学": "Example University", "示例企业": "Example Company",
    "示例学院": "Example College", "示例社区": "Example Community", "北京": "Beijing", "测试企业": "Test Company",
    "数据分析实习生": "Data Analyst Intern", "使用 Python 处理数据。": "Processed data with Python.",
    "本科": "Bachelor's degree", "数学": "Mathematics", "实习生": "Intern", "整理 200 条测试记录。": "Organized 200 test records.",
    "数据分析项目": "Data Analysis Project", "清洗 200 条记录。": "Cleaned 200 records.", "技能": "Skills",
    "班委": "Class Representative", "志愿者": "Volunteer", "协助组织 3 场活动。": "Helped organize 3 events.",
    "协助物资登记。": "Helped register supplies.", "示例荣誉": "Sample Award", "示例证书": "Sample Certificate",
  };
  const chinese: Record<string, string> = {
    ...Object.fromEntries(Object.entries(english).map(([zh, en]) => [en, zh])),
    "Projects": "项目经历", "Rephrased project": "调整项目表述", "Relevant to the JD": "与岗位要求相关",
    [`Dear ${job.company} hiring team, I have experience using Python. Thank you.`]: `尊敬的${job.company}招聘团队：我有使用 Python 的经验，谢谢。`,
  };
  try {
    // dataDir is captured at import time, so changing process.env alone does not isolate storage.
    config.dataDir = directory;
    expect(path.resolve(config.dataDir)).not.toBe(path.resolve(previousDataDir));
    expect(dataPath("profile.json")).toBe(path.join(directory, "profile.json"));
    expect(await fs.readdir(directory)).toEqual([]);
    expect(await listResumeVersions()).toEqual([]);
    process.env.AI_PROVIDER = "hkust";
    process.env.HKUST_API_KEY = "test-only-not-a-real-key";
    process.env.HKUST_MODEL = "test-model";
    process.env.BROWSER_CHANNEL = process.env.PW_CHANNEL || "chrome";
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      expect(new URL(request.url).pathname).toBe("/hkust-genai/v1/chat/completions");
      const body = await request.json();
      const instruction = body.messages[0].content as string;
      prompts.push(instruction);
      const isTranslation = body.response_format.json_schema.name === "resume_translation";
      expect(body.response_format.json_schema.schema.properties).toHaveProperty(
        isTranslation ? "translations" : instruction.includes("convert resume text") ? "activities" : "resume",
      );
      const payload = isTranslation ? JSON.parse(body.messages[1].content) as {
        targetLanguage: "zh" | "en"; fields: { id: string; source: string; kind: string }[];
      } : null;
      if (payload) {
        expect(payload.fields.find((field) => field.id === "resume.education.0.degree")?.source).toBe(sourceResume.education[0].degree);
        expect(payload.fields.some((field) => /\.(?:start|end|email|phone|link)$/.test(field.id))).toBe(false);
        expect(payload.fields.find((field) => field.id === "resume.name")?.source).toBe(sourceResume.name);
        expect(payload.fields.find((field) => field.id === "resume.experience.0.company")?.source).toBe(sourceResume.experience[0].company);
      }
      const sourceChinese = sourceResume.summary.includes("使用");
      const output = payload ? {
        translations: payload.fields.map((field) => ({ id: field.id,
          text: corruptTranslation && field.id.endsWith("bullets.0") ? field.source.replace("200", "999")
            : (payload.targetLanguage === "en" ? english : chinese)[field.source] ?? field.source,
        })).reverse(),
      } : instruction.includes("convert resume text") ? resume : {
        resume: { ...sourceResume, education: [], experience: sourceResume.experience.map((entry) => ({ ...entry, start: "2099", end: "2099" })) },
        changes: [{ section: sourceChinese ? "项目经历" : "Projects", change: sourceChinese ? "调整项目表述" : "Rephrased project", reason: sourceChinese ? "与岗位要求相关" : "Relevant to the JD" }],
        cover_letter: sourceChinese ? `尊敬的${job.company}招聘团队：我有使用 Python 的经验，谢谢。` : `Dear ${job.company} hiring team, I have experience using Python. Thank you.`, gaps: [],
      };
      return Response.json({
        id: "test-completion", object: "chat.completion", created: 0, model: "test-model",
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(output), refusal: null } }],
      });
    };
    await saveProfile({ resume, resumeText: "Python 数据分析 校园活动", originalResumeId: "source-fixture", baseResumeId: null,
      preferences: { ...emptyPreferences }, answers: [], updatedAt: "2026-11-19T00:00:00.000Z" });
    await saveJobs([job]);
    const originalProfile = await getProfile();
    const context = { params: Promise.resolve({ id: job.id }) };
    for (const body of ["{", '{"templateId":"bad"}', '{"templateId":null}', '[]', '{"extra":true}', '{"outputLanguage":"fr"}', '{"outputLanguage":null}', '{"outputLanguage":"en"}', '{"templateId":"multinational","outputLanguage":"zh"}']) {
      const response = await POST(new Request("http://127.0.0.1/api/jobs/test/tailor", { method: "POST", body }), context);
      expect(response.status).toBe(400);
    }
    expect(prompts).toHaveLength(0);
    const parsed = await structureResume("示例简历资料。".repeat(50));
    expect(parsed.activities).toEqual(resume.activities);
    expect(prompts[0]).toContain("Put campus leadership");

    for (const sourceLanguage of ["zh", "en"] as const) {
      sourceResume = sourceLanguage === "zh" ? resume : JSON.parse(JSON.stringify(resume,
        (_key, value) => typeof value === "string" ? english[value] ?? value : value)) as ResumeData;
      const sourceProfile = { ...originalProfile, resume: sourceResume, resumeText: JSON.stringify(sourceResume),
        originalResumeId: `source-${sourceLanguage}-fixture` };
      await saveProfile(sourceProfile);
      for (const templateId of Object.keys(resumeTemplates) as ResumeTemplateId[]) {
        const outputLanguage = templateId === "general" ? sourceLanguage : templateId === "multinational" ? "en" : "zh";
        const callsBefore = prompts.length;
        const versionsBefore = (await listResumeVersions()).length;
        const response = await POST(new Request("http://127.0.0.1/api/jobs/test/tailor", {
          method: "POST", body: templateId === "general" ? undefined : JSON.stringify({ templateId }),
        }), context);
        expect(response.status).toBe(200);
        let result = await response.json() as { version: ResumeVersion; gaps: string[]; draft?: ResumeTailorDraft };
        expect(prompts.length - callsBefore).toBe(sourceLanguage === outputLanguage ? 1 : 2);
        expect(prompts[callsBefore]).toContain(templateInstructions(templateId));
        if (sourceLanguage !== outputLanguage) {
          const draft = result.draft!;
          expect(draft.sourceResumeId).toBe(sourceProfile.originalResumeId);
          expect(draft.outputLanguage).toBe(outputLanguage);
          expect(draft.review.map((field) => field.id)).toEqual(expect.arrayContaining([
            "resume.name", "resume.experience.0.company", "resume.education.0.school", "resume.education.0.degree", "resume.education.0.field",
          ]));
          expect(result.version).toBeUndefined();
          expect(await listResumeVersions()).toHaveLength(versionsBefore);
          expect(await fs.stat(path.join(directory, "resumes", draft.id)).catch(() => null)).toBeNull();
          expect((await GET(new NextRequest(`http://127.0.0.1/api/resume/${draft.id}`), {
            params: Promise.resolve({ id: draft.id }),
          })).status).toBe(404);
          const confirmations = draft.review.map((field) => ({ id: field.id, text: field.id === "resume.name" ? "用户确认姓名" : field.suggested }));
          const confirm = (body: unknown, id = job.id) => POST(new Request("http://127.0.0.1/api/jobs/test/tailor", {
            method: "POST", body: JSON.stringify(body),
          }), { params: Promise.resolve({ id }) });
          const confirmBody = { templateId, draftId: draft.id, confirmations };
          expect((await confirm({ ...confirmBody, confirmations: [] })).status).toBe(400);
          expect((await confirm({ ...confirmBody, confirmations: [{ id: "resume.name", text: " " }] })).status).toBe(400);
          expect((await confirm({ ...confirmBody, draftId: "../../profile" })).status).toBe(400);
          expect((await confirm({ ...confirmBody, confirmations: confirmations.slice(1) })).status).toBe(500);
          expect((await confirm({ ...confirmBody, confirmations: [{ id: "__proto__.polluted", text: "yes" }, ...confirmations.slice(1)] })).status).toBe(500);
          expect((await confirm(confirmBody, "other-job")).status).toBe(500);
          expect((await confirm({ ...confirmBody, templateId: "general" })).status).toBe(500);
          expect(await listResumeVersions()).toHaveLength(versionsBefore);
          const callsBeforeConfirmation = prompts.length;
          const [confirmed, retry] = await Promise.all([confirm(confirmBody), confirm(confirmBody)]);
          expect(confirmed.status).toBe(200);
          expect(retry.status).toBe(200);
          result = await confirmed.json();
          expect(await retry.json()).toEqual(result);
          const conflict = await confirm({ ...confirmBody, confirmations: confirmations.map((entry) => entry.id === "resume.name" ? { ...entry, text: "另一确认姓名" } : entry) });
          expect(conflict.status).toBe(500);
          expect((await conflict.json()).error).toContain("另一组译名");
          expect(prompts).toHaveLength(callsBeforeConfirmation);
          expect(await listResumeVersions()).toHaveLength(versionsBefore + 1);
          expect(Object.prototype).not.toHaveProperty("polluted");
          expect(result.version.fileName).toContain("用户确认姓名");
          expect(result.version.coverLetter).not.toContain("⟦RF_");
        } else {
          expect(result.draft).toBeUndefined();
        }
        const { version, gaps } = result;
        expect(version.templateId).toBe(templateId);
        expect(version.outputLanguage).toBe(outputLanguage);
        expect(version.sourceResumeId).toBe(sourceProfile.originalResumeId);
        expect(version.label).toContain(resumeTemplates[templateId].label);
        expect(version.label).toContain(outputLanguage === "zh" ? "中文" : "English");
        expect(gaps).toEqual([]);
        expect(await getResumeVersion(version.id)).toEqual(version);
        for (const query of ["", "?download", "?file=cover&download"]) {
          const pdfResponse = await GET(new NextRequest(`http://127.0.0.1/api/resume/${version.id}${query}`), {
            params: Promise.resolve({ id: version.id }),
          });
          expect(pdfResponse.status).toBe(200);
          const filename = path.basename(query.includes("cover") ? version.coverLetterFile! : version.fileName);
          expect(pdfResponse.headers.get("Content-Disposition")).toContain(`filename*=UTF-8''${encodeURIComponent(filename)}`);
          expect(pdfResponse.headers.get("Content-Disposition")).toMatch(query ? /^attachment/ : /^inline/);
          const bytes = new Uint8Array(await pdfResponse.arrayBuffer());
          expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("%PDF-");
          if (!query && sourceLanguage !== outputLanguage) {
            const document = await getDocumentProxy(bytes);
            try {
              // Font fallback extracts compatibility/traditional glyphs (⽤/戶) in English-language PDFs.
              const text = (await extractText(document, { mergePages: true })).text.normalize("NFKC").replace(/\s/g, "");
              expect(text).toContain("确认姓名");
              expect(text).toContain(outputLanguage === "en" ? "ExampleUniversity" : "示例大学");
              expect(text).toContain(outputLanguage === "en" ? "ExampleCompany" : "示例企业");
              expect(text).toContain("200");
              expect(text).not.toContain("⟦RF_");
            } finally {
              await document.loadingTask.destroy();
            }
          }
        }
        expect(await getProfile()).toEqual(sourceProfile);
      }
    }
    expect(await listResumeVersions()).toHaveLength(8);
    expect(new Set((await listResumeVersions()).map((version) => version.id)).size).toBe(8);
    const profileBeforeFailure = await getProfile();
    const foldersBeforeFailure = await fs.readdir(path.join(directory, "resumes"));
    const pendingResponse = await POST(new Request("http://127.0.0.1/api/jobs/test/tailor", {
      method: "POST", body: JSON.stringify({ templateId: "state-owned" }),
    }), context);
    const { draft: staleDraft } = await pendingResponse.json() as { draft: ResumeTailorDraft };
    const staleBody = { templateId: "state-owned", draftId: staleDraft.id,
      confirmations: staleDraft.review.map((field) => ({ id: field.id, text: field.suggested })) };
    const callsBeforeStale = prompts.length;
    await saveProfile({ ...profileBeforeFailure, resume: { ...profileBeforeFailure.resume!,
      contact: { ...profileBeforeFailure.resume!.contact, email: "corrected@example.test" } } });
    const correctedContactResponse = await POST(new Request("http://127.0.0.1/api/jobs/test/tailor", {
      method: "POST", body: JSON.stringify(staleBody),
    }), context);
    expect(correctedContactResponse.status).toBe(500);
    expect((await correctedContactResponse.json()).error).toContain("个人信息已更换");
    await saveProfile({ ...profileBeforeFailure, originalResumeId: "replacement-source" });
    const staleResponse = await POST(new Request("http://127.0.0.1/api/jobs/test/tailor", {
      method: "POST", body: JSON.stringify(staleBody),
    }), context);
    expect(staleResponse.status).toBe(500);
    expect((await staleResponse.json()).error).toContain("原始简历或个人信息已更换");
    await saveProfile(profileBeforeFailure);
    const draftPath = dataPath("resume-drafts", `${staleDraft.id}.json`);
    const stored = JSON.parse(await fs.readFile(draftPath, "utf8"));
    await fs.writeFile(draftPath, JSON.stringify({ ...stored, expiresAt: 0 }));
    const expiredResponse = await POST(new Request("http://127.0.0.1/api/jobs/test/tailor", {
      method: "POST", body: JSON.stringify(staleBody),
    }), context);
    expect(expiredResponse.status).toBe(500);
    expect((await expiredResponse.json()).error).toContain("已过期");
    expect(prompts).toHaveLength(callsBeforeStale);
    corruptTranslation = true;
    const failed = await POST(new Request("http://127.0.0.1/api/jobs/test/tailor", {
      method: "POST", body: JSON.stringify({ templateId: "state-owned" }),
    }), context);
    expect(failed.status).toBe(500);
    expect((await failed.json()).error).toContain("翻译校验未通过");
    expect(await listResumeVersions()).toHaveLength(8);
    expect(await fs.readdir(path.join(directory, "resumes"))).toEqual(foldersBeforeFailure);
    expect(await getProfile()).toEqual(profileBeforeFailure);
  } finally {
    globalThis.fetch = originalFetch;
    try {
      await (await headlessBrowser()).close();
    } finally {
      config.dataDir = previousDataDir;
      for (const [key, value] of previousEnv) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
});
