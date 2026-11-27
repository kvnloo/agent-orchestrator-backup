/**
 * Why an AO Cloud turn failed, as the chat shows it.
 *
 * Cloud workers before the control plane cleaned this up stored a failed ACP
 * prompt as `ACP prompt: <JSON-RPC error>: <the adapter's stderr>`: the
 * envelope, the adapter's log lines and Node warnings. The chat shows only the
 * agent's own words ("You've hit your 5-hour limit · resets 11am (UTC)"), and
 * tells a provider usage limit, which a local chat draws as its own notice,
 * from any other failure.
 */

export type CloudTurnFailure = {
	/** The reason, in the agent's words; empty when it gave none. */
	message: string;
	/** The provider refused for the account's usage limit. */
	usageLimit: boolean;
};

const ACP_PROMPT = "ACP prompt:";

// Claude's quota refusals, as the daemon recognises them (domain/usage_limit.go).
const CLAUDE_USAGE_LIMIT_PREFIXES = [
	"You've hit your",
	"You've reached your",
	"You're out of usage credits",
	"Your org is out of usage · add funds to continue",
	"Your org is out of usage · contact your admin",
	"Your seat type doesn't include usage credits",
	"Your seat type doesn't include usage",
	"Your usage allocation has been disabled by your admin",
	"Your group's usage limit is set to $0",
	"Fable 5 requires usage credits",
	"You're out of extra usage",
	"Your seat type doesn't include extra usage",
];
const USAGE_LIMIT_MESSAGE = /^(?:usage limit (?:reached|exceeded)\b|(?:session|weekly|daily) usage limit (?:reached|exceeded)\b|the Claude account has no available quota\b)/i;

/** Whether a failure is a provider's usage-limit refusal, never assistant prose. */
export function isUsageLimitMessage(message: string): boolean {
	const text = message.trim().replace(/’/g, "'");
	return USAGE_LIMIT_MESSAGE.test(text) || CLAUDE_USAGE_LIMIT_PREFIXES.some((prefix) => text.startsWith(prefix));
}

// A Node runtime warning, which explains nothing about the turn.
const NODE_NOISE = /^\(node:\d+\)|^\(Use `node --trace-/;

/** The failure a Cloud turn's error text reports. */
export function cloudTurnFailure(error: string): CloudTurnFailure {
	const text = error.trim();
	if (!text.startsWith(ACP_PROMPT)) return { message: text, usageLimit: isUsageLimitMessage(text) };
	const rest = text.slice(ACP_PROMPT.length).trim();
	const envelope = rest.startsWith("{") ? leadingJsonObject(rest) : undefined;
	if (envelope) {
		const message = acpErrorMessage(envelope);
		if (message) return { message, usageLimit: isUsageLimitMessage(message) };
	}
	// The agent gave no reason of its own (it exited): its stderr is the only
	// one, less the runtime's warnings.
	const message = rest.split("\n").filter((line) => line.trim() !== "" && !NODE_NOISE.test(line.trim())).join("\n").replace(/:\s*$/, "").trim();
	return { message, usageLimit: false };
}

/** A JSON-RPC error's own explanation, without the generic "Internal error" lead. */
function acpErrorMessage(envelope: Record<string, unknown>): string {
	let message = typeof envelope.message === "string" ? envelope.message.trim() : "";
	if (message.startsWith("Internal error:")) message = message.slice("Internal error:".length).trim();
	else if (message === "Internal error") message = "";
	if (message) return message;
	const data = envelope.data;
	const details = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>).details : undefined;
	return typeof details === "string" ? details.trim() : "";
}

/** The JSON object `text` starts with, read up to its closing brace; undefined when it is not one. */
function leadingJsonObject(text: string): Record<string, unknown> | undefined {
	let depth = 0;
	let inString = false;
	for (let index = 0; index < text.length; index++) {
		const char = text[index];
		if (inString) {
			if (char === "\\") index++;
			else if (char === "\"") inString = false;
			continue;
		}
		if (char === "\"") inString = true;
		else if (char === "{") depth++;
		else if (char === "}" && --depth === 0) {
			try {
				const value = JSON.parse(text.slice(0, index + 1)) as unknown;
				return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
			} catch {
				return undefined;
			}
		}
	}
	return undefined;
}
