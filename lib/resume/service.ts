import { createHash, randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { UserFacingError } from "../ai";
import { dataPath } from "../config";
import { addResumeVersion, getProfile, getResumeVersion, resumeFilePath, saveProfile } from "../store";
import type { Job, ResumeLanguage, ResumeTailorDraft, ResumeTemplateId, ResumeVersion } from "../types";
import { confirmResumeTranslation, type TailoredContent, type TranslatedContent } from "./translate";
import { extractResumeText, structureResume } from "./parse";
import { renderCoverLetterPdf, renderResumePdf } from "./render";
import { tailorResume } from "./tailor";
import { resumeTemplates } from "./templates";

const MAX_BYTES = 8 * 1024 * 1024;
const safe = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "Resume";

export async function uploadResume(buffer: Buffer, fileName: string, mimeType: string) {
  if (buffer.length > MAX_BYTES) throw new UserFacingError("That file is larger than 8 MB.");
  const text = await extractResumeText(buffer, fileName);
  const resume = await structureResume(text);

  const id = randomUUID();
  const ext = path.extname(fileName).toLowerCase();
  // Employers see this file name, so it stays clean; the folder makes it unique.
  const stored = `${id}/${safe(resume.name || path.basename(fileName, ext))}_Resume${ext}`;
  await fs.mkdir(path.dirname(resumeFilePath(stored)), { recursive: true });
  await fs.writeFile(resumeFilePath(stored), buffer);

  const version: ResumeVersion = {
    id,
    kind: "original",
    label: `Your resume (${fileName})`,
    fileName: stored,
    mimeType,
    createdAt: new Date().toISOString(),
  };
  await addResumeVersion(version);

  const profile = await getProfile();
  profile.resume = resume;
  profile.resumeText = text;
  profile.originalResumeId = id;
  await saveProfile(profile);
  return { profile, version };
}

type StoredDraft = {
  draft: ResumeTailorDraft;
  job: Pick<Job, "id" | "company" | "title">;
  content: TranslatedContent;
  sourceFingerprint: string;
  expiresAt: number;
};
const confirmationTasks = new Map<string, Promise<unknown>>();
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function requireCurrentSource(sourceResumeId: string | null, sourceFingerprint: string) {
  const profile = await getProfile();
  if (profile.originalResumeId !== sourceResumeId || fingerprint(profile.resume) !== sourceFingerprint) {
    throw new UserFacingError("原始简历或个人信息已更换，请基于新资料重新生成。");
  }
}

async function saveTailoredVersion(
  job: Pick<Job, "id" | "company" | "title">, templateId: ResumeTemplateId, sourceResumeId: string | null,
  sourceFingerprint: string, out: TailoredContent, outputLanguage: ResumeLanguage,
  id: string = randomUUID(), confirmationFingerprint?: string,
) {
  const fileName = `${id}/${safe(out.resume.name)}_Resume.pdf`;
  const coverLetterFile = `${id}/${safe(out.resume.name)}_Cover_Letter.pdf`;
  const renderStart = performance.now();
  const rendered = await Promise.allSettled([
    renderResumePdf(out.resume, resumeFilePath(fileName), templateId, outputLanguage),
    renderCoverLetterPdf(out.resume, out.coverLetter, resumeFilePath(coverLetterFile), outputLanguage),
  ]);
  for (const result of rendered) if (result.status === "rejected") throw result.reason;
  console.info("[resume:timing]", { renderMs: Math.round(performance.now() - renderStart) });
  await requireCurrentSource(sourceResumeId, sourceFingerprint);
  const version: ResumeVersion = {
    id, kind: "tailored", jobId: job.id, templateId, outputLanguage, confirmationFingerprint,
    sourceResumeId: sourceResumeId ?? undefined,
    label: `Tailored for ${job.company} — ${job.title} · ${resumeTemplates[templateId].label} · ${outputLanguage === "zh" ? "中文" : "English"}`,
    fileName, mimeType: "application/pdf", createdAt: new Date().toISOString(),
    changes: out.changes, coverLetter: out.coverLetter, coverLetterFile,
  };
  await addResumeVersion(version);
  return { version, gaps: out.gaps, resume: out.resume };
}

export async function prepareTailorForJob(job: Job, templateId: ResumeTemplateId = "general") {
  const profile = await getProfile();
  if (!profile.resume) throw new UserFacingError("Upload your resume first.");
  if (!job.description) throw new UserFacingError("This job has no description to tailor against.");
  const sourceFingerprint = fingerprint(profile.resume);
  const out = await tailorResume(profile.resume, profile.resumeText, job, templateId);
  await requireCurrentSource(profile.originalResumeId, sourceFingerprint);
  if (!out.review.length) return saveTailoredVersion(job, templateId, profile.originalResumeId, sourceFingerprint, out, out.outputLanguage);
  if (!profile.originalResumeId) throw new UserFacingError("请重新上传原始简历后再生成译文。");
  const draft: ResumeTailorDraft = {
    id: randomUUID(), templateId, outputLanguage: out.outputLanguage,
    sourceResumeId: profile.originalResumeId, review: out.review,
  };
  const stored: StoredDraft = {
    draft, job: { id: job.id, company: job.company, title: job.title }, content: out, sourceFingerprint,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  };
  await fs.mkdir(dataPath("resume-drafts"), { recursive: true });
  await fs.writeFile(dataPath("resume-drafts", `${draft.id}.json`), JSON.stringify(stored), { flag: "wx" });
  return { draft };
}

export async function tailorForJob(job: Job, templateId: ResumeTemplateId = "general") {
  const result = await prepareTailorForJob(job, templateId);
  if ("draft" in result) throw new UserFacingError("请先在岗位面板确认译名，再使用此简历投递。");
  return result;
}

export function confirmTailorForJob(jobId: string, templateId: ResumeTemplateId, draftId: string, confirmations: { id: string; text: string }[]) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(draftId)) {
    throw new UserFacingError("无效的译名确认草稿。");
  }
  const file = dataPath("resume-drafts", `${draftId}.json`);
  const previous = confirmationTasks.get(file) ?? Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    const json = await fs.readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") throw new UserFacingError("译名确认草稿不存在，请重新生成。");
      throw error;
    });
    const stored = JSON.parse(json) as StoredDraft;
    const { draft, job, content } = stored;
    if (job.id !== jobId || draft.templateId !== templateId || draft.id !== draftId) {
      throw new UserFacingError("草稿与当前岗位或模板不匹配，请重新生成。");
    }
    await requireCurrentSource(draft.sourceResumeId, stored.sourceFingerprint);
    if (stored.expiresAt < Date.now()) throw new UserFacingError("译名确认草稿已过期，请重新生成。");
    const confirmed = confirmResumeTranslation(content, confirmations);
    const confirmationFingerprint = fingerprint(confirmations.map(({ id, text }) => ({ id, text: text.trim() })).sort((a, b) => a.id.localeCompare(b.id)));
    const existing = await getResumeVersion(draft.id);
    if (existing) {
      if (existing.confirmationFingerprint !== confirmationFingerprint) {
        throw new UserFacingError("此草稿已按另一组译名生成 PDF，请重新生成后修改，避免使用旧译名。");
      }
      return { version: existing, gaps: confirmed.gaps };
    }
    return saveTailoredVersion(job, templateId, draft.sourceResumeId, stored.sourceFingerprint, confirmed, draft.outputLanguage, draft.id, confirmationFingerprint);
  });
  confirmationTasks.set(file, task);
  const cleanup = () => { if (confirmationTasks.get(file) === task) confirmationTasks.delete(file); };
  void task.then(cleanup, cleanup);
  return task;
}
