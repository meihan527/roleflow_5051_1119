import { createServer } from "node:http";
import { test, expect } from "@playwright/test";
import { z } from "zod";
import { structured } from "../lib/ai";

test("custom API root, key and model reach the Responses endpoint", async () => {
  const previous = { key: process.env.OPENAI_API_KEY, url: process.env.OPENAI_BASE_URL, model: process.env.OPENAI_MODEL };
  let received: { path?: string; auth?: string; model?: string } = {};
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    received = { path: req.url, auth: req.headers.authorization, model: JSON.parse(body).model };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      id: "resp_test", object: "response", created_at: 0, status: "completed", model: "custom-model",
      output: [{ id: "msg_test", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: '{"name":"Example"}', annotations: [] }] }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server port");
    process.env.OPENAI_API_KEY = "test-placeholder-key";
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
    process.env.OPENAI_MODEL = "custom-model";
    const result = await structured({ schema: z.object({ name: z.string() }), name: "sample", instructions: "Return sample JSON", input: "sample" });
    expect(result).toEqual({ name: "Example" });
    expect(received).toEqual({ path: "/v1/responses", auth: "Bearer test-placeholder-key", model: "custom-model" });
  } finally {
    for (const [name, value] of [["OPENAI_API_KEY", previous.key], ["OPENAI_BASE_URL", previous.url], ["OPENAI_MODEL", previous.model]]) {
      if (value === undefined) delete process.env[name!]; else process.env[name!] = value;
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});