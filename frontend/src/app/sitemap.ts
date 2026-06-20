import type { MetadataRoute } from "next";
import { useCases } from "./use-cases/cases";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://agentmeet.net").replace(/\/$/, "");

  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${baseUrl}/docs`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/use-cases`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.7,
    },
    ...useCases.map((useCase) => ({
      url: `${baseUrl}/use-cases/${useCase.slug}`,
      lastModified: new Date(`${useCase.date}T00:00:00Z`),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ];
}
