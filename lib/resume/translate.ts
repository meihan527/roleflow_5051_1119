import { z } from "zod";
import { GROUNDING_RULES, structured, UserFacingError } from "../ai";
import type { ResumeData, TranslationReview } from "../types";
import { detectJobLanguage } from "./language";

const translationSchema = z.object({
  translations: z.array(z.object({ id: z.string(), text: z.string() })),
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function englishResumeDate(value: string) {
  const date = value.normalize("NFKC").trim();
  if (/^(至今|现在|目前|今)$/u.test(date)) return "Present";
  const match = date.match(/^(\d{4})年\s*(?:(\d{1,2})月\s*(?:(\d{1,2})[日号]?)?)?$/u);
  if (!match) return value;
  const [, year, month, day] = match;
  if (!month) return year;
  if (Number(month) < 1 || Number(month) > 12 || (day && (Number(day) < 1 || Number(day) > 31))) return value;
  return day ? `${MONTHS[Number(month) - 1]} ${Number(day)}, ${year}` : `${MONTHS[Number(month) - 1]} ${year}`;
}

export function chineseResumeDate(value: string) {
  const date = value.normalize("NFKC").trim();
  if (/^(present|current|currently|now|ongoing)$/i.test(date)) return "至今";
  const named = date.match(/^([a-z]+)\.?\s+(?:(\d{1,2}),?\s+)?(\d{4})$/i);
  if (named) {
    const month = MONTHS.findIndex((item) => item.toLowerCase() === named[1].slice(0, 3).toLowerCase()) + 1;
    const day = named[2] ? Number(named[2]) : undefined;
    if (month && (!day || day <= 31)) return `${named[3]}年${month}月${day ? `${day}日` : ""}`;
  }
  const numeric = date.match(/^(\d{4})(?:[-/.](\d{1,2}))?$/);
  if (numeric) {
    if (!numeric[2]) return `${numeric[1]}年`;
    const month = Number(numeric[2]);
    if (month >= 1 && month <= 12) return `${numeric[1]}年${month}月`;
  }
  return value;
}

function reviewReason(id: string) {
  if (id === "name") return "姓名的拼音或惯用英文名需要本人确认。";
  if (/^experience\.\d+\.company$/.test(id)) return "尚未确认公司的官方英文名称，请核对或修改译法。";
  if (/^experience\.\d+\.title$/.test(id)) return "职位英文名称可能有多种表述，请确认与原岗位一致。";
  if (/^education\.\d+\.school$/.test(id)) return "尚未确认学校的官方英文名称，请核对或修改译法。";
  if (/^education\.\d+\.(degree|field)$/.test(id)) return "学位或专业名称的正式英文表述需要核对。";
  if (/^projects\.\d+\.name$/.test(id)) return "项目名称可能有约定译法，请核对或修改。";
  if (/^certifications\.\d+$/.test(id)) return "证书名称的正式英文表述尚未确认。";
  if (/^achievements\.\d+$/.test(id)) return "荣誉名称可能有正式英文表述，请核对或修改。";
  return undefined;
}

/** Translate the already-validated resume without allowing the model to rebuild its structure. */
export async function translateResumeWithReview(source: ResumeData): Promise<{ resume: ResumeData; translationReviews: TranslationReview[] }> {
  const resume = structuredClone(source);
  const slots = new Map<string, { text: string; set: (text: string) => void }>();
  const add = (id: string, text: string, set: (text: string) => void) => {
    if (!text.trim() || !/\p{Script=Han}/u.test(text)) return;
    slots.set(id, { text, set });
  };
  add("name", source.name, (text) => { resume.name = text; });
  add("headline", source.headline, (text) => { resume.headline = text; });
  add("summary", source.summary, (text) => { resume.summary = text; });
  add("contact.location", source.contact.location, (text) => { resume.contact.location = text; });
  source.skills.forEach((group, i) => {
    add(`skills.${i}.category`, group.category, (text) => { resume.skills[i].category = text; });
    group.items.forEach((skill, j) => add(`skills.${i}.items.${j}`, skill, (text) => { resume.skills[i].items[j] = text; }));
  });
  source.experience.forEach((entry, i) => {
    for (const field of ["company", "title", "location"] as const)
      add(`experience.${i}.${field}`, entry[field], (text) => { resume.experience[i][field] = text; });
    entry.bullets.forEach((bullet, j) => add(`experience.${i}.bullets.${j}`, bullet, (text) => { resume.experience[i].bullets[j] = text; }));
    resume.experience[i].start = englishResumeDate(entry.start);
    resume.experience[i].end = englishResumeDate(entry.end);
  });
  source.projects.forEach((entry, i) => {
    add(`projects.${i}.name`, entry.name, (text) => { resume.projects[i].name = text; });
    entry.tech.forEach((tech, j) => add(`projects.${i}.tech.${j}`, tech, (text) => { resume.projects[i].tech[j] = text; }));
    entry.bullets.forEach((bullet, j) => add(`projects.${i}.bullets.${j}`, bullet, (text) => { resume.projects[i].bullets[j] = text; }));
  });
  source.education.forEach((entry, i) => {
    for (const field of ["school", "degree", "field"] as const)
      add(`education.${i}.${field}`, entry[field], (text) => { resume.education[i][field] = text; });
    entry.details.forEach((detail, j) => add(`education.${i}.details.${j}`, detail, (text) => { resume.education[i].details[j] = text; }));
    resume.education[i].start = englishResumeDate(entry.start);
    resume.education[i].end = englishResumeDate(entry.end);
  });
  source.certifications.forEach((item, i) => add(`certifications.${i}`, item, (text) => { resume.certifications[i] = text; }));
  source.achievements.forEach((item, i) => add(`achievements.${i}`, item, (text) => { resume.achievements[i] = text; }));
  if (!slots.size) return { resume, translationReviews: [] };

  const output = await structured({
    schema: translationSchema,
    name: "english_resume_translation",
    effort: "low",
    instructions: `Translate each supplied resume text field faithfully into professional English. This is a translation step, not another rewrite or tailoring pass.
${GROUNDING_RULES}
- Return exactly one {id, text} for every supplied field ID. Never add, omit or duplicate IDs. Keep each translation with its own source ID; never transfer facts between fields.
- Translate all Chinese prose, locations, qualifications and skill descriptions into English. The returned text must not contain Chinese characters.
- Keep existing English names and wording when already suitable. For a Chinese personal name without an English form, use Pinyin transliteration; never invent an English given name.
- Use a supplied English company or school name when present. Otherwise use a faithful descriptive translation or transliteration; do not claim it is an official English name or invent a different institution.
- Preserve every metric, responsibility, seniority level and achievement exactly in meaning. Do not add language proficiency, international experience, credentials, technologies or claims.
- Keep technical identifiers such as Java, MySQL, C++, C#, API and product names exactly. No Markdown wrappers, explanations or new resume sections.`,
    input: JSON.stringify({ fields: [...slots].map(([id, slot]) => ({ id, text: slot.text })) }),
  });
  const seen = new Set<string>();
  const translated = new Map<string, string>();
  if (output.translations.length !== slots.size)
    throw new UserFacingError("英文简历翻译字段不完整，请重新生成。");
  for (const translation of output.translations) {
    const slot = slots.get(translation.id);
    if (!slot || seen.has(translation.id) || !translation.text.trim() || /\p{Script=Han}/u.test(translation.text))
      throw new UserFacingError("英文简历翻译结果未通过完整性校验，请重新生成。");
    seen.add(translation.id);
    const text = translation.text.trim();
    translated.set(translation.id, text);
    slot.set(text);
  }
  // Proper-name translations are suggestions until the user verifies the official
  // or preferred wording. Collect them deterministically rather than trusting a
  // model confidence score that might silently mark an invented name as certain.
  const translationReviews = [...slots].flatMap(([id, slot]) => {
    const reason = reviewReason(id);
    return reason ? [{ id, source: slot.text, suggested: translated.get(id)!, reason }] : [];
  });
  return { resume, translationReviews };
}

// Compatibility for translation-only callers. Generation uses the review-aware API.
export async function translateResumeToEnglish(source: ResumeData): Promise<ResumeData> {
  return (await translateResumeWithReview(source)).resume;
}

const TECHNICAL_IDENTIFIER = /^(?:C\+\+|C#|\.NET|Java|JavaScript|TypeScript|Python|Go|Golang|Rust|Kotlin|Scala|Swift|PHP|Ruby|SQL|MySQL|PostgreSQL|MongoDB|Redis|Oracle|Spring(?:\s?Boot)?|Vue(?:\.js)?|React(?:\.js)?|Node(?:\.js)?|Angular|Docker|Kubernetes|Kafka|Git|Linux|Windows|PyTorch|TensorFlow|Pandas|NumPy|MATLAB|Excel|Power\s?BI|Tableau|AWS|Azure|GCP)(?:\s*[\d.]+)?$/i;
const TECHNICAL_ACRONYM = /^(?:API|APIs|HTTP|HTTPS|REST|JSON|XML|HTML|CSS|CI\/CD|SAC|LAMOST|GSE|GPA|IELTS(?:\s*[\d.]+)?)$/i;

/** Translate English prose while retaining canonical names and technical identifiers. */
export async function translateResumeToChinese(source: ResumeData): Promise<ResumeData> {
  const resume = structuredClone(source);
  const slots = new Map<string, { text: string; set: (text: string) => void }>();
  const add = (id: string, text: string, set: (text: string) => void) => {
    if (!text.trim() || !/[a-z]/i.test(text) || TECHNICAL_IDENTIFIER.test(text) || TECHNICAL_ACRONYM.test(text)) return;
    if (/\p{Script=Han}/u.test(text) && detectJobLanguage(text) === "zh-CN") return;
    slots.set(id, { text, set });
  };
  // English personal and institution names remain authoritative: never invent
  // a Chinese legal name or translate someone's name without their own wording.
  add("headline", source.headline, (text) => { resume.headline = text; });
  add("summary", source.summary, (text) => { resume.summary = text; });
  add("contact.location", source.contact.location, (text) => { resume.contact.location = text; });
  source.skills.forEach((group, i) => {
    add(`skills.${i}.category`, group.category, (text) => { resume.skills[i].category = text; });
    group.items.forEach((skill, j) => add(`skills.${i}.items.${j}`, skill, (text) => { resume.skills[i].items[j] = text; }));
  });
  source.experience.forEach((entry, i) => {
    add(`experience.${i}.title`, entry.title, (text) => { resume.experience[i].title = text; });
    add(`experience.${i}.location`, entry.location, (text) => { resume.experience[i].location = text; });
    entry.bullets.forEach((bullet, j) => add(`experience.${i}.bullets.${j}`, bullet, (text) => { resume.experience[i].bullets[j] = text; }));
    resume.experience[i].start = chineseResumeDate(entry.start);
    resume.experience[i].end = chineseResumeDate(entry.end);
  });
  source.projects.forEach((entry, i) => {
    add(`projects.${i}.name`, entry.name, (text) => { resume.projects[i].name = text; });
    entry.tech.forEach((tech, j) => add(`projects.${i}.tech.${j}`, tech, (text) => { resume.projects[i].tech[j] = text; }));
    entry.bullets.forEach((bullet, j) => add(`projects.${i}.bullets.${j}`, bullet, (text) => { resume.projects[i].bullets[j] = text; }));
  });
  source.education.forEach((entry, i) => {
    for (const field of ["degree", "field"] as const)
      add(`education.${i}.${field}`, entry[field], (text) => { resume.education[i][field] = text; });
    entry.details.forEach((detail, j) => add(`education.${i}.details.${j}`, detail, (text) => { resume.education[i].details[j] = text; }));
    resume.education[i].start = chineseResumeDate(entry.start);
    resume.education[i].end = chineseResumeDate(entry.end);
  });
  source.certifications.forEach((item, i) => add(`certifications.${i}`, item, (text) => { resume.certifications[i] = text; }));
  source.achievements.forEach((item, i) => add(`achievements.${i}`, item, (text) => { resume.achievements[i] = text; }));
  if (!slots.size) return resume;
  const output = await structured({
    schema: translationSchema,
    name: "chinese_resume_translation",
    effort: "low",
    instructions: `Translate the supplied resume prose into concise, faithful Simplified Chinese. This is translation only, after source facts have been validated.
${GROUNDING_RULES}
- Return exactly one {id, text} for every supplied field ID. Do not omit, repeat or add IDs; keep each translation tied to its source field.
- Translate the prose, job titles, qualifications and skill descriptions into Chinese. Preserve the meaning, numbers, responsibilities and seniority; do not add claims or reinterpret a qualification.
- Keep technology/product identifiers such as Java, C++, MySQL, Python and Spring Boot exactly as supplied inside Chinese prose.
- The candidate's name, company/school names, email, phone, URLs and dates are controlled separately. Do not invent official Chinese names or return extra fields.
- Do not include Markdown, explanations or new sections.`,
    input: JSON.stringify({ fields: [...slots].map(([id, slot]) => ({ id, text: slot.text })) }),
  });
  if (output.translations.length !== slots.size) throw new UserFacingError("中文简历翻译字段不完整，请重新生成。");
  const seen = new Set<string>();
  for (const translation of output.translations) {
    const slot = slots.get(translation.id);
    if (!slot || seen.has(translation.id) || !translation.text.trim() || !/\p{Script=Han}/u.test(translation.text))
      throw new UserFacingError("中文简历翻译结果未通过完整性校验，请重新生成。");
    seen.add(translation.id);
    slot.set(translation.text.trim());
  }
  return resume;
}

function reviewSetter(resume: ResumeData, id: string): ((text: string) => void) | undefined {
  if (id === "name") return (text) => { resume.name = text; };
  const experience = id.match(/^experience\.(0|[1-9]\d*)\.(company|title)$/);
  if (experience) {
    const entry = resume.experience[Number(experience[1])];
    const field = experience[2] as "company" | "title";
    if (entry) return (text) => { entry[field] = text; };
  }
  const project = id.match(/^projects\.(0|[1-9]\d*)\.name$/);
  if (project) {
    const entry = resume.projects[Number(project[1])];
    if (entry) return (text) => { entry.name = text; };
  }
  const education = id.match(/^education\.(0|[1-9]\d*)\.(school|degree|field)$/);
  if (education) {
    const entry = resume.education[Number(education[1])];
    const field = education[2] as "school" | "degree" | "field";
    if (entry) return (text) => { entry[field] = text; };
  }
  const list = id.match(/^(certifications|achievements)\.(0|[1-9]\d*)$/);
  if (list) {
    const entries = resume[list[1] as "certifications" | "achievements"];
    const index = Number(list[2]);
    if (index < entries.length) return (text) => { entries[index] = text; };
  }
  return undefined;
}

/** Apply only the exact server-issued review fields; never follow client-supplied paths. */
export function applyReviewedTranslations(resume: ResumeData, reviews: TranslationReview[], approvals: Record<string, string>): ResumeData {
  const invalid = () => new UserFacingError("请逐项确认全部待核对的英文名称，不能添加其他字段。");
  if (!approvals || typeof approvals !== "object" || Array.isArray(approvals)) throw invalid();
  const expected = new Set(reviews.map((review) => review.id));
  if (expected.size !== reviews.length || Object.keys(approvals).length !== expected.size || Object.keys(approvals).some((id) => !expected.has(id))) throw invalid();
  const result = structuredClone(resume);
  for (const review of reviews) {
    if (!Object.hasOwn(approvals, review.id)) throw invalid();
    const value = approvals[review.id];
    if (typeof value !== "string" || !value.trim() || value.trim().length > 500 || /[\x00-\x1f\x7f]/u.test(value) || /[^\p{Script=Latin}\p{M}\p{N}\p{P}\p{S}\p{Zs}]/u.test(value) || !/\p{Script=Latin}/u.test(value))
      throw new UserFacingError("请为每个待确认名称填写不超过 500 字符的英文译名或拼音，不要输入中文或换行。");
    const set = reviewSetter(result, review.id);
    if (!set) throw invalid();
    set(value.trim());
  }
  return result;
}
