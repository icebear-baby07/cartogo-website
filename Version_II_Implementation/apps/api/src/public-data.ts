import { Router, type Response } from "express";
import {
  ApiErrorSchema,
  PublicUnitsResponseSchema,
  SiteAssetsResponseSchema,
  SiteContentSchema,
} from "@cartogo/contracts";

export type PublicDataRepository = {
  listPublicUnits(): Promise<unknown[]>;
  listSiteAssets(): Promise<unknown[]>;
  getSiteContent(): Promise<unknown | null>;
};

type RepositoryProvider = () => Promise<PublicDataRepository>;

function sendUnavailable(
  response: Response,
  message: string,
): void {
  response.status(503).json(ApiErrorSchema.parse({ error: message }));
}

export function createPublicDataRouter(
  getRepository: RepositoryProvider,
): Router {
  const router = Router();

  router.get("/public/units", async (_request, response) => {
    try {
      const units = await (await getRepository()).listPublicUnits();
      const result = PublicUnitsResponseSchema.safeParse(units);
      if (!result.success) {
        console.error("MongoDB public units failed contract validation.", result.error.issues);
        sendUnavailable(response, "Public fleet data is unavailable.");
        return;
      }
      response.json(result.data);
    } catch (error) {
      console.error(
        "Failed to read public units from MongoDB.",
        error instanceof Error ? error.name : "UnknownError",
      );
      sendUnavailable(response, "Public fleet data is unavailable.");
    }
  });

  router.get("/site-assets", async (_request, response) => {
    try {
      const assets = await (await getRepository()).listSiteAssets();
      const result = SiteAssetsResponseSchema.safeParse(assets);
      if (!result.success) {
        console.error("MongoDB site assets failed contract validation.", result.error.issues);
        sendUnavailable(response, "Site assets are unavailable.");
        return;
      }
      response.json(result.data);
    } catch (error) {
      console.error(
        "Failed to read site assets from MongoDB.",
        error instanceof Error ? error.name : "UnknownError",
      );
      sendUnavailable(response, "Site assets are unavailable.");
    }
  });

  router.get("/site-content", async (_request, response) => {
    try {
      const content = await (await getRepository()).getSiteContent();
      if (content === null) {
        sendUnavailable(response, "Site content is not initialized.");
        return;
      }
      const result = SiteContentSchema.safeParse(content);
      if (!result.success) {
        console.error("MongoDB site content failed contract validation.", result.error.issues);
        sendUnavailable(response, "Site content is unavailable.");
        return;
      }
      response.json(result.data);
    } catch (error) {
      console.error(
        "Failed to read site content from MongoDB.",
        error instanceof Error ? error.name : "UnknownError",
      );
      sendUnavailable(response, "Site content is unavailable.");
    }
  });

  return router;
}
