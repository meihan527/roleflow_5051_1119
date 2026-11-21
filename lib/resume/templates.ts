import type { ResumeData, ResumeLanguage, ResumeTemplateId } from "../types";

export type ResumeSection = "summary" | "skills" | "experience" | "projects" | "education" | "activities" | "certifications" | "achievements";

type ResumeTemplate = {
  label: string;
  description: string;
  sections: readonly ResumeSection[];
  titles: Record<ResumeSection, string>;
  instructions: string;
};

const englishTitles: Record<ResumeSection, string> = {
  summary: "Summary",
  skills: "Skills",
  experience: "Experience",
  projects: "Projects",
  education: "Education",
  activities: "Campus & Volunteer Experience",
  certifications: "Certifications",
  achievements: "Achievements",
};

const chineseTitles: Record<ResumeSection, string> = {
  summary: "个人概述",
  skills: "核心技能",
  experience: "实习与工作经历",
  projects: "项目经历",
  education: "教育背景",
  activities: "校园与志愿经历",
  certifications: "资格证书",
  achievements: "荣誉奖项",
};

export const resumeTemplates: Record<ResumeTemplateId, ResumeTemplate> = {
  general: {
    label: "通用",
    description: "保留原有顺序，按 JD 调整经历重点",
    sections: ["summary", "skills", "experience", "projects", "education", "activities", "certifications", "achievements"],
    titles: englishTitles,
    instructions: `Use a neutral professional tone.
     Prioritize evidence relevant to the job without assuming an employer category.
      Keep the original language and structure as much as possible.`,
  },
  "state-owned": {
    label: "央国企",
    description: "突出岗位资格、相关实践、规范执行和协作",
    sections: ["education", "experience", "projects", "activities", "achievements", "certifications", "skills"],
    titles: chineseTitles,
    instructions: `从 JD 提取岗位必备条件和关键词，按原文用词保留。
每条经历按"动词 + 具体事项 + 方法/工具 + 可核实结果"改写，每条不超过两行，
每段经历最多 3 条；数字只能沿用原文，保留单位和口径。
措辞正式具体，可用统筹/组织/落实/协助/对接/保障/优化，不用营销黑话；
技术工作保持技术属性。
职责归属准确："主导/负责"不得降为"协助"，反之亦然。
学历、专业、证书、荣誉如实列出。`,
  },
  "big-tech": {
    label: "大厂",
    description: "突出技术方案、个人贡献和可验证成果",
    sections: ["education", "experience", "projects", "skills", "achievements", "certifications", "activities"],
    titles: chineseTitles,
    instructions: `用简洁、突出行动的语言。强调问题、技术方法、候选人本人的贡献，以及经过验证的成果。
按与职位描述（JD）的相关程度排列项目和经历要点。保留真实使用的技术工具及其局限；不能仅因为 JD 提到了某个工具，就把它加进简历。
校园和志愿活动应简短描述，并与技术项目分开。不要虚构项目规模、用户数量、部署情况、性能提升或领导职责。`,
  },
  multinational: {
    label: "外企",
    description: "简短概述开头，强调岗位能力与个人贡献",
    sections: ["summary", "education", "experience", "projects", "skills", "activities", "achievements", "certifications"],
    titles: { ...englishTitles, experience: "Internship & Work Experience", projects: "Relevant Projects", skills: "Skills & Languages" },
    instructions: `Write a short, evidence-based summary and concise bullets using direct action verbs rather than self-praise.
Use task, action and result to make individual contributions clear. Emphasize cross-team work or language ability only when documented.`,
  },
};

export function resumeTitles(templateId: ResumeTemplateId, outputLanguage: ResumeLanguage): Record<ResumeSection, string> {
  if (outputLanguage === "zh") return chineseTitles;
  return templateId === "multinational" ? resumeTemplates.multinational.titles : englishTitles;
}

export function templateOutputLanguage(templateId: ResumeTemplateId, sourceLanguage: ResumeLanguage): ResumeLanguage {
  if (templateId === "general") return sourceLanguage;
  return templateId === "multinational" ? "en" : "zh";
}

export function inferResumeLanguage(r: ResumeData): ResumeLanguage {
  // Prose is stronger evidence than proper names, contact details or a list of technologies.
  const narrative = [
    r.headline, r.summary,
    ...r.experience.flatMap((e) => e.bullets),
    ...r.projects.flatMap((p) => p.bullets),
    ...r.education.flatMap((e) => e.details),
    ...(r.activities ?? []).flatMap((a) => a.bullets),
    ...r.certifications, ...r.achievements,
  ].join(" ");
  const text = /[\p{Script=Han}\p{Script=Latin}]/u.test(narrative) ? narrative : [
    ...r.experience.map((e) => e.title),
    ...r.projects.map((p) => p.name),
    ...r.education.flatMap((e) => [e.degree, e.field]),
    ...(r.activities ?? []).map((a) => a.title),
    ...r.skills.flatMap((s) => [s.category, ...s.items]),
  ].join(" ");
  // Compare Han characters with Latin words, not letters: tool names should not outweigh Chinese prose.
  const han = text.match(/\p{Script=Han}/gu)?.length ?? 0;
  const latinWords = text.match(/\p{Script=Latin}+/gu)?.length ?? 0;
  return han >= 4 && han >= latinWords ? "zh" : "en";
}

export function templateInstructions(templateId: ResumeTemplateId) {
  const template = resumeTemplates[templateId];
  return `RESUME TEMPLATE: ${template.label}
Fixed section order: ${template.sections.map((key) => template.titles[key]).join(" → ")}.
${template.instructions}
Rewrite in the ORIGINAL source resume's language, including headline, summary and all bullets. Neither template headings nor JD language determines the rewrite language. Template-specific output language is applied only in the later translation stage.
Preserve exact role titles and organization identities from the source during this rewrite; do not translate, rename or change their meaning. Output-language translation happens in a separate, later stage.
The renderer sets section order. Keep information in its correct JSON field; do not move content between fields to imitate layout. Omit unsupported content, and use empty arrays for absent sections.
${template.sections.includes("summary") ? "Keep any summary brief and grounded in the source." : "Leave summary empty; this template has no summary section."}
Use existing quantitative evidence, retaining units, scope and measurement conditions. Simulated or expected results must not become realized business results. If no metric is supplied, give a concrete qualitative description, not an invented number or claim of improved efficiency.
JD requirements and verified facts take priority over general template preferences.`;
}
