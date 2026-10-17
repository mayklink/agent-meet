import { describe, expect, it } from "vitest";
import { getHumanAuthTransition } from "@/lib/human-auth-state";

describe("human auth transitions", () => {
  it("treats repeated same-user sign-in and token refresh as revalidation, not a new membership", () => {
    expect(getHumanAuthTransition("SIGNED_IN", "user-a", "user-a")).toBe("refresh");
    expect(getHumanAuthTransition("TOKEN_REFRESHED", "user-a", "user-a")).toBe("refresh");
    expect(getHumanAuthTransition("USER_UPDATED", "user-a", "user-a")).toBe("refresh");
  });

  it("recognizes explicit logout and account changes", () => {
    expect(getHumanAuthTransition("SIGNED_OUT", "user-a", null)).toBe("signed-out");
    expect(getHumanAuthTransition("SIGNED_IN", "user-a", "user-b")).toBe("identity-changed");
    expect(getHumanAuthTransition("INITIAL_SESSION", null, "user-a")).toBe("identity-changed");
  });
});
