import { expect, test } from "@playwright/test";
import { resumeHtml } from "../lib/resume/render";
import type { Job, ResumeData, ResumeLanguage, ResumeTailorDraft, ResumeTemplateId, ResumeTranslationReview, ResumeVersion } from "../lib/types";

const baseURL = process.env.ROLEFLOW_TEST_BASE_URL;
test.skip(!baseURL, "Set ROLEFLOW_TEST_BASE_URL to a local dev server for UI tests; all APIs are intercepted.");
test.use({ serviceWorkers: "block" });

const resume: ResumeData = {
  name: "模板测试用户", headline: "测试简历", summary: "使用 Python 处理数据。",
  contact: { email: "test@example.com", phone: "", location: "北京", linkedin: "", github: "", website: "" },
  skills: [{ category: "技能", items: ["Python"] }],
  education: [{ school: "测试大学", degree: "本科", field: "数学", start: "2021", end: "2025", details: ["辅修统计学"] }],
  experience: [{ company: "测试公司", title: "实习生", start: "2024", end: "2025", location: "北京", bullets: ["处理 200 条记录。"] }],
  projects: [{ name: "测试项目", tech: ["Python"], link: "", bullets: ["清洗测试数据。"] }],
  activities: [{ organization: "测试学院", title: "志愿者", start: "2023", end: "2024", bullets: ["协助活动登记。"] }],
  certifications: [], achievements: [],
};

const englishResume: ResumeData = {
  name: "Template Test User", headline: "Test Resume", summary: "Processed data using Python.",
  contact: { email: "test@example.com", phone: "", location: "Beijing", linkedin: "", github: "", website: "" },
  skills: [{ category: "Skills", items: ["Python"] }],
  education: [{ school: "Test University", degree: "Bachelor's", field: "Mathematics", start: "2021", end: "2025", details: ["Minor in Statistics"] }],
  experience: [{ company: "Test Company", title: "Intern", start: "2024", end: "2025", location: "Beijing", bullets: ["Processed 200 records."] }],
  projects: [{ name: "Test Project", tech: ["Python"], link: "", bullets: ["Cleaned test data."] }],
  activities: [{ organization: "Test College", title: "Volunteer", start: "2023", end: "2024", bullets: ["Assisted with event registration."] }],
  certifications: [], achievements: [],
};

const job: Job = { id: "ui-fixture", source: "web", title: "数据分析实习生", company: "模板测试企业", location: "北京",
  url: "https://example.com/job", applyUrl: "https://example.com/job", description: "使用 Python 分析数据，参与团队协作。", fetchedAt: "2026-11-19T00:00:00Z" };
const otherJob: Job = { ...job, id: "other-ui-fixture", title: "另一份测试岗位" };
const original: ResumeVersion = { id: "original-fixture", kind: "original", label: "Original fixture", fileName: "original.pdf",
  mimeType: "application/pdf", createdAt: "2026-11-19T00:00:00Z" };
type TailorRequest = { templateId: ResumeTemplateId };
type ConfirmRequest = TailorRequest & { draftId: string; confirmations: { id: string; text: string }[] };
const reviewWarning = "候选译名，未经官方来源核实；请优先填写官网/证书上的名称，姓名使用本人认可的拼写，确认后才生成PDF";
const confirmationError = "PDF generation failed. Your draft is available; please retry confirmation.";
const labels: Record<ResumeTemplateId, string> = { general: "通用", "state-owned": "央国企", "big-tech": "大厂", multinational: "外企" };
const languageLabel = (language: ResumeLanguage) => language === "zh" ? "中文" : "English";
const opposite = (language: ResumeLanguage): ResumeLanguage => language === "zh" ? "en" : "zh";
const reviewFields = (source: ResumeData, target: ResumeData): ResumeTranslationReview[] => [
  { id: "name", label: "姓名", source: source.name, suggested: target.name },
  { id: "experience.0.company", label: "公司 1", source: source.experience[0].company, suggested: target.experience[0].company },
  { id: "education.0.school", label: "学校 1", source: source.education[0].school, suggested: target.education[0].school },
  { id: "education.0.degree", label: "学位 1", source: source.education[0].degree, suggested: target.education[0].degree },
  { id: "education.0.field", label: "专业 1", source: source.education[0].field, suggested: target.education[0].field },
  { id: "education.0.details.0", label: "教育详情 1.1", source: source.education[0].details[0], suggested: target.education[0].details[0] },
  { id: "experience.1.company", label: "公司 2", source: source.experience[0].company, suggested: target.experience[0].company },
];
// Independent expectations: do not use the production policy helper to build fixtures.
const policy = (sourceLanguage: ResumeLanguage): Record<ResumeTemplateId, ResumeLanguage> => ({
  general: sourceLanguage, "state-owned": "zh", "big-tech": "zh", multinational: "en",
});
const templateIds = Object.keys(labels) as ResumeTemplateId[];

for (const mobile of [false, true]) {
  for (const sourceLanguage of ["zh", "en"] as const) {
    test(`template language policy, historic versions and replacement (${sourceLanguage} source, ${mobile ? "mobile" : "desktop"})`, async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 });
      const errors: string[] = [];
      const unexpectedRequests: string[] = [];
      const tailorPath = `/api/jobs/${job.id}/tailor`;
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        // Only the deliberately failed tailoring responses may log HTTP 400 errors.
        if (message.text().includes("400 (Bad Request)") && message.location().url.includes(tailorPath)) return;
        errors.push(message.text());
      });
      const expectedLanguages = policy(sourceLanguage);
      // Put ineligible versions FIRST, including opposite-language versions of every template.
      const invalidVersions = templateIds.flatMap((templateId) => {
        const version: ResumeVersion = { ...original, kind: "tailored", jobId: job.id, templateId,
          sourceResumeId: original.id, outputLanguage: expectedLanguages[templateId],
          label: `Legacy ${templateId}`, coverLetter: "Legacy letter", coverLetterFile: "legacy-cover.pdf" };
        const invalid: Partial<ResumeVersion>[] = [
          { outputLanguage: opposite(expectedLanguages[templateId]) },
          { outputLanguage: undefined },
          { outputLanguage: "fr" as ResumeLanguage },
          { templateId: undefined },
          { templateId: "retired" as ResumeTemplateId },
          { sourceResumeId: undefined },
          { sourceResumeId: "old-upload" },
          { jobId: undefined },
          { jobId: "other-job" },
        ];
        return invalid.map((metadata, index) => ({ ...version, ...metadata, id: `invalid-${templateId}-${index}` }));
      });
      let versions: ResumeVersion[] = [...invalidVersions, original];
      let currentOriginal = original;
      let currentLanguage: ResumeLanguage = sourceLanguage;
      const currentResume = () => currentLanguage === "zh" ? resume : englishResume;
      const submittedRequests: TailorRequest[] = [];
      const confirmationRequests: ConfirmRequest[] = [];
      const drafts = new Map<string, { draft: ResumeTailorDraft; version: ResumeVersion }>();
      let failNext = false;
      let failNextConfirmation = false;
      let pendingTailor: Promise<void> | null = null;
      let pendingConfirmation: Promise<void> | null = null;
      let profileReads = 0;
      let attemptedApplication = false;
      let uploads = 0;
      await page.route("**/api/**", async (route) => {
        const url = new URL(route.request().url());
        const method = route.request().method();
        const respond = (data: unknown) => route.fulfill({ json: data });
        if (url.pathname === "/api/profile" && method === "GET") {
          profileReads++;
          return respond({
            profile: { resume: currentResume(), resumeText: "Python", originalResumeId: currentOriginal.id,
              baseResumeId: null, preferences: {}, answers: [], updatedAt: currentOriginal.createdAt },
            versions, openai: { configured: true, model: "test-model", agentModel: "test-model" },
          });
        }
        if (url.pathname === "/api/resume" && method === "POST") {
          uploads++;
          currentOriginal = { ...original, id: uploads === 1 ? "replacement-fixture" : `replacement-fixture-${uploads}`, label: "Replacement fixture" };
          currentLanguage = opposite(currentLanguage);
          versions = [...versions, currentOriginal];
          return respond({});
        }
        if (url.pathname === "/api/browser" && method === "GET") return respond({ open: false, linkedin: false });
        if (url.pathname === "/api/autopilot" && method === "GET") return respond({ autopilot: null });
        if (url.pathname === "/api/applications" && method === "GET") return respond({ applications: [] });
        if (url.pathname === "/api/applications" && method === "POST") {
          attemptedApplication = true;
          return route.fulfill({ status: 409, json: { error: "Application POST must not be attempted by this test." } });
        }
        if (url.pathname === "/api/jobs/search" && method === "POST") return respond({ jobs: [job, otherJob], errors: [] });
        if (url.pathname === `/api/jobs/${job.id}` && method === "GET") return respond({ job });
        if (url.pathname === `/api/jobs/${otherJob.id}` && method === "GET") return respond({ job: otherJob });
        if (url.pathname === tailorPath && method === "POST") {
          const request = route.request().postDataJSON() as TailorRequest | ConfirmRequest;
          if ("draftId" in request) {
            confirmationRequests.push(request);
            await pendingConfirmation;
            const stored = drafts.get(request.draftId);
            expect(stored, "Confirmation must reference an existing fixture draft").toBeDefined();
            const { draft, version } = stored!;
            expect(request.templateId).toBe(draft.templateId);
            expect(draft.sourceResumeId).toBe(currentOriginal.id);
            expect(Object.keys(request).sort()).toEqual(["confirmations", "draftId", "templateId"]);
            expect(request.confirmations.map((item) => item.id)).toEqual(draft.review.map((item) => item.id));
            expect(request.confirmations.every((item) => item.text.trim().length > 0)).toBe(true);
            if (failNextConfirmation) {
              failNextConfirmation = false;
              return route.fulfill({ status: 400, json: { error: confirmationError } });
            }
            versions = [...versions, version];
            drafts.delete(request.draftId);
            return respond({ version, gaps: [`Gap for ${version.templateId} (${version.outputLanguage})`] });
          }
          submittedRequests.push(request);
          await pendingTailor;
          if (failNext) {
            failNext = false;
            return route.fulfill({ status: 400, json: { error: "Translation failed: output language validation did not pass. Please retry." } });
          }
          const { templateId } = request;
          const outputLanguage = policy(currentLanguage)[templateId];
          const id = `${templateId}-${outputLanguage}-${submittedRequests.length}`;
          const version: ResumeVersion = { ...original, kind: "tailored", id, jobId: job.id,
            templateId, outputLanguage, sourceResumeId: currentOriginal.id, label: `Fixture ${templateId} ${outputLanguage}`,
            coverLetter: `Letter for ${templateId} (${outputLanguage})`, coverLetterFile: `${id}-cover.pdf` };
          if (currentLanguage !== outputLanguage) {
            const draft: ResumeTailorDraft = { id: `draft-${id}`, templateId, outputLanguage, sourceResumeId: currentOriginal.id,
              review: reviewFields(currentResume(), outputLanguage === "en" ? englishResume : resume) };
            drafts.set(draft.id, { draft, version });
            return respond({ draft });
          }
          versions = [...versions, version];
          return respond({ version, gaps: [`Gap for ${templateId} (${outputLanguage})`] });
        }
        if (url.pathname.startsWith("/api/resume/") && method === "GET") {
          const version = versions.find((item) => item.id === url.pathname.split("/").at(-1));
          if (version) return route.fulfill({
            contentType: "text/html; charset=utf-8",
            body: resumeHtml(version.outputLanguage === "en" ? englishResume : resume, version.templateId ?? "general", version.outputLanguage),
          });
        }
        unexpectedRequests.push(`${method} ${url.pathname}`);
        // Never continue or fetch: even unexpected API requests cannot touch real data.
        return route.fulfill({ status: 500, json: { error: `Unexpected fixture request: ${url.pathname}` } });
      });
      await page.goto(`${baseURL}/app`);
      await expect(page.getByRole("heading", { name: currentResume().name, exact: true })).toBeVisible();
      await page.getByLabel("What kind of role are you looking for?").fill("Data analyst");
      await page.getByRole("button", { name: "Search jobs", exact: true }).click();
      const selector = page.getByLabel("简历结构模板", { exact: true });
      const preview = page.locator('iframe[title="Tailored resume preview"]');
      const apply = page.getByRole("button", { name: "Run application agent", exact: true });
      const originalChoice = page.getByRole("radio", { name: "Your original upload" });
      const tailoredChoice = page.getByRole("radio", { name: /Tailored PDF for/ });
      const generateButton = page.getByRole("button", { name: /^(?:Tailor for this job|Re-tailor)$/ });
      const resumeDownload = page.getByRole("link", { name: "Resume PDF", exact: true });
      const coverDownload = page.getByRole("link", { name: "Cover letter PDF", exact: true });
      const translationError = page.getByText("Translation failed: output language validation did not pass. Please retry.", { exact: true });
      const reviewPanel = page.getByRole("region", { name: "译名确认", exact: true });
      const confirmButton = page.getByRole("button", { name: "确认译名并生成 PDF", exact: true });
      const cancelButton = page.getByRole("button", { name: "取消译名确认", exact: true });
      const automaticSubmit = page.getByRole("checkbox", { name: /Submit automatically/ });
      let reviewScreenshotSaved = false;
      const expectOnlyTemplateControl = async () => {
        await expect(page.getByLabel("输出语言", { exact: true })).toHaveCount(0);
        await expect(page.getByText("输出语言", { exact: true })).toHaveCount(0);
        await expect(page.locator('select[id^="resume-language-"]')).toHaveCount(0);
        await expect(selector.locator("xpath=..").getByRole("combobox")).toHaveCount(1);
        await expect(page.getByText(/^(?:栏目|排版)顺序：/)).toHaveCount(0);
      };
      const expectNoVersion = async (outputLanguage: ResumeLanguage) => {
        await expect(preview).toHaveCount(0);
        await expect(resumeDownload).toHaveCount(0);
        await expect(coverDownload).toHaveCount(0);
        await expect(tailoredChoice).toHaveCount(0);
        await expect(originalChoice).not.toBeChecked();
        await expect(apply).toBeDisabled();
        await expect(page.getByText(`当前原始简历尚无此模板的${languageLabel(outputLanguage)}版本。请先生成，或明确选择使用原始简历。`, { exact: true })).toBeVisible();
        await expectOnlyTemplateControl();
      };
      const expectVersion = async (id: string, templateId: ResumeTemplateId, outputLanguage: ResumeLanguage) => {
        const label = languageLabel(outputLanguage);
        await expect(preview).toHaveAttribute("src", `/api/resume/${id}#view=FitH`);
        await expect(resumeDownload).toHaveAttribute("href", `/api/resume/${id}?download`);
        await expect(coverDownload).toHaveAttribute("href", `/api/resume/${id}?file=cover&download`);
        await expect(page.getByText(`当前版本：${labels[templateId]} · ${label}`, { exact: true })).toBeVisible();
        await expect(tailoredChoice).toHaveAccessibleName(`Tailored PDF for ${job.company} · ${labels[templateId]} · ${label} (+ cover letter)`);
        await expect(tailoredChoice).toBeChecked();
        await expect(originalChoice).not.toBeChecked();
        await expect(apply).toBeEnabled();
        await expect(selector).toBeEnabled();
        await expect(generateButton).toBeEnabled();
        const frame = preview.contentFrame();
        await expect(frame.locator("html")).toHaveAttribute("lang", outputLanguage);
        const educationFirst = templateId === "state-owned" || templateId === "big-tech";
        await expect(frame.locator("h2").first()).toHaveText(educationFirst ? "教育背景" : outputLanguage === "zh" ? "个人概述" : "Summary");
        await expect(frame.getByText(outputLanguage === "zh" ? "处理 200 条记录。" : "Processed 200 records.", { exact: true })).toBeVisible();
        if (outputLanguage === "en") await expect(frame.locator("body")).not.toContainText(/[\u3400-\u9fff]/);
        await expectOnlyTemplateControl();
      };
      const expectReview = async (draft: ResumeTailorDraft) => {
        await expect(reviewPanel).toBeVisible();
        await expect(reviewPanel.getByText(reviewWarning, { exact: true })).toBeVisible();
        await expect(reviewPanel.getByRole("heading")).toHaveText(`确认候选译名 · ${languageLabel(currentLanguage)} → ${languageLabel(draft.outputLanguage)}`);
        await expect(reviewPanel.getByRole("textbox")).toHaveCount(draft.review.length);
        for (const item of draft.review) {
          const field = reviewPanel.getByRole("textbox", { name: `${item.label} · 候选译名`, exact: true });
          await expect(field).toBeEnabled();
          await expect(field).toHaveValue(item.suggested);
          await expect(field).toHaveAccessibleDescription(item.source);
          await expect(reviewPanel.getByText(item.source, { exact: true }).first()).toBeVisible();
        }
        await expect(reviewPanel.getByText(/日期保持不变，不可编辑/)).toBeVisible();
        await expect(reviewPanel.locator('input[type="date"]')).toHaveCount(0);
        await expect(reviewPanel.getByRole("textbox", { name: /日期|开始|结束|start|end/i })).toHaveCount(0);
        await expect(preview).toHaveCount(0);
        await expect(resumeDownload).toHaveCount(0);
        await expect(coverDownload).toHaveCount(0);
        await expect(tailoredChoice).toHaveCount(0);
        await expect(page.getByText(/Gap for /)).toHaveCount(0);
        await expect(page.getByText(/^Letter for /)).toHaveCount(0);
        await expect(page.getByRole("button", { name: /^(Read|Hide) cover letter$/ })).toHaveCount(0);
        await expect(originalChoice).toBeDisabled();
        await expect(automaticSubmit).toBeDisabled();
        await expect(apply).toBeDisabled();
        await expect(generateButton).toBeDisabled();
        await expect(selector).toBeEnabled();
        await expect(cancelButton).toBeEnabled();
        await expect(confirmButton).toBeEnabled();
        await expectOnlyTemplateControl();
      };
      const confirm = async (draft: ResumeTailorDraft, values = draft.review.map((item) => ({ id: item.id, text: item.suggested }))) => {
        const requestCount = confirmationRequests.length + 1;
        const generationCount = submittedRequests.length;
        const reads = profileReads;
        const shouldFail = failNextConfirmation;
        let release!: () => void;
        pendingConfirmation = new Promise<void>((resolve) => { release = resolve; });
        try {
          await confirmButton.click();
          await expect.poll(() => confirmationRequests.length).toBe(requestCount);
          expect(confirmationRequests.at(-1)).toEqual({ templateId: draft.templateId, draftId: draft.id, confirmations: values });
          await expect(selector).toBeDisabled();
          await expect(generateButton).toBeDisabled();
          await expect(confirmButton).toBeDisabled();
          await expect(cancelButton).toBeDisabled();
          for (const field of await reviewPanel.getByRole("textbox").all()) await expect(field).toBeDisabled();
          await expect(originalChoice).toBeDisabled();
          await expect(automaticSubmit).toBeDisabled();
          await expect(apply).toBeDisabled();
          await expect(preview).toHaveCount(0);
          await expect(resumeDownload).toHaveCount(0);
          await expect(page.getByText("正在使用已确认内容生成 PDF，不再调用 AI…", { exact: true })).toBeVisible();
          await expect(page.getByText(/正在按岗位改写/)).toHaveCount(0);
          expect(profileReads).toBe(reads);
        } finally {
          release();
          pendingConfirmation = null;
        }
        if (shouldFail) {
          await expect(page.getByText(confirmationError, { exact: true })).toBeVisible();
          await expect(confirmButton).toBeEnabled();
          expect(profileReads).toBe(reads);
        } else {
          await expect(reviewPanel).toHaveCount(0);
          await expect.poll(() => profileReads).toBeGreaterThan(reads);
        }
        // Confirmation only renders the saved draft; it must not repeat the generation request.
        expect(submittedRequests).toHaveLength(generationCount);
      };
      // Hold responses until the UI demonstrates each busy state, including re-tailoring.
      const generate = async (templateId: ResumeTemplateId, outputLanguage: ResumeLanguage, confirmCandidates = true) => {
        const requestCount = submittedRequests.length + 1;
        const shouldFail = failNext;
        const reads = profileReads;
        const confirmedCount = confirmationRequests.length;
        let release!: () => void;
        pendingTailor = new Promise<void>((resolve) => { release = resolve; });
        try {
          await generateButton.click();
          await expect.poll(() => submittedRequests.length).toBe(requestCount);
          expect(submittedRequests.at(-1)).toEqual({ templateId });
          await expect(selector).toBeDisabled();
          await expect(generateButton).toBeDisabled();
          await expect(originalChoice).toBeDisabled();
          await expect(automaticSubmit).toBeDisabled();
          if (await tailoredChoice.count()) await expect(tailoredChoice).toBeDisabled();
          await expect(apply).toBeDisabled();
          const direction = `${languageLabel(currentLanguage)} → ${languageLabel(outputLanguage)}`;
          await expect(page.getByText(currentLanguage === outputLanguage
            ? `正在按岗位改写简历与求职信（${direction}）并生成 PDF…`
            : `正在按岗位改写简历与求职信并翻译（${direction}），随后请确认候选译名…`, { exact: true })).toBeVisible();
          await expect(page.getByText(/fact-checking|checks every skill|20[–-]40 seconds/)).toHaveCount(0);
          await expectOnlyTemplateControl();
        } finally {
          release();
          pendingTailor = null;
        }
        if (shouldFail) {
          await expect(translationError).toBeVisible();
          return null;
        }
        if (currentLanguage !== outputLanguage) {
          await expect(reviewPanel).toBeVisible();
          const { draft } = drafts.get(`draft-${templateId}-${outputLanguage}-${requestCount}`)!;
          await expectReview(draft);
          expect(profileReads).toBe(reads);
          expect(versions.some((version) => version.id === `${templateId}-${outputLanguage}-${requestCount}`)).toBe(false);
          expect(confirmationRequests).toHaveLength(confirmedCount);
          if (!reviewScreenshotSaved) {
            await reviewPanel.getByRole("heading").evaluate((element) => element.scrollIntoView({ block: "start", behavior: "instant" }));
            await page.screenshot({ path: testInfo.outputPath("translation-review.png"), fullPage: true });
            if (!mobile) {
              await confirmButton.scrollIntoViewIfNeeded();
              await page.screenshot({ path: testInfo.outputPath("translation-review-confirm.png"), fullPage: true });
            }
            reviewScreenshotSaved = true;
          }
          if (confirmCandidates) await confirm(draft);
          return draft;
        }
        await expect(generateButton).toBeEnabled();
        await expect(reviewPanel).toHaveCount(0);
        expect(confirmationRequests).toHaveLength(confirmedCount);
        return null;
      };
      const expectLocalDetailsCleared = async () => {
        await expect(page.getByText(/Gap for /)).toHaveCount(0);
        await expect(page.getByText(/^Letter for /)).toHaveCount(0);
        await expect(translationError).toHaveCount(0);
      };

      await expect(selector).toHaveValue("general");
      await expect(selector.locator("option")).toHaveText(["通用", "央国企", "大厂", "外企"]);
      for (const templateId of templateIds) {
        await selector.selectOption(templateId);
        await expectNoVersion(expectedLanguages[templateId]);
      }

      await selector.selectOption("general");
      await originalChoice.check();
      await expect(apply).toBeEnabled();
      await generate("general", sourceLanguage);
      await expectVersion(`general-${sourceLanguage}-1`, "general", sourceLanguage);
      await expect(page.getByText(`Gap for general (${sourceLanguage})`, { exact: false })).toBeVisible();
      await page.getByRole("button", { name: "Read cover letter", exact: true }).click();
      await expect(page.getByText(`Letter for general (${sourceLanguage})`, { exact: true })).toBeVisible();
      await originalChoice.check();

      // Template changes clear local letters, gaps, errors and the explicit original choice.
      await selector.selectOption("state-owned");
      await expectNoVersion("zh");
      await expectLocalDetailsCleared();
      failNext = true;
      await generate("state-owned", "zh");
      await expect(translationError).toBeVisible();
      await expectNoVersion("zh");
      await expect(selector).toBeEnabled();
      await expect(originalChoice).toBeEnabled();
      await expect(generateButton).toBeEnabled();
      expect(versions.some((version) => version.id === "state-owned-zh-2")).toBe(false);
      await generate("state-owned", "zh");
      await expectVersion("state-owned-zh-3", "state-owned", "zh");
      await expect(translationError).toHaveCount(0);

      await selector.selectOption("big-tech");
      await expectNoVersion("zh");
      failNext = true;
      await generate("big-tech", "zh");
      await expect(translationError).toBeVisible();
      await selector.selectOption("multinational");
      await expectNoVersion("en");
      await expectLocalDetailsCleared();
      await selector.selectOption("big-tech");
      await generate("big-tech", "zh");
      await expectVersion("big-tech-zh-5", "big-tech", "zh");
      await page.getByRole("button", { name: "Read cover letter", exact: true }).click();
      await expect(page.getByText("Letter for big-tech (zh)", { exact: true })).toBeVisible();
      await expect(page.getByText("Gap for big-tech (zh)", { exact: false })).toBeVisible();
      await originalChoice.check();
      await selector.selectOption("multinational");
      await expectNoVersion("en");
      await expectLocalDetailsCleared();
      await generate("multinational", "en");
      await expectVersion("multinational-en-6", "multinational", "en");

      // The desktop panel scrolls internally: show the selector AND preview in the artifact.
      await selector.evaluate((element) => element.scrollIntoView({ block: "start", behavior: "instant" }));
      await expect(selector).toBeInViewport();
      await expect(preview).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath("resume-template-policy.png"), fullPage: true });

      // Reuse matching history behind incompatible metadata, without generating or applying.
      const historicalIds: Record<ResumeTemplateId, string> = {
        general: `general-${sourceLanguage}-1`, "state-owned": "state-owned-zh-3", "big-tech": "big-tech-zh-5", multinational: "multinational-en-6",
      };
      for (const templateId of templateIds) {
        await originalChoice.check();
        await selector.selectOption(templateId);
        await expectVersion(historicalIds[templateId], templateId, expectedLanguages[templateId]);
        await expectLocalDetailsCleared();
        await expect(page.getByRole("button", { name: "Read cover letter", exact: true })).toBeVisible();
      }
      expect(submittedRequests).toEqual([
        { templateId: "general" }, { templateId: "state-owned" }, { templateId: "state-owned" },
        { templateId: "big-tech" }, { templateId: "big-tech" }, { templateId: "multinational" },
      ]);
      await generate("multinational", "en");
      await expectVersion("multinational-en-7", "multinational", "en");
      await page.getByRole("button", { name: "Read cover letter", exact: true }).click();
      await originalChoice.check();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      // Replacement changes the source language in both directions and invalidates ALL old PDFs.
      await page.locator('input[type="file"]').setInputFiles({ name: "replacement.pdf", mimeType: "application/pdf", buffer: Buffer.from("fixture upload is intercepted") });
      const replacementLanguage = opposite(sourceLanguage);
      await expect(page.getByRole("heading", { name: replacementLanguage === "zh" ? resume.name : englishResume.name, exact: true })).toBeVisible();
      await expect(selector).toHaveValue("general");
      await expectNoVersion(replacementLanguage);
      await expectLocalDetailsCleared();
      for (const templateId of templateIds) {
        await selector.selectOption(templateId);
        await expectNoVersion(policy(replacementLanguage)[templateId]);
      }
      await selector.selectOption("general");
      await generate("general", replacementLanguage);
      await expectVersion(`general-${replacementLanguage}-8`, "general", replacementLanguage);
      await selector.selectOption("state-owned");
      await expectNoVersion("zh");
      await generate("state-owned", "zh");
      await expectVersion("state-owned-zh-9", "state-owned", "zh");
      await selector.selectOption("general");
      await expectVersion(`general-${replacementLanguage}-8`, "general", replacementLanguage);
      expect(versions.filter((version) => version.kind === "tailored" && version.sourceResumeId === "replacement-fixture")
        .map(({ templateId, outputLanguage }) => ({ templateId, outputLanguage }))).toEqual([
        { templateId: "general", outputLanguage: replacementLanguage }, { templateId: "state-owned", outputLanguage: "zh" },
      ]);
      expect(submittedRequests.slice(6)).toEqual([{ templateId: "multinational" }, { templateId: "general" }, { templateId: "state-owned" }]);
      expect(uploads).toBe(1);

      const crossTemplate: ResumeTemplateId = currentLanguage === "zh" ? "multinational" : "state-owned";
      const targetLanguage = opposite(currentLanguage);
      await test.step("Edit every candidate, reject blanks and preserve edits after a failed confirmation", async () => {
        await selector.selectOption(crossTemplate);
        const draft = (await generate(crossTemplate, targetLanguage, false))!;
        const savedVersions = versions.length;
        const confirmationsBefore = confirmationRequests.length;
        const edits = targetLanguage === "en"
          ? ["My Chosen Spelling", "Certificate Company Ltd.", "Certificate University", "Bachelor of Science", "Applied Mathematics", "Minor: Statistics; honours programme", "Certificate Company Ltd."]
          : ["本人认可姓名", "证书上的公司名称", "证书上的大学名称", "理学学士", "应用数学", "辅修统计学；荣誉课程", "证书上的公司名称"];
        const values = draft.review.map((item, index) => ({ id: item.id, text: edits[index] }));
        for (const [index, item] of draft.review.entries()) {
          const field = reviewPanel.getByRole("textbox", { name: `${item.label} · 候选译名`, exact: true });
          await field.fill("   ");
          await expect(confirmButton).toBeDisabled();
          // Whitespace around valid edits is preserved locally but trimmed in the request.
          await field.fill(`  ${edits[index]}  `);
          await expect(confirmButton).toBeEnabled();
        }
        expect(confirmationRequests).toHaveLength(confirmationsBefore);
        expect(versions).toHaveLength(savedVersions);
        failNextConfirmation = true;
        await confirm(draft, values);
        for (const [index, item] of draft.review.entries()) {
          await expect(reviewPanel.getByRole("textbox", { name: `${item.label} · 候选译名`, exact: true })).toHaveValue(`  ${edits[index]}  `);
        }
        await expect(selector).toBeEnabled();
        await expect(cancelButton).toBeEnabled();
        await expect(originalChoice).toBeDisabled();
        await expect(apply).toBeDisabled();
        await expect(preview).toHaveCount(0);
        expect(versions).toHaveLength(savedVersions);
        await confirm(draft, values);
        expect(confirmationRequests.at(-1)).toEqual(confirmationRequests.at(-2));
        await expect(page.getByText(confirmationError, { exact: true })).toHaveCount(0);
        await expectVersion(`${crossTemplate}-${targetLanguage}-10`, crossTemplate, targetLanguage);
        await page.getByRole("button", { name: "Read cover letter", exact: true }).click();
        await originalChoice.check();
      });

      const historyId = versions.find((version) => version.kind === "tailored" && version.jobId === job.id
        && version.templateId === crossTemplate && version.outputLanguage === targetLanguage && version.sourceResumeId === currentOriginal.id)!.id;
      await test.step("Cancel a replacement draft locally without offering the old PDF during review", async () => {
        const draft = (await generate(crossTemplate, targetLanguage, false))!;
        const requestCount = submittedRequests.length;
        const confirmedCount = confirmationRequests.length;
        const reads = profileReads;
        await reviewPanel.getByRole("textbox", { name: "姓名 · 候选译名", exact: true }).fill("Discard this edit");
        await cancelButton.click();
        await expect(reviewPanel).toHaveCount(0);
        await expectVersion(historyId, crossTemplate, targetLanguage);
        await expectLocalDetailsCleared();
        expect(drafts.has(draft.id)).toBe(true);
        expect(submittedRequests).toHaveLength(requestCount);
        expect(confirmationRequests).toHaveLength(confirmedCount);
        expect(profileReads).toBe(reads);
      });

      await test.step("Changing template and job discards unconfirmed local edits", async () => {
        const draft = (await generate(crossTemplate, targetLanguage, false))!;
        const confirmedCount = confirmationRequests.length;
        await reviewPanel.getByRole("textbox", { name: "姓名 · 候选译名", exact: true }).fill("Discard on template change");
        await selector.selectOption("general");
        await expect(reviewPanel).toHaveCount(0);
        await expectVersion(`general-${replacementLanguage}-8`, "general", replacementLanguage);
        await selector.selectOption(crossTemplate);
        await expect(reviewPanel).toHaveCount(0);
        await expectVersion(historyId, crossTemplate, targetLanguage);
        expect(drafts.has(draft.id)).toBe(true);
        const jobDraft = (await generate(crossTemplate, targetLanguage, false))!;
        await page.getByRole("button", { name: new RegExp(otherJob.title) }).click();
        await expect(reviewPanel).toHaveCount(0);
        await expect(selector).toHaveValue("general");
        await expectNoVersion(replacementLanguage);
        await page.getByRole("button", { name: new RegExp(job.title) }).click();
        await expect(reviewPanel).toHaveCount(0);
        await expectVersion(`general-${replacementLanguage}-8`, "general", replacementLanguage);
        expect(drafts.has(jobDraft.id)).toBe(true);
        expect(confirmationRequests).toHaveLength(confirmedCount);
      });

      await test.step("Replacing the source while a draft is open discards it without confirming", async () => {
        await selector.selectOption(crossTemplate);
        const draft = (await generate(crossTemplate, targetLanguage, false))!;
        const confirmedCount = confirmationRequests.length;
        await reviewPanel.getByRole("textbox", { name: "姓名 · 候选译名", exact: true }).fill("Discard on upload");
        await page.locator('input[type="file"]').setInputFiles({ name: "second-replacement.pdf", mimeType: "application/pdf", buffer: Buffer.from("intercepted replacement during review") });
        await expect(page.getByRole("heading", { name: sourceLanguage === "zh" ? resume.name : englishResume.name, exact: true })).toBeVisible();
        await expect(reviewPanel).toHaveCount(0);
        await expect(selector).toHaveValue("general");
        await expectNoVersion(sourceLanguage);
        await expectLocalDetailsCleared();
        await expect(originalChoice).toBeEnabled();
        await originalChoice.check();
        await expect(apply).toBeEnabled();
        expect(drafts.has(draft.id)).toBe(true);
        expect(confirmationRequests).toHaveLength(confirmedCount);
        expect(uploads).toBe(2);
      });
      expect(attemptedApplication).toBe(false);
      expect(unexpectedRequests).toEqual([]);
      expect(errors).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
}
