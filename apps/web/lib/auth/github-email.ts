import "server-only";

/**
 * GitHub's profile does not say whether its e-mail address is verified, and
 * linking a sign-in to an existing account by e-mail is only safe for a
 * verified address. Ask GitHub's API which of the user's addresses are verified.
 */
export async function githubEmailIsVerified(accessToken: string | undefined, email: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!accessToken) return false;
  try {
    const response = await fetchImpl("https://api.github.com/user/emails", {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json", "User-Agent": "negadras-auth" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return false;
    const emails = (await response.json()) as unknown;
    if (!Array.isArray(emails)) return false;
    return emails.some((entry: unknown) => {
      if (typeof entry !== "object" || entry === null) return false;
      const record = entry as { email?: unknown; verified?: unknown };
      return record.verified === true && typeof record.email === "string" && record.email.toLowerCase() === email;
    });
  } catch {
    return false;
  }
}
