import { badRequest, route } from "@/lib/api";
import { jobWithDetails } from "@/lib/jobs/details";
import { tailorConfirmationSchema, tailorRequestSchema } from "@/lib/resume/schema";
import { confirmTailorForJob, prepareTailorForJob } from "@/lib/resume/service";

export const POST = route(async (req: Request, ctx: RouteContext<"/api/jobs/[id]/tailor">) => {
  const text = await req.text();
  let body: unknown = {};
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      return badRequest("Invalid JSON request body.");
    }
  }
  const input = tailorRequestSchema.or(tailorConfirmationSchema).safeParse(body);
  if (!input.success) return badRequest("请选择有效模板；确认译名时需提供 draftId 和完整 confirmations，输出语言由模板决定。");
  const jobId = (await ctx.params).id;
  if ("draftId" in input.data) {
    const { version, gaps } = await confirmTailorForJob(jobId, input.data.templateId, input.data.draftId, input.data.confirmations);
    return Response.json({ version, gaps });
  }
  const job = await jobWithDetails(jobId);
  if (!job) return badRequest("Job not found.", 404);
  const result = await prepareTailorForJob(job, input.data.templateId);
  return Response.json("draft" in result ? result : { version: result.version, gaps: result.gaps });
}, "Resume tailoring failed. Please retry.");
