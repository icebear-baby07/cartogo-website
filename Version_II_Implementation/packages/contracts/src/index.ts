import { z } from "zod";

export const ApiHealthSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("cartogo-version-ii-api"),
});
export type ApiHealth = z.infer<typeof ApiHealthSchema>;

export const ApiReadinessSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    dependencies: z.object({ mongodb: z.literal("ok") }),
  }),
  z.object({
    status: z.literal("not_ready"),
    dependencies: z.object({ mongodb: z.literal("unavailable") }),
  }),
]);
export type ApiReadiness = z.infer<typeof ApiReadinessSchema>;

export const ApiErrorSchema = z.object({
  error: z.string().min(1),
  code: z.string().min(1).optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

const PositiveIdSchema = z.number().int().positive();
const NonNegativeRateSchema = z.number().finite().nonnegative();

export const VehicleStatusSchema = z.enum([
  "Available",
  "Rented",
  "Maintenance",
  "Inactive",
]);
export type VehicleStatus = z.infer<typeof VehicleStatusSchema>;

export const PublicUnitSchema = z
  .object({
    id: PositiveIdSchema,
    display_name: z.string().min(1),
    brand: z.string().min(1),
    model: z.string().min(1),
    capacity: z.number().int().positive(),
    in12_rate: NonNegativeRateSchema,
    in24_rate: NonNegativeRateSchema,
    out12_rate: NonNegativeRateSchema,
    out24_rate: NonNegativeRateSchema,
    luzon_rate: NonNegativeRateSchema,
    status: VehicleStatusSchema,
    features: z.array(z.string()),
  })
  .passthrough();
export type PublicUnit = z.infer<typeof PublicUnitSchema>;
export const PublicUnitsResponseSchema = z.array(PublicUnitSchema);

const AssetStatusSchema = z.enum(["open", "closed"]);
const SiteAssetBaseSchema = z
  .object({
    id: PositiveIdSchema,
    display_name: z.string().min(1),
    description: z.string(),
    status: AssetStatusSchema,
  })
  .passthrough();

export const SiteAssetSchema = z.discriminatedUnion("asset_type", [
  SiteAssetBaseSchema.extend({
    asset_type: z.literal("location"),
    loc_name: z.string().min(1).optional(),
    coordinates: z.object({
      lat: z.number().finite().min(-90).max(90),
      lng: z.number().finite().min(-180).max(180),
    }),
    opening_hours: z.string().optional(),
    closing_hours: z.string().optional(),
  }),
  SiteAssetBaseSchema.extend({
    asset_type: z.literal("contact"),
    phone: z.string().optional(),
    email: z.string().optional(),
    operational_hours: z.string().optional(),
    opening_hours: z.string().optional(),
    closing_hours: z.string().optional(),
  }),
]);
export type SiteAsset = z.infer<typeof SiteAssetSchema>;
export const SiteAssetsResponseSchema = z.array(SiteAssetSchema);

export const SiteContentSchema = z
  .object({
    settings: z
      .object({
        companyName: z.string().min(1),
        tagline: z.string(),
        currency: z.string().min(1),
        depositPercent: z.number().finite().nonnegative(),
        extraDriverFee: z.number().finite().nonnegative(),
        childSeatFee: z.number().finite().nonnegative(),
        lateFeePerHour: z.number().finite().nonnegative(),
      })
      .passthrough(),
    labels: z
      .object({
        hero: z.object({
          title: z.string(),
          subtitle: z.string(),
        }),
        trustStrip: z.array(
          z.object({ value: z.string(), label: z.string() }).passthrough(),
        ),
        howItWorks: z.array(
          z.object({ title: z.string(), description: z.string() }).passthrough(),
        ),
        whyChooseUs: z.array(
          z
            .object({
              icon: z.string(),
              title: z.string(),
              description: z.string(),
            })
            .passthrough(),
        ),
        about: z.object({ title: z.string(), body: z.string() }),
        faq: z.array(
          z.object({ q: z.string(), a: z.string() }).passthrough(),
        ),
        testimonials: z.array(
          z
            .object({
              quote: z.string(),
              name: z.string(),
              detail: z.string(),
            })
            .passthrough(),
        ),
      })
      .passthrough(),
    discountRules: z.array(
      z
        .object({
          minDays: z.number().int().positive(),
          maxDays: z.number().int().positive(),
          percent: z.number().finite().min(0).max(100),
        })
        .passthrough(),
    ),
    socialLinks: z.array(
      z
        .object({
          platform: z.enum(["facebook", "instagram", "x"]),
          label: z.string(),
          url: z.string(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export type SiteContent = z.infer<typeof SiteContentSchema>;
