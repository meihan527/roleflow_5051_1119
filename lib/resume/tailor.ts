import { GROUNDING_RULES, structured } from "../ai";
import type { Job, ResumeChange, ResumeData } from "../types";
import { tailorSchema } from "./schema";

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}+#.]/gu, "");
const skillText = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();

// The model rewrites; code restores facts (identity, employers, dates, education) and drops untraceable skills.
export async function tailorResume(base: ResumeData, resumeText: string, job: Job) {
  const out = await structured({
    schema: tailorSchema,
    name: "tailored_resume",
    effort: "medium",
    instructions: `You tailor a candidate's resume to one specific job.
${GROUNDING_RULES}
Allowed edits:
- Rewrite the summary/headline to foreground experience relevant to this job.
- Reorder sections' items and bullets so the most relevant come first; rephrase bullets to use the job's terminology where it truthfully describes the same work.
- Reorder and regroup skills; drop clearly irrelevant ones. Only list skills that appear in the original resume.
- Trim weak or irrelevant bullets to keep the resume to roughly one page of content.
Not allowed: adding employers, roles, dates, degrees, certifications, metrics, tools or responsibilities that are not in the original. Keep employer names, job titles, dates and schools exactly as written.`,
    input: `JOB
Title: ${job.title}
Company: ${job.company}
Location: ${job.location}
Description:
${(job.description || "").slice(0, 12000)}

ORIGINAL RESUME (structured JSON)
${JSON.stringify(base)}

ORIGINAL RESUME (raw text, for fact checking)
${resumeText.slice(0, 15000)}`,
  });

  const { resume, changes } = restoreResumeFacts(base, resumeText, out.resume);
  return { resume, changes: [...out.changes, ...changes], coverLetter: out.cover_letter, gaps: out.gaps };
}

export function restoreResumeFacts(base: ResumeData, resumeText: string, proposed: ResumeData) {
  const resume = { ...proposed };
  const changes: ResumeChange[] = [];

  resume.name = base.name;
  resume.contact = base.contact;

  const originals = base.experience.map((original, index) => ({ original, index }));
  const matched = new Set<number>();
  resume.experience = proposed.experience.flatMap((entry) => {
    const company = norm(entry.company);
    const title = norm(entry.title);
    const byCompany = /[\p{L}\p{N}]/u.test(company)
      ? originals.filter(({ original }) => norm(original.company) === company)
      : [];
    let candidates = byCompany.filter(({ original }) => title && norm(original.title) === title);
    if (!candidates.length && byCompany.length === 1) candidates = byCompany;
    // Repeated roles need matching dates; employer-only matches must never pick between multiple roles.
    if (candidates.length > 1)
      candidates = candidates.filter(({ original }) => norm(original.start) === norm(entry.start) && norm(original.end) === norm(entry.end));
    if (candidates.length !== 1 || matched.has(candidates[0].index)) return [];
    const { original, index } = candidates[0];
    matched.add(index);
    return [{ ...original, bullets: entry.bullets }];
  });
  const discarded = proposed.experience.length - resume.experience.length;
  const restored = originals.filter(({ index }) => !matched.has(index));
  resume.experience.push(...restored.map(({ original }) => original));
  if (discarded || restored.length)
    changes.push({
      section: "Experience",
      change: `Discarded ${discarded} unmatched or duplicate entries; restored ${restored.length} original entries`,
      reason: "Guardrail: each rewritten role must match one original role unambiguously",
    });

  resume.education = base.education;
  resume.certifications = base.certifications;

  const source = skillText(resumeText);
  const originalSkills = new Set(base.skills.flatMap((group) => group.items.map(skillText)));
  const dropped: string[] = [];
  resume.skills = proposed.skills
    .map((g) => ({
      category: g.category,
      items: g.items.filter((s) => {
        const skill = skillText(s);
        const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // Latin tokens need boundaries (Java != JavaScript); Chinese phrases have no word separators.
        const prefix = /^[\p{Script=Latin}\p{N}.+#]/u.test(skill) ? "(?<![\\p{Script=Latin}\\p{N}_+#.])" : "";
        const suffix = /[\p{Script=Latin}\p{N}.+#]$/u.test(skill) ? "(?![\\p{Script=Latin}\\p{N}_+#]|\\.[\\p{Script=Latin}\\p{N}])" : "";
        const ok = /[\p{L}\p{N}]/u.test(skill)
          && (originalSkills.has(skill) || new RegExp(`${prefix}${escaped}${suffix}`, "u").test(source));
        if (!ok) dropped.push(s);
        return ok;
      }),
    }))
    .filter((g) => g.items.length);
  if (dropped.length)
    changes.push({
      section: "Skills",
      change: `Removed ${dropped.join(", ")}`,
      reason: "Guardrail: not found in your original resume",
    });

  return { resume, changes };
}
