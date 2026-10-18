export type HumanAuthTransition = "signed-out" | "identity-changed" | "refresh" | "unchanged";

export function getHumanAuthTransition(
  event: string,
  previousUserId: string | null,
  nextUserId: string | null
): HumanAuthTransition {
  if (!nextUserId) return "signed-out";
  if (previousUserId && previousUserId !== nextUserId) return "identity-changed";
  if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") return "refresh";
  if (!previousUserId) return "identity-changed";
  return "unchanged";
}
