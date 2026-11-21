import { z } from "zod";

export const resumeSchema = z.object({
  name: z.string(),
  headline: z.string().describe("Short professional headline taken from the resume, or empty"),
  contact: z.object({
    email: z.string(),
    phone: z.string(),
    location: z.string(),
    linkedin: z.string().describe("Full URL or empty"),
    github: z.string().describe("Full URL or empty"),
    website: z.string().describe("Full URL or empty"),
  }),
  summary: z.string(),
  skills: z.array(z.object({ category: z.string(), items: z.array(z.string()) })),
  experience: z.array(
    z.object({
      title: z.string(),
      company: z.string(),
      location: z.string(),
      start: z.string(),
      end: z.string(),
      bullets: z.array(z.string()),
    }),
  ),
  projects: z.array(
    z.object({ name: z.string(), tech: z.array(z.string()), link: z.string(), bullets: z.array(z.string()) }),
  ),
  education: z.array(
    z.object({
      school: z.string(),
      degree: z.string(),
      field: z.string(),
      start: z.string(),
      end: z.string(),
      details: z.array(z.string()),
    }),
  ),
  certifications: z.array(z.string()),
  achievements: z.array(z.string()),
  activities: z.array(z.object({
    organization: z.string(),
    title: z.string(),
    start: z.string(),
    end: z.string(),
    bullets: z.array(z.string()),
  })).describe("Campus leadership, clubs, volunteer work and social practice, separate from employment and technical projects; empty if absent"),
});

export const tailorRequestSchema = z.object({
  templateId: z.enum(["general", "state-owned", "big-tech", "multinational"]).default("general"),
}).strict();

export const tailorConfirmationSchema = tailorRequestSchema.extend({
  draftId: z.string().uuid(),
  confirmations: z.array(z.object({
    id: z.string().min(1).max(200),
    text: z.string().trim().min(1).max(4000),
  }).strict()).min(1).max(300),
}).strict();

export const tailorSchema = z.object({
  resume: resumeSchema,
  changes: z
    .array(z.object({ section: z.string(), change: z.string(), reason: z.string() }))
    .describe("Each meaningful edit you made, in plain language"),
  cover_letter: z
    .string()
    .describe(
      "Complete cover letter (150-230 words): salutation to the company's hiring team, body grounded only in resume facts, sign-off with the candidate's name. Plain text, paragraphs separated by blank lines, no placeholders",
    ),
  gaps: z.array(z.string()).describe("Job requirements the resume does not evidence"),
});
