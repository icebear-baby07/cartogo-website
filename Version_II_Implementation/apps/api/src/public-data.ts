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
type PublicFleetRepository = Pick<PublicDataRepository, "listPublicUnits">;
type PublicSiteAssetRepository = Pick<PublicDataRepository, "listSiteAssets">;
type PublicSiteContentRepository = Pick<PublicDataRepository, "getSiteContent">;

function sendUnavailable(
  response: Response,
  message: string,
): void {
  response.status(503).json(ApiErrorSchema.parse({ error: message }));
}

export function createPublicDataRouter(
  getRepository: RepositoryProvider,
  fleetRepository?: PublicFleetRepository,
  siteAssetRepository?: PublicSiteAssetRepository,
  siteContentRepository?: PublicSiteContentRepository,
): Router {
  const router = Router();

  router.get("/public/units", async (_request, response) => {
    try {
      const units = fleetRepository
        ? await fleetRepository.listPublicUnits()
        : await (await getRepository()).listPublicUnits();
      const result = PublicUnitsResponseSchema.safeParse(units);
      if (!result.success) {
        console.error("Public fleet data failed contract validation.", result.error.issues);
        sendUnavailable(response, "Public fleet data is unavailable.");
        return;
      }
      response.json(result.data);
    } catch (error) {
      console.error(
        "Failed to read public fleet data.",
        error instanceof Error ? error.name : "UnknownError",
      );
      sendUnavailable(response, "Public fleet data is unavailable.");
    }
  });

  router.get("/site-assets", async (_request, response) => {
    try {
      const assets = siteAssetRepository
        ? await siteAssetRepository.listSiteAssets()
        : await (await getRepository()).listSiteAssets();
      const result = SiteAssetsResponseSchema.safeParse(assets);
      if (!result.success) {
        console.error("Site assets failed contract validation.", result.error.issues);
        sendUnavailable(response, "Site assets are unavailable.");
        return;
      }
      response.json(result.data);
    } catch (error) {
      console.error(
        "Failed to read site assets.",
        error instanceof Error ? error.name : "UnknownError",
      );
      sendUnavailable(response, "Site assets are unavailable.");
    }
  });

  router.get("/site-content", async (_request, response) => {
    try {
      const content = siteContentRepository
        ? await siteContentRepository.getSiteContent()
        : await (await getRepository()).getSiteContent();
      if (content === null) {
        sendUnavailable(response, "Site content is not initialized.");
        return;
      }
      const result = SiteContentSchema.safeParse(content);
      if (!result.success) {
        console.error("Public site content failed contract validation.", result.error.issues);
        sendUnavailable(response, "Site content is unavailable.");
        return;
      }
      response.json(result.data);
    } catch (error) {
      console.error(
        "Failed to read public site content.",
        error instanceof Error ? error.name : "UnknownError",
      );
      sendUnavailable(response, "Site content is unavailable.");
    }
  });

  return router;
}
