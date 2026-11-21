import { GROUNDING_RULES, structured } from "../ai";
import type { Job, ResumeData, ResumeDirection } from "../types";
import { directionInstructions } from "./directions";
import { restoreResumeFacts } from "./facts";
import { tailorSchema } from "./schema";
import { translateResumeToChinese, translateResumeWithReview } from "./translate";
import { resolveResumeLanguage } from "./language";

export async function tailorResume(base: ResumeData, resumeText: string, job?: Job, direction: ResumeDirection = "general") {
  const outputLanguage = resolveResumeLanguage(base, resumeText, job, direction);
  const out = await structured({
    schema: tailorSchema,
    name: "tailored_resume",
    effort: "medium",
    instructions: `${job ? "You tailor a candidate's resume to one specific job." : "You improve the presentation of a candidate's resume for their chosen application direction, without assuming a specific job."}
${GROUNDING_RULES}
Priority: verified resume facts first, explicit job requirements second (when supplied), direction preferences last.
DIRECTION PREFERENCE: ${directionInstructions[direction]}
OUTPUT LANGUAGE: ${outputLanguage === "en" ? "English" : "Simplified Chinese"}. ${job ? "The job description language determines the final resume language and takes precedence over direction preferences." : "The application direction and source resume determine the final language."}
LANGUAGE STAGES: This is the source-language tailoring stage. Keep all resume fields in their original language so source facts can be validated. A separate faithful translation step will produce the required output language after validation. Write the cover letter in ${outputLanguage === "en" ? "English" : "Simplified Chinese"}; write the internal change log and gaps in the original resume language.
Allowed edits:
- Rewrite the summary/headline to foreground relevant existing experience.
- Reorder items and bullets so relevant evidence comes first; rephrase using job terminology only where it truthfully describes the same work.
- Reorder and regroup skills; drop clearly irrelevant ones. Only list skills present in the original resume.
- Trim weak or irrelevant bullets to keep the resume concise without losing important qualifications.
Not allowed: adding employers, roles, dates, degrees, certifications, metrics, tools or responsibilities not in the original. Keep employer names, job titles, dates and schools exactly as written.
${job ? "Write a cover letter grounded in the resume and this job. Include genuinely unsupported job requirements in gaps." : 'No target job was supplied. Return cover_letter as an empty string and gaps as an empty array. Do not invent a company, job description or job-specific requirements.'}`,
    input: `${job ? `JOB\nTitle: ${job.title}\nCompany: ${job.company}\nLocation: ${job.location}\nDescription:\n${(job.description || "").slice(0, 12000)}` : "NO TARGET JOB: produce a direction-based resume only."}

ORIGINAL RESUME (structured JSON)
${JSON.stringify(base)}

ORIGINAL RESUME (raw text, for fact checking)
${resumeText.slice(0, 15000)}`,
  });
  const result = restoreResumeFacts(base, out.resume, resumeText, out.changes);
  const translated = outputLanguage === "en"
    ? await translateResumeWithReview(result.resume)
    : { resume: await translateResumeToChinese(result.resume), translationReviews: [] };
  return { ...result, ...translated, outputLanguage, coverLetter: job ? out.cover_letter : "", gaps: job ? out.gaps : [] };
}
