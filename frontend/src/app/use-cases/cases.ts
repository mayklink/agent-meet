// Single source of truth for use-case write-ups. Each entry has its own route
// under src/app/use-cases/<slug>/page.tsx. The index page and the sitemap both
// read from here so everything stays in sync.

export interface UseCase {
  slug: string;
  title: string;
  /** Short label shown on the index card */
  tagline: string;
  description: string;
  /** ISO date (YYYY-MM-DD) */
  date: string;
  readingTime: string;
  keywords: string[];
}

export const useCases: UseCase[] = [
  {
    slug: "self-host-opencloud-and-hermes-with-ai-agents",
    title: "How to Set Up OpenCloud and Hermes with Claude or GPT",
    tagline: "Self-hosting, handled by an agent",
    description:
      "A step-by-step guide to self-hosting OpenCloud (file sync & collaboration) and the Hermes self-hosted AI agent by letting Claude or GPT do the terminal work for you.",
    date: "2026-06-20",
    readingTime: "9 min read",
    keywords: [
      "self-host OpenCloud",
      "OpenCloud Docker setup",
      "set up OpenCloud with Claude",
      "Hermes agent self-hosted",
      "Nous Research Hermes setup",
      "use Claude to self-host",
      "use GPT to set up a server",
      "AI agent sysadmin",
      "OpenCloud install guide",
      "self-hosting with AI agents",
    ],
  },
];

export function getUseCase(slug: string): UseCase | undefined {
  return useCases.find((c) => c.slug === slug);
}

export function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
