import { describe, expect, it } from "vitest";
import { cloudTurnFailure, isUsageLimitMessage } from "../../../../packages/shared/chat/cloud-turn-failure";

describe("a Cloud turn's failure", () => {
	it("keeps the agent's words from a failed ACP prompt, without its envelope or stderr", () => {
		const raw = 'ACP prompt: {"code":-32603,"message":"Internal error: model \\"x\\" not found {see docs}","data":{"errorKind":"invalid_request"}}: [session/query] sessionId=1\n(node:1) Warning: noise';
		expect(cloudTurnFailure(raw)).toEqual({ message: 'model "x" not found {see docs}', usageLimit: false });
	});

	it("falls back to the error's details when its message is only the generic lead", () => {
		expect(cloudTurnFailure('ACP prompt: {"code":-32603,"message":"Internal error","data":{"details":"Context too long"}}: ').message).toBe("Context too long");
	});

	it("keeps an exited agent's stderr, less the runtime's warnings", () => {
		expect(cloudTurnFailure("ACP prompt: peer disconnected: Error: spawn claude ENOENT\n(node:7) Warning: x\n(Use `node --trace-warnings ...` to show where)\n").message)
			.toBe("peer disconnected: Error: spawn claude ENOENT");
	});

	it("leaves any other failure as written, and reads a usage limit from the provider's own notice only", () => {
		expect(cloudTurnFailure("Codex turn failed: boom")).toEqual({ message: "Codex turn failed: boom", usageLimit: false });
		expect(cloudTurnFailure("You’ve hit your weekly limit · resets Mon 9am (Europe/Paris)").usageLimit).toBe(true);
		expect(isUsageLimitMessage("Usage limit reached for this hour")).toBe(true);
		// Prose that mentions a limit is not one.
		expect(isUsageLimitMessage("I think you've hit your limit")).toBe(false);
		expect(cloudTurnFailure("API Error: 429 rate limit").usageLimit).toBe(false);
	});
});
