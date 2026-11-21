"use client";
import { ArrowUpRight, Bot, Check, ChevronDown, Download, FileText, Gauge, Info, Plus, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { Job, Match, ResumeLanguage, ResumeTailorDraft, ResumeTemplateId, ResumeVersion, TailorResponse } from "@/lib/types";
import { resumeTemplates, templateOutputLanguage } from "@/lib/resume/templates";
import { api, errorText, timeAgo } from "./api";
import { Button, Card, inputCls, Notice, SourceBadge, Spinner } from "./ui";

type Tailored = { version: ResumeVersion; gaps: string[] };
const languageLabels: Record<ResumeLanguage, string> = { zh: "中文", en: "English" };

export function JobPanel({
  job,
  hasResume,
  sourceLanguage,
  versions,
  originalId,
  agentBusy,
  linkedInSignedIn,
  onVersionsChanged,
  onStart,
}: {
  job: Job;
  hasResume: boolean;
  sourceLanguage: ResumeLanguage;
  versions: ResumeVersion[];
  originalId: string | null;
  agentBusy: boolean;
  linkedInSignedIn: boolean;
  onVersionsChanged: () => Promise<void>;
  onStart: (jobId: string, versionId: string, autoSubmit: boolean) => Promise<void>;
}) {
  // The parent keys this panel by job and original resume, discarding local drafts on either change.
  const [detail, setDetail] = useState<Job>(job);
  const [loading, setLoading] = useState(true);
  const [match, setMatch] = useState<Match | null>(null);
  const [matching, setMatching] = useState(false);
  const [tailored, setTailored] = useState<Tailored | null>(null);
  const [tailoring, setTailoring] = useState(false);
  const [draft, setDraft] = useState<ResumeTailorDraft | null>(null);
  const [confirmations, setConfirmations] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const busy = tailoring || confirming;
  const [showDesc, setShowDesc] = useState(false);
  const [showLetter, setShowLetter] = useState(false);
  const [autoSubmit, setAutoSubmit] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [templateId, setTemplateId] = useState<ResumeTemplateId>("general");
  const outputLanguage = templateOutputLanguage(templateId, sourceLanguage);
  const template = resumeTemplates[templateId];

  const matchesSelection = (v: ResumeVersion) => v.kind === "tailored" && v.jobId === job.id
    && v.templateId === templateId && !!originalId && v.sourceResumeId === originalId
    && v.outputLanguage === outputLanguage;
  const existing = versions.find(matchesSelection);
  const currentTailored = tailored && matchesSelection(tailored.version) ? tailored : null;
  // Never offer an older PDF while the replacement is awaiting explicit confirmation.
  const tailoredVersion = draft ? undefined : currentTailored?.version ?? existing;
  const [useTailored, setUseTailored] = useState(true);
  const chosenVersion = useTailored ? tailoredVersion?.id : originalId;
  const missingConfirmation = draft?.review.some((item) => !confirmations[item.id]?.trim());

  const resetTailoredSelection = () => {
    setDraft(null);
    setConfirmations({});
    setTailored(null);
    setShowLetter(false);
    setUseTailored(true);
    setError("");
  };

  const changeTemplate = (id: ResumeTemplateId) => {
    setTemplateId(id);
    resetTailoredSelection();
  };

  const jobId = job.id;
  useEffect(() => {
    let alive = true;
    api<{ job: Job }>(`/api/jobs/${encodeURIComponent(jobId)}`)
      .then(({ job: full }) => alive && setDetail(full))
      .catch((err) => alive && setError(errorText(err)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [jobId]);

  const runMatch = async () => {
    setMatching(true);
    setError("");
    try {
      setMatch((await api<{ match: Match }>(`/api/jobs/${encodeURIComponent(job.id)}/match`, { method: "POST" })).match);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setMatching(false);
    }
  };

  const runTailor = async () => {
    if (busy || draft || starting) return;
    setTailoring(true);
    resetTailoredSelection();
    try {
      const out = await api<TailorResponse>(`/api/jobs/${encodeURIComponent(job.id)}/tailor`, { json: { templateId } });
      if ("draft" in out) {
        setDraft(out.draft);
        setConfirmations(Object.fromEntries(out.draft.review.map((item) => [item.id, item.suggested])));
      } else {
        setTailored(out);
        await onVersionsChanged();
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setTailoring(false);
    }
  };

  const confirmDraft = async () => {
    if (!draft || busy || starting || missingConfirmation) return;
    setConfirming(true);
    setError("");
    try {
      const out = await api<Tailored>(`/api/jobs/${encodeURIComponent(job.id)}/tailor`, {
        json: {
          templateId: draft.templateId,
          draftId: draft.id,
          confirmations: draft.review.map((item) => ({ id: item.id, text: confirmations[item.id].trim() })),
        },
      });
      setTailored(out);
      setDraft(null);
      setConfirmations({});
      setUseTailored(true);
      await onVersionsChanged();
    } catch (err) {
      // Keep both the draft and all edits available when confirmation fails.
      setError(errorText(err));
    } finally {
      setConfirming(false);
    }
  };

  const start = async () => {
    if (!chosenVersion || draft || busy || starting) return;
    setStarting(true);
    setError("");
    try {
      await onStart(job.id, chosenVersion, autoSubmit);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setStarting(false);
    }
  };

  return (
    <Card className="enter lg:sticky lg:top-5 lg:max-h-[calc(100vh-2.5rem)] lg:overflow-y-auto">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <SourceBadge source={detail.source} />
            {detail.postedAt && <span className="text-xs text-muted">Posted {timeAgo(detail.postedAt)}</span>}
          </div>
          <h2 className="mt-2 text-2xl font-semibold leading-tight tracking-tight">{detail.title || "Job posting"}</h2>
          <p className="mt-1 text-sm text-muted">
            {[detail.company, detail.location, detail.employmentType, detail.seniority].filter(Boolean).join(" · ")}
          </p>
        </div>
        <a href={detail.url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-line px-3 py-2 text-sm text-muted hover:border-accent hover:text-accent">
          Open <ArrowUpRight size={14} />
        </a>
      </div>

      {detail.applyNote && (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-paper px-3 py-2 text-xs text-muted">
          <Info size={14} className="mt-0.5 shrink-0" />
          {detail.applyNote}
        </p>
      )}

      {loading ? (
        <div className="mt-5"><Spinner label="Loading the full job description…" /></div>
      ) : detail.description ? (
        <div className="mt-4">
          <button disabled={busy} onClick={() => setShowDesc(!showDesc)} className="flex items-center gap-1 text-sm font-semibold text-accent" aria-expanded={showDesc}>
            Job description <ChevronDown className={`h-4 w-4 transition ${showDesc ? "rotate-180" : ""}`} />
          </button>
          {showDesc && <div className="mt-2 max-h-80 overflow-y-auto whitespace-pre-line rounded-xl bg-paper p-3 text-sm leading-relaxed text-[#45443f]">{detail.description}</div>}
        </div>
      ) : (
        <div className="mt-4"><Notice tone="warn">The description couldn&apos;t be fetched from the server. The agent can still open and apply on the original page.</Notice></div>
      )}

      {error && <div className="mt-4"><Notice tone="error">{error}</Notice></div>}

      {!hasResume && (
        <div className="mt-5"><Notice tone="warn">Upload your resume above to analyze the match, tailor a resume and apply.</Notice></div>
      )}

      <div className="mt-6 border-t border-line pt-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Gauge size={17} className="text-accent" />
            <h3 className="font-semibold">Match analysis</h3>
          </div>
          {!match && (
            <Button variant="secondary" onClick={runMatch} busy={matching} disabled={!hasResume || loading || !detail.description || busy}>
              Analyze
            </Button>
          )}
        </div>
        {match && (
          <div className="enter mt-3">
            <div className="flex items-end gap-3">
              <span className="text-4xl font-semibold tracking-tight text-accent">{match.match_score}</span>
              <span className="mb-1 text-xs text-muted">/ 100 · an estimate, not a verdict</span>
            </div>
            <p className="mt-2 text-sm text-[#45443f]">{match.summary}</p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">Evidence</p>
                {match.matching_evidence.map((x) => (
                  <p key={x} className="mt-1.5 flex gap-1.5 text-sm text-accent-dark"><Check size={15} className="mt-0.5 shrink-0" />{x}</p>
                ))}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">Gaps</p>
                {match.missing_requirements.map((x) => (
                  <p key={x} className="mt-1.5 flex gap-1.5 text-sm text-muted"><Plus size={15} className="mt-0.5 shrink-0" />{x}</p>
                ))}
              </div>
            </div>
            {match.questions_for_user.length > 0 && (
              <div className="mt-3 rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">
                <strong>Worth confirming:</strong> {match.questions_for_user.join(" ")}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-6 border-t border-line pt-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Wand2 size={17} className="text-accent" />
            <h3 className="font-semibold">Tailored resume</h3>
          </div>
          <Button variant="secondary" onClick={runTailor} busy={tailoring} disabled={!hasResume || loading || !detail.description || starting || busy || !!draft}>
            {tailoredVersion ? "Re-tailor" : "Tailor for this job"}
          </Button>
        </div>
        <div className="mt-3 rounded-xl border border-line bg-paper p-3">
          <label htmlFor={`resume-template-${job.id}`} className="text-sm font-semibold">简历结构模板</label>
          <select
            id={`resume-template-${job.id}`}
            className={`${inputCls} mt-2`}
            value={templateId}
            disabled={busy || starting}
            onChange={(event) => changeTemplate(event.target.value as ResumeTemplateId)}
          >
            {Object.entries(resumeTemplates).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}
          </select>
          <p className="mt-2 text-sm text-muted">{template.description}</p>
        </div>
        {busy && <p role="status" className="mt-3 text-sm text-muted">
          {confirming
            ? "正在使用已确认内容生成 PDF，不再调用 AI…"
            : sourceLanguage === outputLanguage
              ? `正在按岗位改写简历与求职信（${languageLabels[sourceLanguage]} → ${languageLabels[outputLanguage]}）并生成 PDF…`
              : `正在按岗位改写简历与求职信并翻译（${languageLabels[sourceLanguage]} → ${languageLabels[outputLanguage]}），随后请确认候选译名…`}
        </p>}
        {draft && (
          <section aria-label="译名确认" className="enter mt-4 grid min-w-0 gap-3">
            <h4 className="font-semibold">确认候选译名 · {languageLabels[sourceLanguage]} → {languageLabels[draft.outputLanguage]}</h4>
            <Notice tone="warn">候选译名，未经官方来源核实；请优先填写官网/证书上的名称，姓名使用本人认可的拼写，确认后才生成PDF</Notice>
            <p className="text-xs text-muted">请核对姓名、公司和教育信息。日期保持不变，不可编辑。草稿 24 小时后过期；取消或切换模板将放弃本次确认。</p>
            <fieldset disabled={busy || starting} className="grid min-w-0 gap-3">
              <legend className="sr-only">原文与候选译名</legend>
              {draft.review.map((item, index) => (
                <div key={item.id} className="min-w-0 rounded-xl border border-line bg-paper p-3">
                  <p className="text-sm font-semibold">{item.label}</p>
                  <div className="mt-2 grid min-w-0 gap-3 sm:grid-cols-2">
                    <div className="min-w-0">
                      <p className="text-xs text-muted">原文</p>
                      <p id={`translation-source-${job.id}-${index}`} className="mt-1 whitespace-pre-wrap break-words text-sm">{item.source}</p>
                    </div>
                    <label className="grid min-w-0 gap-1 text-xs text-muted">
                      <span>{item.label} · 候选译名</span>
                      <textarea
                        className={`${inputCls} min-h-20 resize-y disabled:opacity-55`}
                        rows={2}
                        value={confirmations[item.id] ?? ""}
                        required
                        maxLength={4000}
                        aria-describedby={`translation-source-${job.id}-${index}`}
                        onChange={(event) => setConfirmations((values) => ({
                          ...values,
                          ...Object.fromEntries(draft.review.filter((field) => field.source === item.source).map((field) => [field.id, event.target.value])),
                        }))}
                      />
                    </label>
                  </div>
                </div>
              ))}
            </fieldset>
            <div className="flex flex-wrap gap-2">
              <Button onClick={confirmDraft} busy={confirming} disabled={busy || starting || missingConfirmation}>确认译名并生成 PDF</Button>
              <Button variant="secondary" onClick={resetTailoredSelection} disabled={busy || starting}>取消译名确认</Button>
            </div>
          </section>
        )}
        {!tailoredVersion && !busy && !draft && (
          <p className="mt-2 text-sm text-muted">按岗位改写简历与求职信；跨语言时，先确认候选译名，再生成 PDF。</p>
        )}
        {tailoredVersion && !busy && (
          <div className="enter mt-3 grid gap-3">
            <p className="text-sm font-semibold text-accent">当前版本：{template.label} · {languageLabels[outputLanguage]}</p>
            {tailoredVersion.changes && tailoredVersion.changes.length > 0 && (
              <ul className="grid gap-2">
                {tailoredVersion.changes.map((c, i) => (
                  <li key={i} className="rounded-xl bg-paper px-3 py-2 text-sm">
                    <span className="font-semibold">{c.section}:</span> {c.change}
                    <span className="block text-xs text-muted">{c.reason}</span>
                  </li>
                ))}
              </ul>
            )}
            {currentTailored?.gaps && currentTailored.gaps.length > 0 && (
              <p className="text-xs text-muted"><strong className="text-ink">Not claimed (not in your resume):</strong> {currentTailored.gaps.join("; ")}</p>
            )}
            <iframe title="Tailored resume preview" src={`/api/resume/${tailoredVersion.id}#view=FitH`} className="h-[520px] w-full rounded-xl border border-line bg-white" />
            <div className="flex flex-wrap gap-2">
              <a href={`/api/resume/${tailoredVersion.id}?download`} className="inline-flex items-center gap-1.5 rounded-xl border border-line-strong px-3 py-2 text-sm font-semibold hover:border-accent hover:text-accent">
                <Download size={15} /> Resume PDF
              </a>
              {tailoredVersion.coverLetterFile && (
                <a href={`/api/resume/${tailoredVersion.id}?file=cover&download`} className="inline-flex items-center gap-1.5 rounded-xl border border-line-strong px-3 py-2 text-sm font-semibold hover:border-accent hover:text-accent">
                  <FileText size={15} /> Cover letter PDF
                </a>
              )}
              {tailoredVersion.coverLetter && (
                <button onClick={() => setShowLetter(!showLetter)} className="rounded-xl px-3 py-2 text-sm text-muted hover:text-ink">
                  {showLetter ? "Hide" : "Read"} cover letter
                </button>
              )}
            </div>
            {showLetter && <p className="whitespace-pre-line rounded-xl bg-paper p-3 text-sm leading-relaxed">{tailoredVersion.coverLetter}</p>}
          </div>
        )}
      </div>

      <div id="apply" className="mt-6 border-t border-line pt-5">
        <div className="flex items-center gap-2">
          <Bot size={17} className="text-accent" />
          <h3 className="font-semibold">Apply with the browser agent</h3>
        </div>
        <p className="mt-2 text-sm text-muted">
          Opens the real application in a visible Chrome window, fills it from your resume and details, uploads your resume, and stops for your approval before submitting.
        </p>
        {detail.source === "linkedin" && !linkedInSignedIn && (
          <div className="mt-3"><Notice tone="warn">LinkedIn jobs need you signed in to LinkedIn in the agent&apos;s browser. Use “Connect LinkedIn” at the top, or the agent will pause and ask you to sign in.</Notice></div>
        )}
        <fieldset className="mt-4 grid gap-2 text-sm">
          <legend className="mb-1 font-medium">Resume to upload</legend>
          {tailoredVersion && (
            <label className="flex items-center gap-2 rounded-xl border border-line px-3 py-2">
              <input type="radio" name={`ver-${job.id}`} checked={useTailored} onChange={() => setUseTailored(true)} disabled={starting || busy} />
              <span>Tailored PDF for {detail.company} · {template.label} · {languageLabels[outputLanguage]} <span className="text-muted">(+ cover letter)</span></span>
            </label>
          )}
          <label className="flex items-center gap-2 rounded-xl border border-line px-3 py-2">
            <input type="radio" name={`ver-${job.id}`} checked={!useTailored} onChange={() => setUseTailored(false)} disabled={!originalId || starting || busy || !!draft} />
            <span>Your original upload</span>
          </label>
        </fieldset>
        {draft && <p className="mt-2 text-xs text-muted">请先确认译名并生成 PDF，或取消本次确认，再选择简历投递。</p>}
        {!tailoredVersion && !draft && useTailored && <p className="mt-2 text-xs text-muted">当前原始简历尚无此模板的{languageLabels[outputLanguage]}版本。请先生成，或明确选择使用原始简历。</p>}
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={autoSubmit} disabled={busy || starting || !!draft} onChange={(e) => setAutoSubmit(e.target.checked)} />
          <span>
            Submit automatically when the form is complete
            <span className="block text-xs text-muted">Off by default: the agent waits for you to review and approve the final click.</span>
          </span>
        </label>
        <Button className="mt-4 w-full py-3" onClick={start} busy={starting} disabled={!hasResume || !chosenVersion || agentBusy || loading || busy || !!draft}>
          <Bot size={17} /> {agentBusy ? "Another application is running" : "Run application agent"}
        </Button>
      </div>
    </Card>
  );
}
