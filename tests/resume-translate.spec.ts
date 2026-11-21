import { expect, test } from "@playwright/test";
import { confirmResumeTranslation, translateResume, type TranslatedContent } from "../lib/resume/translate";
import type { ResumeData } from "../lib/types";

type Field = { id: string; source: string; kind: string };
type Translation = { id: string; text: string };
const dictionary: Record<string, string> = {
  "测试候选人": "Test Candidate", "示例城市": "Example City", "示例公司": "Example Company",
  "示例大学": "Example University", "示例协会": "Example Association",
  "数据分析实习生": "Data Analyst Intern", "使用 Python 分析数据。": "Analyzed data with Python.",
  "技能": "Skills", "数据分析": "Data Analysis", "实习生": "Intern",
  "处理 200 条记录。": "Processed 200 records.", "分析项目": "Analysis Project",
  "模拟预期收益为 ¥7.8M，准确率 87.0%，延迟 20 ms。": "Simulated expected profit was ¥7.8M, accuracy was 87.0%, latency was 20 ms.",
  "本科": "Bachelor's degree", "数学": "Mathematics", "成绩 88.04/100。": "GPA 88.04/100.",
  "志愿者": "Volunteer", "组织 3 场活动。": "Organized 3 events.", "软件证书": "Software Certificate",
  "创新奖": "Innovation Award", "项目经历": "Projects", "调整项目表述": "Rephrased project",
  "与岗位要求相关": "Relevant to the JD", "尊敬的招聘团队：我有数据分析经验。": "Dear hiring team, I have data analysis experience.",
  "未提供管理经验": "Management experience not provided",
};
const reverse = Object.fromEntries(Object.entries(dictionary).map(([a, b]) => [b, a]));

function resume(): ResumeData {
  return {
    name: "测试候选人", headline: "数据分析实习生", summary: "使用 Python 分析数据。",
    contact: { email: "candidate@example.test", phone: "+852 0000 0000", location: "示例城市", linkedin: "", github: "https://example.test/code", website: "" },
    skills: [{ category: "技能", items: ["Python", "数据分析"] }],
    experience: [{ title: "实习生", company: "示例公司", location: "示例城市", start: "2024.06", end: "2024.08", bullets: ["处理 200 条记录。"] }],
    projects: [{ name: "分析项目", tech: ["Python", "Node.js"], link: "https://example.test/project", bullets: ["模拟预期收益为 ¥7.8M，准确率 87.0%，延迟 20 ms。"] }],
    education: [{ school: "示例大学", degree: "本科", field: "数学", start: "Sep 2020", end: "Jun 2024", details: ["成绩 88.04/100。"] }],
    activities: [{ organization: "示例协会", title: "志愿者", start: "2022", end: "2023", bullets: ["组织 3 场活动。"] }],
    certifications: ["软件证书"], achievements: ["创新奖"],
  };
}
function content() {
  return { resume: resume(), changes: [{ section: "项目经历", change: "调整项目表述", reason: "与岗位要求相关" }],
    coverLetter: "尊敬的招聘团队：我有数据分析经验。", gaps: ["未提供管理经验"] };
}
function englishContent() {
  return JSON.parse(JSON.stringify(content(), (_key, value) => typeof value === "string" ? dictionary[value] ?? value : value)) as ReturnType<typeof content>;
}
function choices(draft: TranslatedContent, edits: Record<string, string> = {}): Translation[] {
  return draft.review.map((entry) => ({ id: entry.id, text: edits[entry.source] ?? entry.suggested }));
}
function changeField(items: Translation[], id: string, text: string) {
  return items.map((item) => item.id === id ? { ...item, text } : item);
}
function token(source: string) {
  const value = identitiesSeen.find((entry) => entry.source === source)?.token;
  expect(value).toMatch(/^⟦RF_[A-Z]+⟧$/);
  return value!;
}

let mutate: (items: Translation[], fields: Field[]) => Translation[];
let fieldsSeen: Field[];
let identitiesSeen: { source: string; token: string }[];
let instructionsSeen: string;
let sourceTextSeen: string;
let techSeen: string[];
let calls: number;
let originalFetch: typeof fetch;
let previousEnv: (readonly [string, string | undefined])[];
test.beforeEach(() => {
  originalFetch = globalThis.fetch;
  previousEnv = ["AI_PROVIDER", "HKUST_API_KEY", "HKUST_MODEL"].map((key) => [key, process.env[key]] as const);
  process.env.AI_PROVIDER = "hkust";
  process.env.HKUST_API_KEY = "test-only-not-a-real-key";
  process.env.HKUST_MODEL = "test-model";
  mutate = (items) => items;
  fieldsSeen = [];
  identitiesSeen = [];
  instructionsSeen = "";
  sourceTextSeen = "";
  techSeen = [];
  calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++;
    const request = new Request(input, init);
    expect(new URL(request.url).pathname).toBe("/hkust-genai/v1/chat/completions");
    const body = await request.json();
    expect(body.response_format.json_schema.name).toBe("resume_translation");
    instructionsSeen = body.messages[0].content;
    const payload = JSON.parse(body.messages[1].content) as {
      targetLanguage: "zh" | "en"; fields: Field[]; sourceText: string;
      identities: typeof identitiesSeen; technicalNames: string[];
    };
    fieldsSeen = payload.fields;
    identitiesSeen = payload.identities;
    sourceTextSeen = payload.sourceText;
    techSeen = payload.technicalNames;
    const mapping = payload.targetLanguage === "en" ? dictionary : reverse;
    const items = payload.fields.map((field) => ({ id: field.id, text: mapping[field.source] ?? field.source }));
    return Response.json({ id: "test", object: "chat.completion", created: 0, model: "test-model",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", refusal: null,
        content: JSON.stringify({ translations: mutate(items, payload.fields) }) } }] });
  };
});
test.afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of previousEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("English translation creates unverified candidates and changes reviewed fields only on confirmation", async () => {
  const input = content();
  const before = structuredClone(input);
  const draft = await translateResume(input, "en");
  expect(draft.resume.name).toBe(input.resume.name);
  expect(draft.resume.contact).toEqual(input.resume.contact);
  expect(draft.resume.experience[0].company).toBe(input.resume.experience[0].company);
  expect(draft.resume.education).toEqual(input.resume.education);
  expect(draft.resume.activities![0].organization).toBe(input.resume.activities![0].organization);
  expect(draft.resume.summary).toBe("Analyzed data with Python.");
  expect(draft.review.map((entry) => entry.id)).toEqual([
    "resume.name", "resume.contact.location", "resume.experience.0.company", "resume.experience.0.location",
    "resume.education.0.school", "resume.education.0.degree", "resume.education.0.field", "resume.education.0.details.0",
    "resume.activities.0.organization",
  ]);
  for (const entry of draft.review) {
    expect(entry.label).toContain("未核实，需确认");
    expect(entry.suggested).toBe(dictionary[entry.source]);
    expect(fieldsSeen.find((field) => field.id === entry.id)).toEqual({ id: entry.id, source: entry.source, kind: "review" });
  }
  const draftBefore = structuredClone(draft);
  const output = confirmResumeTranslation(draft, choices(draft));
  expect(output).toEqual(englishContent());
  expect(output).not.toHaveProperty("review");
  expect(input).toEqual(before);
  expect(draft).toEqual(draftBefore);
  expect(calls).toBe(1);
  expect(output.resume.education[0].start).toBe(input.resume.education[0].start);
  expect(output.resume.experience[0].end).toBe(input.resume.experience[0].end);
  expect(output.resume.projects[0]).toMatchObject({ tech: input.resume.projects[0].tech, link: input.resume.projects[0].link });
  expect(fieldsSeen.some((f) => /(?:\.start|\.end|\.email|\.phone|\.link|\.linkedin|\.github|\.website|\.tech\.\d+)$/.test(f.id))).toBe(false);
});

test("Chinese translation also reviews English names, education and locations", async () => {
  const draft = await translateResume(englishContent(), "zh");
  expect(draft.resume.name).toBe("Test Candidate");
  expect(confirmResumeTranslation(draft, choices(draft))).toEqual(content());
});

test("target-language candidates from sourceText remain explicitly unverified", async () => {
  const sourceText = "测试候选人 / Alex Chen; 示例公司 / Example Holdings; 示例大学 / Example University";
  mutate = (items) => changeField(changeField(items, "resume.name", "Alex Chen"), "resume.experience.0.company", "Example Holdings");
  const draft = await translateResume(content(), "en", [], sourceText);
  expect(sourceTextSeen).toBe(sourceText);
  expect(instructionsSeen).toContain("Prefer target-language names already supplied in sourceText");
  expect(instructionsSeen).toContain("Every suggestion is unverified and requires user confirmation");
  expect(instructionsSeen).toContain("Never claim official verification");
  expect(instructionsSeen).toContain("request web research or use browsing");
  expect(draft.review.find((entry) => entry.id === "resume.name")?.suggested).toBe("Alex Chen");
  expect(draft.resume.name).toBe("测试候选人");
  expect(calls).toBe(1);
});

test("cross-language calls still review bilingual and already-target-script identities", async () => {
  const input = content();
  input.resume.name = "Alex Chen / 陈晓";
  input.resume.experience[0].company = "Example Company";
  input.resume.summary = "Python 数据分析 / Data Analysis";
  const draft = await translateResume(input, "en");
  expect(draft.review.find((entry) => entry.id === "resume.name")?.suggested).toBe(input.resume.name);
  expect(draft.review.find((entry) => entry.id === "resume.experience.0.company")?.suggested).toBe("Example Company");
  expect(confirmResumeTranslation(draft, choices(draft)).resume.summary).toBe(input.resume.summary);
});

test("old resumes without campus activities and with blank reviewed fields are supported", async () => {
  const input = content();
  delete input.resume.activities;
  input.resume.education[0].field = "";
  const draft = await translateResume(input, "en");
  expect(draft.review.some((entry) => entry.id === "resume.education.0.field")).toBe(false);
  const result = confirmResumeTranslation(draft, choices(draft));
  expect(result.resume.activities).toBeUndefined();
  expect(result.resume.education[0].degree).toBe("Bachelor's degree");
  expect(result.resume.education[0].field).toBe("");
});

test("edited candidates propagate through all allowlisted prose fields and cover letter after serialization", async () => {
  const input = content();
  const prose = "测试候选人在示例公司和示例大学，示例城市，本科，数学，成绩 88.04/100。，示例协会。";
  input.resume.headline = prose;
  input.resume.summary = prose;
  input.resume.skills = [{ category: prose, items: [prose, "Python", "SQL"] }];
  input.resume.experience[0].title = prose;
  input.resume.experience[0].bullets = [prose];
  input.resume.projects[0].name = prose;
  input.resume.projects[0].bullets = [prose];
  input.resume.activities![0].title = prose;
  input.resume.activities![0].bullets = [prose];
  input.resume.certifications = [prose];
  input.resume.achievements = [prose];
  input.changes = [{ section: prose, change: prose, reason: prose }];
  input.gaps = [prose];
  input.coverLetter = prose;
  const original = structuredClone(input);
  const translatedProse = () => `${token("测试候选人")} worked at ${token("示例公司")} in ${token("示例城市")}; ${token("本科")} in ${token("数学")} at ${token("示例大学")}; ${token("成绩 88.04/100。")}; ${token("示例协会")}.`;
  mutate = (items, fields) => items.map((item) => fields.find((field) => field.id === item.id)!.kind !== "review" && item.text.includes("⟦RF_")
    ? { ...item, text: translatedProse() } : item);
  const draft = JSON.parse(JSON.stringify(await translateResume(input, "en"))) as TranslatedContent;
  const before = structuredClone(draft);
  expect(draft.resume.name).toBe(input.resume.name);
  expect(draft.coverLetter).toBe(translatedProse());
  expect(draft.coverLetter).toContain("⟦RF_A⟧");
  const edits = { "测试候选人": "Alex Chen", "示例公司": "Acme", "示例城市": "Hong Kong", "示例大学": "Example U",
    "本科": "BSc", "数学": "Maths", "成绩 88.04/100。": "Score: 88.04/100.", "示例协会": "Volunteers Association" };
  const output = confirmResumeTranslation(draft, choices(draft, edits).reverse());
  const expected = "Alex Chen worked at Acme in Hong Kong; BSc in Maths at Example U; Score: 88.04/100.; Volunteers Association.";
  expect(output.resume.summary).toBe(expected);
  expect(output.resume.headline).toBe(expected);
  expect(output.resume.skills).toEqual([{ category: expected, items: [expected, "Python", "SQL"] }]);
  expect(output.resume.experience[0]).toMatchObject({ title: expected, company: "Acme", location: "Hong Kong", bullets: [expected] });
  expect(output.resume.projects[0]).toMatchObject({ name: expected, bullets: [expected], tech: input.resume.projects[0].tech, link: input.resume.projects[0].link });
  expect(output.resume.activities![0]).toMatchObject({ title: expected, organization: "Volunteers Association", bullets: [expected] });
  expect(output.resume.certifications).toEqual([expected]);
  expect(output.resume.achievements).toEqual([expected]);
  expect(output.changes).toEqual([{ section: expected, change: expected, reason: expected }]);
  expect(output.gaps).toEqual([expected]);
  expect(output.coverLetter).toBe(expected);
  expect(output.resume.education[0]).toMatchObject({ school: "Example U", degree: "BSc", field: "Maths", details: ["Score: 88.04/100."] });
  expect(output.resume.contact).toEqual({ ...input.resume.contact, location: "Hong Kong" });
  expect(output.resume.experience[0].start).toBe(input.resume.experience[0].start);
  expect(output.resume.education[0].end).toBe(input.resume.education[0].end);
  expect(JSON.stringify(output)).not.toContain("⟦RF_");
  expect(input).toEqual(original);
  expect(draft).toEqual(before);
  expect(calls).toBe(1);
});

test("tokenization is longest-first, boundary-aware, escaped and does not replace links or emails", async () => {
  const input = englishContent();
  input.resume.name = "Ann";
  input.resume.experience[0].company = "Acme";
  input.resume.education[0].school = "Acme University";
  input.resume.activities![0].organization = "A+B (Lab)";
  input.resume.contact.email = "Ann@Acme.test";
  input.resume.contact.website = "https://Acme.test/Ann";
  input.resume.experience[0].start = "Ann 2020";
  input.resume.projects[0].link = "https://Acme.test/Ann";
  input.resume.projects[0].tech = ["Python", "SQL", "Acme SDK"];
  input.resume.summary = "Ann, Anna and Annual at Acme University, Acme, Acmeology, A+B (Lab), Acme SDK; https://Acme.test/Ann and Ann@Acme.test.";
  const draft = await translateResume(input, "zh");
  expect(draft.resume.summary).toBe(`${token("Ann")}, Anna and Annual at ${token("Acme University")}, ${token("Acme")}, Acmeology, ${token("A+B (Lab)")}, Acme SDK; https://Acme.test/Ann and Ann@Acme.test.`);
  const output = confirmResumeTranslation(draft, choices(draft, { Ann: "安", Acme: "艾克米", "Acme University": "艾克米大学", "A+B (Lab)": "甲乙实验室" }));
  expect(output.resume.summary).toBe("安, Anna and Annual at 艾克米大学, 艾克米, Acmeology, 甲乙实验室, Acme SDK; https://Acme.test/Ann and Ann@Acme.test.");
  expect(output.resume.contact.email).toBe(input.resume.contact.email);
  expect(output.resume.contact.website).toBe(input.resume.contact.website);
  expect(output.resume.experience[0].start).toBe(input.resume.experience[0].start);
  expect(output.resume.projects[0].link).toBe(input.resume.projects[0].link);
  expect(output.resume.projects[0].tech).toEqual(input.resume.projects[0].tech);
});

test("longer reviewed identities win over technical prefixes without changing standalone products", async () => {
  const input = englishContent();
  input.resume.education[0].school = "Python Institute";
  input.resume.experience[0].company = "Node";
  input.resume.summary = "Python at Python Institute; Node.js at Node. https://Node.test。Node与Python Institute。";
  const draft = await translateResume(input, "zh");
  expect(draft.resume.summary).toBe(`Python at ${token("Python Institute")}; Node.js at ${token("Node")}. https://Node.test。${token("Node")}与${token("Python Institute")}。`);
  const output = confirmResumeTranslation(draft, choices(draft, { "Python Institute": "Python 学院", Node: "诺德" }));
  expect(output.resume.summary).toBe("Python at Python 学院; Node.js at 诺德. https://Node.test。诺德与Python 学院。");
});

test("substitution is single-pass even when a confirmed name equals another source name", async () => {
  const input = englishContent();
  input.resume.name = "Alice";
  input.resume.experience[0].company = "Bob";
  input.resume.summary = "Alice joined Bob.";
  const draft = await translateResume(input, "zh");
  const output = confirmResumeTranslation(draft, choices(draft, { Alice: "Bob", Bob: "$& Incorporated" }));
  expect(output.resume.summary).toBe("Bob joined $& Incorporated.");
});

test("duplicate sources use a canonical suggestion and token, and reject inconsistent confirmations", async () => {
  const input = content();
  input.resume.experience.push(structuredClone(input.resume.experience[0]));
  input.resume.summary = "示例公司与示例公司。";
  mutate = (items) => changeField(items, "resume.experience.1.company", "Different suggestion").reverse();
  const draft = await translateResume(input, "en");
  const companies = draft.review.filter((entry) => entry.source === "示例公司");
  expect(companies.map((entry) => entry.suggested)).toEqual(["Example Company", "Example Company"]);
  expect(draft.resume.summary).toBe(`${token("示例公司")}与${token("示例公司")}。`);
  const inconsistent = changeField(choices(draft), "resume.experience.1.company", "Another Company");
  expect(() => confirmResumeTranslation(draft, inconsistent)).toThrow("相同原文的确认文本不一致");
  const output = confirmResumeTranslation(draft, choices(draft, { "示例公司": "User Company" }));
  expect(output.resume.experience.map((entry) => entry.company)).toEqual(["User Company", "User Company"]);
  expect(output.resume.summary).toBe("User Company与User Company。");
});

test("additional hiring company references require confirmation and update letter and prose", async () => {
  const input = content();
  input.coverLetter = "Dear 目标招聘公司, 目标招聘公司 hiring team.";
  input.changes[0].reason = "目标招聘公司";
  input.resume.summary = "申请目标招聘公司。";
  mutate = (items) => changeField(items, "reference.0", "Hiring Company");
  const draft = await translateResume(input, "en", ["目标招聘公司", "Absent Employer", "目标招聘公司", "示例公司"]);
  expect(draft.review.filter((entry) => entry.id.startsWith("reference."))).toEqual([
    { id: "reference.0", source: "目标招聘公司", suggested: "Hiring Company", label: expect.stringContaining("未核实") },
  ]);
  expect(draft.coverLetter).toBe(`Dear ${token("目标招聘公司")}, ${token("目标招聘公司")} hiring team.`);
  const output = confirmResumeTranslation(draft, choices(draft, { "目标招聘公司": "User's Employer" }));
  expect(output.coverLetter).toBe("Dear User's Employer, User's Employer hiring team.");
  expect(output.resume.summary).toBe("申请User's Employer。");
  expect(output.changes[0].reason).toBe("User's Employer");
  expect(output).not.toHaveProperty("reference");
  expect(calls).toBe(1);
});

test("deterministic alphabetic tokens work past Z and do not add numeric facts", async () => {
  const input = content();
  const names = Array.from({ length: 30 }, (_, index) => `Employer-${index}`);
  input.coverLetter = names.join("; ");
  const first = await translateResume(input, "en", names);
  const second = await translateResume(input, "en", names);
  expect(first).toEqual(second);
  expect(first.coverLetter).toContain("⟦RF_AA⟧");
  expect(first.coverLetter).not.toMatch(/\d/);
  const edits = Object.fromEntries(names.map((name, index) => [name, `雇主-${index}`]));
  expect(confirmResumeTranslation(first, choices(first, edits)).coverLetter).toBe(Object.values(edits).join("; "));
});

for (const mode of ["missing", "duplicate", "unknown", "moved", "malformed", "numeric", "lowercase"] as const) {
  test(`rejects ${mode} model placeholders by per-field multiset`, async () => {
    const input = content();
    input.resume.summary = "测试候选人在示例公司与示例公司。";
    mutate = (items) => items.map((item) => {
      if (mode === "moved" && item.id === "coverLetter") return { ...item, text: item.text + token("示例公司") };
      if (item.id !== "resume.summary") return item;
      const company = token("示例公司");
      const replacement = mode === "missing" || mode === "moved" ? "" : mode === "duplicate" ? company + company
        : mode === "unknown" ? "⟦RF_ZZZ⟧" : mode === "numeric" ? "⟦RF_1⟧" : mode === "lowercase" ? "⟦rf_c⟧" : "⟦RF_C";
      return { ...item, text: item.text.replace(company, replacement) };
    });
    await expect(translateResume(input, "en")).rejects.toThrow("占位符");
  });
}

test("reordered placeholders and facts within a field are accepted", async () => {
  const input = content();
  input.resume.summary = "测试候选人在示例公司。";
  mutate = (items) => changeField(items, "resume.summary", `${token("示例公司")} employed ${token("测试候选人")}.`);
  const draft = await translateResume(input, "en");
  expect(confirmResumeTranslation(draft, choices(draft)).resume.summary).toBe("Example Company employed Test Candidate.");
});

test("model cannot add placeholders to a review candidate or token-free prose", async () => {
  mutate = (items) => changeField(items, "resume.name", "⟦RF_A⟧");
  await expect(translateResume(content(), "en")).rejects.toThrow("占位符");
  mutate = (items) => changeField(items, "resume.summary", "New ⟦RF_A⟧");
  await expect(translateResume(content(), "en")).rejects.toThrow("占位符");
});

for (const target of ["prose", "candidate", "reference", "sourceText"] as const) {
  test(`rejects reserved tokens in input ${target} before calling the model`, async () => {
    const input = content();
    if (target === "prose") input.resume.summary = "⟦RF_A⟧";
    if (target === "candidate") input.resume.name = "⟦RF_A⟧";
    await expect(translateResume(input, "en", target === "reference" ? ["⟦RF_A⟧"] : [], target === "sourceText" ? "⟦RF_A⟧" : "")).rejects.toThrow("占位符");
    expect(calls).toBe(0);
  });
}

for (const mode of ["missing", "duplicate", "unexpected", "empty", "oversized", "token", "malformed token", "nonstring"] as const) {
  test(`rejects ${mode} confirmations without mutating the stored draft`, async () => {
    const draft = await translateResume(content(), "en");
    const before = structuredClone(draft);
    let entries = choices(draft);
    if (mode === "missing") entries = entries.slice(1);
    else if (mode === "duplicate") entries = [entries[0], entries[0], ...entries.slice(2)];
    else if (mode === "unexpected") entries[0] = { id: "__proto__.polluted", text: "yes" };
    else entries[0].text = mode === "empty" ? " \n " : mode === "oversized" ? "a".repeat(4001)
      : mode === "token" ? "⟦RF_A⟧" : mode === "malformed token" ? "⟦rf_abc" : 123 as unknown as string;
    expect(() => confirmResumeTranslation(draft, entries)).toThrow("翻译校验未通过");
    expect(Object.prototype).not.toHaveProperty("polluted");
    expect(draft).toEqual(before);
    expect(calls).toBe(1);
  });
}

test("confirmation accepts the 4000-character boundary", async () => {
  const draft = await translateResume(content(), "en");
  expect(confirmResumeTranslation(draft, choices(draft, { "测试候选人": "a".repeat(4000) })).resume.name).toHaveLength(4000);
});

for (const id of ["__proto__.polluted", "resume.contact.email", "resume.projects.0.tech.0", "reference.__proto__", "reference.01", "reference.2"]) {
  test(`rejects forged draft review id ${id}`, async () => {
    const draft = await translateResume(content(), "en");
    draft.review[0].id = id;
    expect(() => confirmResumeTranslation(draft, choices(draft))).toThrow("翻译校验未通过");
    expect(Object.prototype).not.toHaveProperty("polluted");
  });
}

test("missing, duplicate and altered draft review sources are rejected", async () => {
  const draft = await translateResume(content(), "en");
  const missing = structuredClone(draft);
  missing.review.shift();
  expect(() => confirmResumeTranslation(missing, choices(missing))).toThrow("翻译校验未通过");
  const duplicate = structuredClone(draft);
  duplicate.review[1] = duplicate.review[0];
  expect(() => confirmResumeTranslation(duplicate, choices(duplicate))).toThrow("翻译校验未通过");
  const altered = structuredClone(draft);
  altered.review[0].source = "Invented source";
  expect(() => confirmResumeTranslation(altered, choices(altered))).toThrow("原文不匹配");
});

test("unknown or malformed stored tokens cannot leak into a confirmed resume", async () => {
  const draft = await translateResume(content(), "en");
  draft.coverLetter = "⟦RF_ZZZ⟧";
  expect(() => confirmResumeTranslation(draft, choices(draft))).toThrow("未知占位符");
  draft.coverLetter = "⟦RF_a";
  expect(() => confirmResumeTranslation(draft, choices(draft))).toThrow("占位符格式");
});

for (const [name, from, to] of [
  ["changed count", "200", "201"], ["removed count", "200 ", ""],
  ["changed percentage", "87.0%", "97.0%"], ["removed percentage sign", "87.0%", "87.0"],
  ["changed percentage meaning", "87.0%", "87.0 percentage points"],
  ["changed scale", "¥7.8M", "¥7.8K"], ["changed currency", "¥7.8M", "$7.8M"],
  ["changed measurement unit", "20 ms", "20 s"], ["changed direction", "20 ms", "-20 ms"],
] as const) {
  test(`rejects ${name} before returning a translated resume`, async () => {
    mutate = (items) => items.map((item) => ({ ...item, text: item.text.replace(from, to) }));
    await expect(translateResume(content(), "en")).rejects.toThrow("数字、百分比、量级或计量单位发生变化");
  });
}

test("allows faithful translation of unit words without changing quantities", async () => {
  mutate = (items) => items.map((item) => ({ ...item, text: item.text.replace("20 ms", "20 milliseconds").replace("87.0%", "87.0 percent").replace("7.8M", "7.8 million") }));
  await expect(translateResume(content(), "en")).resolves.toHaveProperty("resume");
});

test("numeric fact order is harmless, but counts and units still matter", async () => {
  const input = content();
  input.resume.summary = "处理 200 条记录，延迟 20 ms。";
  mutate = (items) => changeField(items, "resume.summary", "Latency was 20 ms across 200 records.");
  expect((await translateResume(input, "en")).resume.summary).toBe("Latency was 20 ms across 200 records.");
  mutate = (items) => changeField(items, "resume.summary", "Latency was 200 ms across 20 records.");
  await expect(translateResume(input, "en")).rejects.toThrow("计量单位发生变化");
});

test("changes and gaps skip numerical validation, while cover letters retain it", async () => {
  const input = content();
  input.changes[0].change = "强调 3 项技能";
  input.gaps = ["未提供 5 年经验"];
  input.coverLetter = "处理 200 条记录。";
  mutate = (items) => changeField(changeField(items, "changes.0.change", "Emphasized skills"), "gaps.0", "Experience not provided");
  const draft = await translateResume(input, "en");
  expect(draft.changes[0].change).toBe("Emphasized skills");
  expect(draft.gaps).toEqual(["Experience not provided"]);
  mutate = (items) => changeField(items, "coverLetter", "Processed 201 records.");
  await expect(translateResume(input, "en")).rejects.toThrow("数字、百分比、量级或计量单位发生变化");
});

test("education detail numbers are validated in both suggestions and locally edited confirmations", async () => {
  mutate = (items) => changeField(items, "resume.education.0.details.0", "GPA 99/100.");
  await expect(translateResume(content(), "en")).rejects.toThrow("数字、百分比、量级或计量单位发生变化");
  mutate = (items) => items;
  const draft = await translateResume(content(), "en");
  const before = structuredClone(draft);
  expect(() => confirmResumeTranslation(draft, choices(draft, { "成绩 88.04/100。": "GPA 99/100." }))).toThrow("计量单位发生变化");
  expect(draft).toEqual(before);
  expect(confirmResumeTranslation(draft, choices(draft, { "成绩 88.04/100。": "Out of 100, scored 88.04." })).resume.education[0].details).toEqual(["Out of 100, scored 88.04."]);
});

test("faithfully rephrased uncertainty is accepted without a brittle qualification regex", async () => {
  mutate = (items) => changeField(items, "resume.projects.0.bullets.0", "A hypothetical model suggests profit could be ¥7.8M, with accuracy of 87.0% and latency of 20 ms.");
  const draft = await translateResume(content(), "en");
  expect(draft.resume.projects[0].bullets[0]).toContain("could be");
  expect(instructionsSeen).toContain("Expected, estimated or simulated results must stay qualified, never become realized results");
});

for (const mode of ["missing", "duplicate", "unexpected", "empty"] as const) {
  test(`rejects ${mode} translation fields`, async () => {
    mutate = (items) => {
      if (mode === "missing") return items.slice(1);
      if (mode === "duplicate") return [items[0], items[0], ...items.slice(2)];
      if (mode === "unexpected") return [{ id: "__proto__.polluted", text: "yes" }, ...items.slice(1)];
      return [{ ...items[0], text: " " }, ...items.slice(1)];
    };
    await expect(translateResume(content(), "en")).rejects.toThrow("翻译校验未通过");
    expect(Object.prototype).not.toHaveProperty("polluted");
  });
}

test("reordered model response fields are mapped by their unique known ids", async () => {
  mutate = (items) => [...items].reverse();
  const draft = await translateResume(content(), "en");
  expect(confirmResumeTranslation(draft, choices(draft).reverse())).toEqual(englishContent());
});

for (const id of ["resume.contact.email", "resume.experience.0.start", "resume.projects.0.tech.0", "resume.projects.0.link"]) {
  test(`model cannot inject immutable field ${id}`, async () => {
    mutate = (items) => [{ id, text: "Changed" }, ...items.slice(1)];
    await expect(translateResume(content(), "en")).rejects.toThrow("字段标识或唯一性不匹配");
  });
}

for (const [source, translated, wrongUnit] of [
  ["持续 3 年。", "Lasted 3 years.", "Lasted 3 months."],
  ["持续 3 个月。", "Lasted 3 months.", "Lasted 3 years."],
  ["持续 3 周。", "Lasted 3 weeks.", "Lasted 3 days."],
  ["持续 3 天。", "Lasted 3 days.", "Lasted 3 weeks."],
  ["距离 3 千米。", "Distance of 3 km.", "Distance of 3 m."],
  ["距离 3 米。", "Distance of 3 meters.", "Distance of 3 million meters."],
] as const) {
  test(`preserves translated duration or distance: ${source}`, async () => {
    const input = content();
    input.resume.summary = source;
    mutate = (items) => changeField(items, "resume.summary", translated);
    expect((await translateResume(input, "en")).resume.summary).toBe(translated);
    const english = englishContent();
    english.resume.summary = translated;
    mutate = (items) => changeField(items, "resume.summary", source);
    expect((await translateResume(english, "zh")).resume.summary).toBe(source);
  });
  test(`rejects changed duration or distance: ${source}`, async () => {
    const input = content();
    input.resume.summary = source;
    mutate = (items) => changeField(items, "resume.summary", wrongUnit);
    await expect(translateResume(input, "en")).rejects.toThrow("计量单位发生变化");
  });
}

for (const [source, translated] of [
  ["USD 100,000", "100,000美元"], ["US$100,000", "100,000美金"],
  ["100,000 US dollars", "100,000美元"], ["HK$100,000", "100,000港元"],
  ["HKD 100,000", "100,000港币"], ["100,000 Hong Kong dollars", "100,000港元"],
  ["EUR 100,000", "100,000欧元"], ["€100,000", "100,000欧元"],
  ["100,000 euros", "100,000欧元"], ["GBP 100,000", "100,000英镑"],
  ["£100,000", "100,000英镑"], ["100,000 British pounds", "100,000英镑"],
  ["CNY 100,000", "100,000元"], ["RMB 100,000", "人民币100,000"],
  ["¥100,000", "100,000人民币"], ["100,000 Chinese yuan", "100,000元"],
] as const) {
  test(`accepts equivalent currency names: ${source} to ${translated}`, async () => {
    const input = englishContent();
    input.resume.summary = `Managed a ${source} budget.`;
    mutate = (items) => changeField(items, "resume.summary", `管理${translated}预算。`);
    expect((await translateResume(input, "zh")).resume.summary).toBe(`管理${translated}预算。`);
    const chinese = content();
    chinese.resume.summary = `管理${translated}预算。`;
    mutate = (items) => changeField(items, "resume.summary", input.resume.summary);
    expect((await translateResume(chinese, "en")).resume.summary).toBe(input.resume.summary);
  });
}

for (const currency of ["人民币", "港元", "欧元", "英镑"]) {
  test(`rejects USD changed to ${currency}`, async () => {
    const input = englishContent();
    input.resume.summary = "Managed a USD 100,000 budget.";
    mutate = (items) => changeField(items, "resume.summary", `管理100,000${currency}预算。`);
    await expect(translateResume(input, "zh")).rejects.toThrow("计量单位发生变化");
  });
}

test("does not infer an unspecified dollar currency", async () => {
  const input = content();
  input.resume.summary = "管理$100,000预算。";
  mutate = (items) => changeField(items, "resume.summary", "Managed a USD 100,000 budget.");
  await expect(translateResume(input, "en")).rejects.toThrow("计量单位发生变化");
});

for (const [source, translated] of [
  ["Estimated savings of 20%.", "估计节省20%。"],
  ["Estimated savings of 20%.", "预估节省20%。"],
  ["Simulated savings of 20%.", "仿真节省20%。"],
  ["Forecasted savings of 20%.", "预测节省20%。"],
] as const) {
  test(`accepts qualified results: ${translated}`, async () => {
    const input = englishContent();
    input.resume.summary = source;
    mutate = (items) => changeField(items, "resume.summary", translated);
    expect((await translateResume(input, "zh")).resume.summary).toBe(translated);
    const chinese = content();
    chinese.resume.summary = translated;
    mutate = (items) => changeField(items, "resume.summary", "Potential savings could reach 20%.");
    expect((await translateResume(chinese, "en")).resume.summary).toBe("Potential savings could reach 20%.");
  });
}

test("technical products and structural tech arrays remain unchanged", async () => {
  const input = englishContent();
  input.resume.skills[0].items = ["Python", "SQL", "Spring Boot"];
  input.gaps = ["Docker", "Spring Boot", "Kubernetes"];
  const draft = await translateResume(input, "zh");
  const output = confirmResumeTranslation(draft, choices(draft));
  expect(output.resume.skills[0].items).toEqual(input.resume.skills[0].items);
  expect(output.resume.projects[0].tech).toEqual(input.resume.projects[0].tech);
  expect(output.gaps).toEqual(input.gaps);
  expect(techSeen).toEqual(expect.arrayContaining(["Python", "SQL", "Spring Boot", "Node.js"]));
  expect(instructionsSeen).toContain("Keep technical product names and acronyms");
});

test("legitimate mixed-language prose and technical gaps are not blocked by character heuristics", async () => {
  const input = englishContent();
  input.resume.summary = "使用 Python 分析数据。Built a dashboard for OpenAI.";
  input.gaps = ["Docker experience was not provided"];
  const draft = await translateResume(input, "zh");
  expect(draft.resume.summary).toBe(input.resume.summary);
  expect(draft.gaps).toEqual(input.gaps);
});
