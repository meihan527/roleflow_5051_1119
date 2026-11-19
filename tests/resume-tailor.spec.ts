import { expect, test } from "@playwright/test";
import { restoreResumeFacts } from "../lib/resume/tailor";
import type { ResumeData } from "../lib/types";

function baseResume(): ResumeData {
  return {
    name: "测试候选人",
    headline: "数据分析实习生",
    contact: { email: "candidate@example.com", phone: "", location: "北京", linkedin: "", github: "", website: "" },
    summary: "具备数据分析与开发实践。",
    skills: [{ category: "技能", items: ["数据分析", "Python", "SQL", "C++"] }],
    experience: [
      { company: "甲科技公司", title: "数据分析实习生", start: "2024.06", end: "2024.08", location: "北京", bullets: ["使用 Python 整理数据。"] },
      { company: "乙软件公司", title: "开发实习生", start: "2025.06", end: "2025.08", location: "上海", bullets: ["开发数据导出功能。"] },
    ],
    projects: [],
    education: [{ school: "示例大学", degree: "本科", field: "数学", start: "2021", end: "2025", details: [] }],
    certifications: ["示例证书"],
    achievements: [],
  };
}

const sourceText = "技能：数据分析、Python、SQL、C++。使用 Spring Boot 完成接口开发。";

test("Chinese roles can be reordered and rewritten without mixing their original facts", () => {
  const base = baseResume();
  const proposed = structuredClone(base);
  proposed.experience = [
    { ...base.experience[1], start: "2099", end: "2099", location: "错误地点", bullets: ["实现数据导出接口。"] },
    { ...base.experience[0], bullets: ["使用 Python 完成数据整理。"] },
  ];

  const { resume } = restoreResumeFacts(base, sourceText, proposed);

  expect(resume.experience).toEqual([
    { ...base.experience[1], bullets: ["实现数据导出接口。"] },
    { ...base.experience[0], bullets: ["使用 Python 完成数据整理。"] },
  ]);
});

test("invented Chinese employers are removed and omitted roles are restored", () => {
  const base = baseResume();
  const proposed = structuredClone(base);
  proposed.experience = [
    { ...base.experience[0], company: "虚构公司", title: "虚构职位", bullets: ["不存在的工作。"] },
    base.experience[1],
  ];

  const { resume } = restoreResumeFacts(base, sourceText, proposed);

  expect(resume.experience).toEqual([base.experience[1], base.experience[0]]);
});

test("different roles at the same Chinese employer keep their own facts", () => {
  const base = baseResume();
  base.experience[1].company = base.experience[0].company;
  const proposed = structuredClone(base);
  proposed.experience.reverse();

  expect(restoreResumeFacts(base, sourceText, proposed).resume.experience).toEqual(proposed.experience);
});

test("an ambiguous employer-only match falls back to the original roles", () => {
  const base = baseResume();
  base.experience[1].company = base.experience[0].company;
  const proposed = structuredClone(base);
  proposed.experience = [{ ...base.experience[0], title: "负责人", bullets: ["无法确认属于哪段经历。"] }];

  const { resume, changes } = restoreResumeFacts(base, sourceText, proposed);

  expect(resume.experience).toEqual(base.experience);
  expect(changes.some((change) => change.section === "Experience")).toBe(true);
});

test("a unique employer match still restores the original title and dates", () => {
  const base = baseResume();
  const proposed = structuredClone(base);
  proposed.experience[0] = { ...base.experience[0], title: "分析员", start: "2099", bullets: ["整理分析数据。"] };

  const { resume } = restoreResumeFacts(base, sourceText, proposed);

  expect(resume.experience[0]).toEqual({ ...base.experience[0], bullets: ["整理分析数据。"] });
});

test("repeated roles at one employer are distinguished by their original dates", () => {
  const base = baseResume();
  base.experience[1] = { ...base.experience[0], start: "2025.06", end: "2025.08", bullets: ["第二段实习。"] };
  const proposed = structuredClone(base);
  proposed.experience.reverse();

  expect(restoreResumeFacts(base, sourceText, proposed).resume.experience).toEqual(proposed.experience);
});

test("repeated roles with ambiguous dates are preserved rather than merged", () => {
  const base = baseResume();
  base.experience[1] = { ...base.experience[0], start: "2025.06", end: "2025.08", bullets: ["第二段实习。"] };
  const proposed = structuredClone(base);
  proposed.experience = [{ ...base.experience[0], start: "2099", end: "2099", bullets: ["来源不明。"] }];

  expect(restoreResumeFacts(base, sourceText, proposed).resume.experience).toEqual(base.experience);
});

test("duplicated model roles do not replace a different original role", () => {
  const base = baseResume();
  const proposed = structuredClone(base);
  proposed.experience = [base.experience[0], base.experience[0]];

  expect(restoreResumeFacts(base, sourceText, proposed).resume.experience).toEqual(base.experience);
});

test("blank or punctuation-only employer names cannot match original roles", () => {
  const base = baseResume();
  base.experience[0].company = "";
  const proposed = structuredClone(base);
  proposed.experience = [{ ...base.experience[0], company: "---", bullets: ["没有可核对的公司名。"] }];

  expect(restoreResumeFacts(base, sourceText, proposed).resume.experience).toEqual(base.experience);
});

test("English casing and full-width characters still match without changing source identity", () => {
  const base = baseResume();
  base.experience[0].company = "Example Tech";
  base.experience[0].title = "Software Intern";
  const proposed = structuredClone(base);
  proposed.experience[0].company = "Ｅｘａｍｐｌｅ Ｔｅｃｈ";
  proposed.experience[0].title = "software intern";
  proposed.experience[0].bullets = ["Implemented the export endpoint."];

  expect(restoreResumeFacts(base, sourceText, proposed).resume.experience[0]).toEqual({
    ...base.experience[0], bullets: ["Implemented the export endpoint."],
  });
});

test("Chinese and mixed-language skills must be present in the source", () => {
  const base = baseResume();
  const proposed = structuredClone(base);
  proposed.skills = [{ category: "技能", items: ["数据分析", "机器学习", "Python", "SQL", "C++", "Spring Boot", "---", ""] }];

  const { resume, changes } = restoreResumeFacts(base, sourceText, proposed);

  expect(resume.skills).toEqual([{ category: "技能", items: ["数据分析", "Python", "SQL", "C++", "Spring Boot"] }]);
  expect(changes).toContainEqual(expect.objectContaining({ section: "Skills", change: expect.stringContaining("机器学习") }));
});

test("normalization cannot join separate Chinese skills into a new skill", () => {
  const base = baseResume();
  base.skills = [{ category: "技能", items: ["数据", "分析"] }];
  const proposed = structuredClone(base);
  proposed.skills = [{ category: "技能", items: ["数据分析", "数据", "分析"] }];

  expect(restoreResumeFacts(base, "数据、分析", proposed).resume.skills[0].items).toEqual(["数据", "分析"]);
});

test("English skill fragments and schema property names are not evidence", () => {
  const base = baseResume();
  base.skills = [{ category: "Technical Skills", items: ["JavaScript", "MySQL", "C++", "Node.js"] }];
  const proposed = structuredClone(base);
  proposed.skills = [{ category: "Skills", items: ["Java", "SQL", "C", "js", "category", "items", "Technical", "JavaScript", "MySQL", "C++", "Node.js"] }];

  expect(restoreResumeFacts(base, "Used JavaScript, MySQL, C++ and Node.js.", proposed).resume.skills[0].items)
    .toEqual(["JavaScript", "MySQL", "C++", "Node.js"]);
});

test("full-width skills and English tokens next to Chinese text or punctuation are supported", () => {
  const base = baseResume();
  base.skills = [];
  const proposed = structuredClone(base);
  proposed.skills = [{ category: "技能", items: ["Ｐｙｔｈｏｎ", "C++", "C#", ".NET", "SQL", "PyTorch", "数据分析"] }];

  expect(restoreResumeFacts(base, "使用Python完成数据分析，使用Ｃ＋＋、C#、.NET；使用 SQL。Used PyTorch.", proposed).resume.skills)
    .toEqual(proposed.skills);
});

test("unsupported skill groups are removed", () => {
  const base = baseResume();
  const proposed = structuredClone(base);
  proposed.skills = [{ category: "无依据技能", items: ["机器学习", "项目管理"] }];

  expect(restoreResumeFacts(base, sourceText, proposed).resume.skills).toEqual([]);
});

test("identity and education are restored without mutating either input", () => {
  const base = baseResume();
  const proposed = structuredClone(base);
  proposed.name = "错误姓名";
  proposed.contact.email = "other@example.com";
  proposed.education = [];
  proposed.certifications = ["虚构证书"];
  const originalBase = structuredClone(base);
  const originalProposed = structuredClone(proposed);

  const { resume } = restoreResumeFacts(base, sourceText, proposed);

  expect(resume.name).toBe(base.name);
  expect(resume.contact).toEqual(base.contact);
  expect(resume.education).toEqual(base.education);
  expect(resume.certifications).toEqual(base.certifications);
  expect(base).toEqual(originalBase);
  expect(proposed).toEqual(originalProposed);
});
