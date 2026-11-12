import {
  MongoClient,
  ReturnDocument,
  type Collection,
  type Db,
  type Document,
} from "mongodb";
import { PublicUnitSchema, SiteContentSchema } from "@cartogo/contracts";
import type { PublicDataRepository } from "./public-data.js";
import type { AdminDataRepository, ApprovalChallenge } from "./admin-api.js";
import type { BookingRepository, GuestChallenge } from "./booking.js";
import {
  recordEmailActivitySafely,
  type EmailActivityAction,
  type EmailActivityType,
} from "./email-activity.js";

type MongoDatabases = {
  client: MongoClient;
  site: Db;
  inquiries: Db;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

let client: MongoClient | undefined;
let connection: Promise<MongoClient> | undefined;
let bookingIndexes: Promise<void> | undefined;
let emailActivityIndexes: Promise<void> | undefined;

export async function connectToMongo(): Promise<MongoClient> {
  if (connection) return connection;

  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    throw new Error("MONGODB_URI is not configured.");
  }

  const connectingClient = new MongoClient(uri, {
    appName: "cartogo-version-ii-api",
    serverSelectionTimeoutMS: 5000,
  });
  client = connectingClient;
  connection = connectingClient.connect().catch(async (error: unknown) => {
    if (client === connectingClient) {
      client = undefined;
      connection = undefined;
    }
    try {
      await connectingClient.close();
    } catch (closeError) {
      console.error("Failed to close MongoDB client after a connection error.", closeError);
    }
    throw error;
  });
  return connection;
}

export async function getMongoDatabases(): Promise<MongoDatabases> {
  const connectedClient = await connectToMongo();
  return {
    client: connectedClient,
    site: connectedClient.db(process.env.MONGODB_SITE_DATABASE?.trim() || "Site"),
    inquiries: connectedClient.db(process.env.MONGODB_INQUIRIES_DATABASE?.trim() || "Sessions"),
  };
}

async function getEmailActivitiesCollection() {
  const { inquiries } = await getMongoDatabases();
  const collection = inquiries.collection<Document & {
    email_type: EmailActivityType;
    activity: EmailActivityAction;
    occurred_at: Date;
  }>("email_activities");
  if (!emailActivityIndexes) {
    emailActivityIndexes = collection.createIndex(
      { occurred_at: 1 },
      { name: "email_activity_time" },
    ).then(() => undefined).catch((error: unknown) => {
      emailActivityIndexes = undefined;
      throw error;
    });
  }
  await emailActivityIndexes;
  return collection;
}

export async function recordEmailActivity(
  emailType: EmailActivityType,
  activity: EmailActivityAction,
): Promise<void> {
  const collection = await getEmailActivitiesCollection();
  await collection.insertOne({
    email_type: emailType,
    activity,
    occurred_at: new Date(),
  });
}

export async function getPublicDataRepository(): Promise<PublicDataRepository> {
  const { site } = await getMongoDatabases();
  const units = site.collection(
    process.env.MONGODB_UNITS_COLLECTION?.trim() || "vehicles",
  );
  const siteAssets = site.collection(
    process.env.MONGODB_SITE_ASSETS_COLLECTION?.trim() || "site_assets",
  );
  const siteContent = site.collection<Document & { _id: string }>(
    process.env.MONGODB_SITE_CONTENT_COLLECTION?.trim() || "site_content",
  );

  return {
    async listPublicUnits() {
      return units
        .find(
          { status: { $ne: "Inactive" } },
          { projection: { _id: 0 } },
        )
        .sort({ id: 1 })
        .toArray();
    },
    async listSiteAssets() {
      return siteAssets
        .find({}, { projection: { _id: 0 } })
        .sort({ id: 1 })
        .toArray();
    },
    async getSiteContent() {
      return siteContent.findOne(
        { _id: "public" },
        { projection: { _id: 0 } },
      );
    },
  };
}

export async function getBookingRepository(): Promise<BookingRepository> {
  const { site, inquiries } = await getMongoDatabases();
  const units = site.collection<Document & { _id: number; id: number }>(
    process.env.MONGODB_UNITS_COLLECTION?.trim() || "vehicles",
  );
  const content = site.collection<Document & { _id: string }>(
    process.env.MONGODB_SITE_CONTENT_COLLECTION?.trim() || "site_content",
  );
  const inquiryCollection = inquiries.collection<Document & { _id: number; id: number }>(
    process.env.MONGODB_INQUIRIES_COLLECTION?.trim() || "inquiries",
  );
  const sequences = inquiries.collection<Document & { _id: string; value: number }>(
    process.env.MONGODB_SEQUENCES_COLLECTION?.trim() || "site_sequences",
  );
  const challenges = site.collection<Document & { _id: string }>(
    process.env.MONGODB_GUEST_CHALLENGES_COLLECTION?.trim() || "guest_email_challenges",
  );
  const emailOutbox = site.collection<Document & { _id: string }>(
    process.env.MONGODB_EMAIL_OUTBOX_COLLECTION?.trim() || "email_outbox",
  );

  if (!bookingIndexes) {
    bookingIndexes = Promise.all([
      inquiryCollection.createIndex(
        { client_request_id: 1 },
        { unique: true, sparse: true, name: "client_request_id_unique" },
      ),
      challenges.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
      challenges.createIndex({ email: 1, created_at: -1 }),
      challenges.createIndex({ ip_hash: 1, created_at: -1 }),
      emailOutbox.createIndex(
        { status: 1, next_attempt_at: 1, created_at: 1 },
        { name: "email_outbox_pending" },
      ),
    ]).then(() => undefined).catch((error: unknown) => {
      bookingIndexes = undefined;
      throw error;
    });
  }
  await bookingIndexes;

  const nextInquiryId = async (): Promise<number> => {
    const maximum = await inquiryCollection.findOne({}, { sort: { id: -1 }, projection: { id: 1 } });
    await sequences.updateOne(
      { _id: "inquiries" },
      { $max: { value: maximum?.id ?? 0 } },
      { upsert: true },
    );
    const sequence = await sequences.findOneAndUpdate(
      { _id: "inquiries" },
      { $inc: { value: 1 } },
      { returnDocument: ReturnDocument.AFTER },
    );
    if (!sequence) throw new Error("Could not allocate an inquiry ID.");
    return sequence.value;
  };
  const findInquiryByRequestId = async (requestId: string) =>
    inquiryCollection.findOne(
      { client_request_id: requestId },
      { projection: { _id: 0, client_request_id: 0 } },
    ) as Promise<(Record<string, unknown> & { id: number; email: string }) | null>;

  return {
    async getUnit(id) {
      const unit = await units.findOne({ _id: id }, { projection: { _id: 0 } });
      if (!unit) return null;
      return PublicUnitSchema.parse(unit);
    },
    async getBookingPricing() {
      const siteContent = await content.findOne({ _id: "public" }, { projection: { _id: 0 } });
      if (!siteContent) {
        throw new Error("Site booking pricing is not initialized.");
      }
      const parsed = SiteContentSchema.parse(siteContent);
      return {
        discountRules: parsed.discountRules,
        extraDriverFee: parsed.settings.extraDriverFee,
        childSeatFee: parsed.settings.childSeatFee,
      };
    },
    async findInquiryByRequestId(requestId) {
      return findInquiryByRequestId(requestId);
    },
    async createGuestChallenge(challenge: GuestChallenge) {
      const recent = await challenges.findOne({
        created_at: { $gt: new Date(challenge.created_at.valueOf() - 60_000) },
        $or: [{ email: challenge.email }, { ip_hash: challenge.ip_hash }],
      });
      if (recent) throw new Error("rate_limited");
      await challenges.insertOne({ ...challenge, _id: challenge.id });
    },
    async getGuestChallenge(id) {
      const result = await challenges.findOne({ _id: id }, { projection: { _id: 0 } });
      return result as GuestChallenge | null;
    },
    async incrementGuestChallengeAttempts(id, now) {
      const result = await challenges.findOneAndUpdate(
        { _id: id, attempts: { $lt: 5 }, expires_at: { $gt: now }, verified_at: { $exists: false } },
        { $inc: { attempts: 1 } },
        { returnDocument: ReturnDocument.AFTER },
      );
      return result?.attempts as number | undefined ?? null;
    },
    async saveGuestChallengeVerification(id, tokenHash, now) {
      const result = await challenges.updateOne(
        { _id: id, attempts: { $lte: 5 }, expires_at: { $gt: now }, verified_at: { $exists: false } },
        { $set: { verified_at: now, token_hash: tokenHash } },
      );
      return result.modifiedCount === 1;
    },
    async deleteGuestChallenge(id) {
      await challenges.deleteOne({ _id: id });
    },
    async consumeGuestChallenge(id, email, tokenHash, now) {
      const result = await challenges.findOneAndUpdate(
        {
          _id: id,
          email,
          token_hash: tokenHash,
          verified_at: { $exists: true },
          consumed_at: { $exists: false },
          expires_at: { $gt: now },
        },
        { $set: { consumed_at: now } },
        { returnDocument: ReturnDocument.AFTER, projection: { _id: 1 } },
      );
      return result !== null;
    },
    async releaseGuestChallenge(id, email, tokenHash) {
      await challenges.updateOne(
        { _id: id, email, token_hash: tokenHash, consumed_at: { $exists: true } },
        { $unset: { consumed_at: "" } },
      );
    },
    async addInquiry(inquiry, requestId) {
      const existing = await findInquiryByRequestId(requestId);
      if (existing) return existing;
      if (typeof inquiry.email !== "string") throw new Error("A valid inquiry email is required.");
      const id = await nextInquiryId();
      const timestamp = new Date().toISOString();
      const document = {
        ...inquiry,
        email: inquiry.email,
        id,
        _id: id,
        client_request_id: requestId,
        created_at: timestamp,
        verified_at: timestamp,
      };
      try {
        await inquiryCollection.insertOne(document);
      } catch (error) {
        const duplicate = await findInquiryByRequestId(requestId);
        if (duplicate) return duplicate;
        throw error;
      }
      const { _id: _insertedId, client_request_id: _requestId, ...result } = document;
      return result as Record<string, unknown> & { id: number; email: string };
    },
    async enqueueInquiryConfirmation(inquiry) {
      const now = new Date();
      const result = await emailOutbox.updateOne(
        { _id: `inquiry-confirmation:${inquiry.id}` },
        {
          $setOnInsert: {
            inquiry_id: inquiry.id,
            inquiry,
            status: "queued",
            attempts: 0,
            created_at: now,
            next_attempt_at: now,
          },
        },
        { upsert: true },
      );
      if (result.upsertedCount) {
        await recordEmailActivitySafely(recordEmailActivity, "inquiry_confirmation", "queued");
      }
    },
    async claimInquiryConfirmation(now) {
      const item = await emailOutbox.findOneAndUpdate(
        {
          $or: [
            { status: "queued", next_attempt_at: { $lte: now } },
            { status: "processing", locked_at: { $lte: new Date(now.valueOf() - 5 * 60_000) } },
          ],
        },
        {
          $set: { status: "processing", locked_at: now },
          $inc: { attempts: 1 },
        },
        { returnDocument: ReturnDocument.AFTER, sort: { created_at: 1 } },
      );
      return item as { _id: string; attempts: number; inquiry: Record<string, unknown> & { id: number; email: string } } | null;
    },
    async completeInquiryConfirmation(id, now) {
      const result = await emailOutbox.updateOne(
        { _id: id, status: "processing" },
        { $set: { status: "sent", sent_at: now }, $unset: { locked_at: "", last_error: "" } },
      );
      if (result.modifiedCount !== 1) throw new Error("The claimed inquiry email could not be marked as sent.");
    },
    async retryInquiryConfirmation(id, attempts, error, now) {
      const exhausted = attempts >= 5;
      const delayMinutes = Math.min(60, 2 ** Math.max(0, attempts - 1));
      const result = await emailOutbox.updateOne(
        { _id: id, status: "processing" },
        {
          $set: {
            status: exhausted ? "failed" : "queued",
            last_error: error,
            next_attempt_at: new Date(now.valueOf() + delayMinutes * 60_000),
          },
          $unset: { locked_at: "" },
        },
      );
      if (result.modifiedCount !== 1) throw new Error("The inquiry email retry state could not be saved.");
    },
  };
}

export async function getAdminDataRepository(): Promise<AdminDataRepository> {
  const { site, inquiries } = await getMongoDatabases();
  const units = site.collection<Document & { _id: number; id: number }>(
    process.env.MONGODB_UNITS_COLLECTION?.trim() || "vehicles",
  );
  const siteAssets = site.collection<Document & { _id: number; id: number }>(
    process.env.MONGODB_SITE_ASSETS_COLLECTION?.trim() || "site_assets",
  );
  const siteContent = site.collection<Document & { _id: string }>(
    process.env.MONGODB_SITE_CONTENT_COLLECTION?.trim() || "site_content",
  );
  const inquiryCollection = inquiries.collection<Document & { _id: number }>(
    process.env.MONGODB_INQUIRIES_COLLECTION?.trim() || "inquiries",
  );
  const emailActivities = await getEmailActivitiesCollection();
  const sequences = site.collection<Document & { _id: string; value: number }>(
    process.env.MONGODB_SEQUENCES_COLLECTION?.trim() || "site_sequences",
  );
  const adminRoles = site.collection<Document & { _id: string }>(
    process.env.MONGODB_ADMIN_ROLES_COLLECTION?.trim() || "admin_roles",
  );
  const ownerApprovals = site.collection<Document & { _id: string }>("owner_change_approvals");
  const chatSessions = site.collection<Document & { _id: string }>(
    process.env.MONGODB_CHAT_SESSIONS_COLLECTION?.trim() || "chat_sessions",
  );

  await ownerApprovals.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });

  const nextId = async (
    key: string,
    collection: Collection<Document & { _id: number; id: number }>,
  ): Promise<number> => {
    const maximum = await collection.findOne({}, { sort: { id: -1 }, projection: { id: 1 } });
    await sequences.updateOne(
      { _id: key },
      { $max: { value: maximum?.id ?? 0 } },
      { upsert: true },
    );
    const sequence = await sequences.findOneAndUpdate(
      { _id: key },
      { $inc: { value: 1 } },
      { returnDocument: ReturnDocument.AFTER },
    );
    if (!sequence) throw new Error("Could not allocate a document ID.");
    return sequence.value;
  };

  const getAdminRole = async (email: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    await Promise.all(
      Object.entries({
        Owner: ["inquiries", "fleet", "site_assets", "site_content", "chat", "analytics"],
        Developer: ["inquiries", "fleet", "site_assets", "site_content", "chat", "analytics"],
        Moderator: ["inquiries", "fleet", "site_assets", "site_content", "chat", "analytics"],
      }).map(([title, permissions]) =>
        adminRoles.updateOne(
          { _id: `title:${title}` },
          { $set: { title, permissions } },
          { upsert: true },
        ),
      ),
    );
    const record = await adminRoles.findOne({ _id: `account:${normalizedEmail}` });
    if (record) {
      return {
        email: normalizedEmail,
        titles: Array.isArray(record.titles) ? record.titles as string[] : [],
      };
    }
    const initialOwner = process.env.CARTOGO_INITIAL_OWNER_EMAIL?.trim().toLowerCase()
      || "remuelfernan07@gmail.com";
    const titles = initialOwner === normalizedEmail ? ["Owner"] : ["Moderator"];
    await adminRoles.updateOne(
      { _id: `account:${normalizedEmail}` },
      { $setOnInsert: { email: normalizedEmail, titles } },
      { upsert: true },
    );
    return { email: normalizedEmail, titles };
  };

  return {
    async listUnits() {
      return units.find({}).project({ _id: 0 }).sort({ id: 1 }).toArray();
    },
    async listSiteAssets() {
      return siteAssets.find({}).project({ _id: 0 }).sort({ id: 1 }).toArray();
    },
    async getSiteContent() {
      return siteContent.findOne({ _id: "public" }, { projection: { _id: 0 } });
    },
    async listInquiries() {
      return inquiryCollection.find({}).project({ _id: 0 }).sort({ created_at: -1 }).toArray();
    },
    async listEmailActivities(start, end, bucketMinutes) {
      const bucketMilliseconds = bucketMinutes * 60_000;
      const occurredAt = { $toLong: "$occurred_at" };
      return emailActivities.aggregate<{
        timestamp: Date;
        email_type: EmailActivityType;
        activity: EmailActivityAction;
        count: number;
      }>([
        { $match: { occurred_at: { $gte: start, $lt: end } } },
        {
          $group: {
            _id: {
              bucket: {
                $toDate: {
                  $subtract: [
                    occurredAt,
                    { $mod: [occurredAt, bucketMilliseconds] },
                  ],
                },
              },
              email_type: "$email_type",
              activity: "$activity",
            },
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            _id: 0,
            timestamp: "$_id.bucket",
            email_type: "$_id.email_type",
            activity: "$_id.activity",
            count: 1,
          },
        },
        { $sort: { timestamp: 1 } },
      ]).toArray();
    },
    async listVehicleDemand() {
      return inquiryCollection.aggregate<{
        vehicle_id: string;
        vehicle_name: string;
        inquiry_count: number;
      }>([
        {
          $group: {
            _id: {
              vehicle_id: { $ifNull: ["$car_id", "$carId"] },
              vehicle_name: { $ifNull: ["$car_name", "$carName"] },
            },
            inquiry_count: { $sum: 1 },
          },
        },
        {
          $project: {
            _id: 0,
            vehicle_id: { $ifNull: ["$_id.vehicle_id", ""] },
            vehicle_name: {
              $cond: [
                { $ne: ["$_id.vehicle_name", null] },
                "$_id.vehicle_name",
                { $concat: ["Vehicle ", { $toString: "$_id.vehicle_id" }] },
              ],
            },
            inquiry_count: 1,
          },
        },
        { $sort: { inquiry_count: -1, vehicle_name: 1 } },
        { $limit: 10 },
      ]).toArray();
    },
    async listChatSessions() {
      return chatSessions.find({}).project({ _id: 0 }).sort({ last_message_at: -1 }).toArray();
    },
    getAdminRole,
    async hasPermission(email, permission) {
      const role = await getAdminRole(email);
      if (!role) return false;
      const definitions = await adminRoles.find({
        _id: { $in: role.titles.map((title) => `title:${title}`) },
      }).toArray();
      return definitions.some((definition) =>
        Array.isArray(definition.permissions) && definition.permissions.includes(permission),
      );
    },
    async listOwnerEmails() {
      const records = await adminRoles
        .find(
          { _id: { $regex: "^account:" }, titles: { $in: ["Owner", "Developer"] } },
          { projection: { email: 1 } },
        )
        .toArray();
      return records.map((record) => String(record.email ?? "").trim().toLowerCase()).filter(Boolean);
    },
    async saveApproval(challenge) {
      await ownerApprovals.insertOne({ ...challenge, _id: challenge.id });
    },
    async getApproval(id) {
      const record = await ownerApprovals.findOne({ _id: id });
      if (!record) return null;
      const { _id, ...challenge } = record;
      const validResource = [
        "unit", "site_assets", "site_content", "chat_sessions",
      ].includes(String(challenge.resource));
      const validAction = ["add", "update", "delete"].includes(String(challenge.action));
      if (
        !validResource ||
        typeof challenge.requester_id !== "string" ||
        typeof challenge.requester_email !== "string" ||
        !Array.isArray(challenge.owner_emails) ||
        !challenge.owner_emails.every((email) => typeof email === "string") ||
        !validAction ||
        typeof challenge.data !== "object" ||
        challenge.data === null ||
        Array.isArray(challenge.data) ||
        typeof challenge.code_hash !== "string" ||
        !(challenge.expires_at instanceof Date) ||
        !(challenge.created_at instanceof Date) ||
        typeof challenge.attempts !== "number"
      ) {
        console.error("Stored owner approval challenge has invalid data.");
        return null;
      }
      return {
        id: String(_id),
        resource: challenge.resource as ApprovalChallenge["resource"],
        requester_id: challenge.requester_id,
        requester_email: challenge.requester_email,
        owner_emails: challenge.owner_emails,
        action: challenge.action as ApprovalChallenge["action"],
        data: challenge.data as Record<string, unknown>,
        code_hash: challenge.code_hash,
        expires_at: challenge.expires_at,
        created_at: challenge.created_at,
        attempts: challenge.attempts,
      };
    },
    async incrementApprovalAttempts(id) {
      const result = await ownerApprovals.findOneAndUpdate(
        { _id: id, expires_at: { $gt: new Date() }, attempts: { $lt: 5 } },
        { $inc: { attempts: 1 } },
        { returnDocument: ReturnDocument.AFTER },
      );
      return result?.attempts ?? null;
    },
    async consumeApproval(id) {
      const result = await ownerApprovals.deleteOne({ _id: id });
      return result.deletedCount === 1;
    },
    async applyUnitChange(action, unit) {
      if (action === "add") {
        const id = await nextId("vehicles", units);
        const document = { ...unit, id, _id: id };
        await units.insertOne(document);
        const { _id: _insertedId, ...result } = document;
        return result;
      }
      if (typeof unit.id !== "number") throw new Error("A valid unit ID is required.");
      if (action === "delete") {
        const result = await units.deleteOne({ _id: unit.id });
        if (!result.deletedCount) throw new Error("That unit no longer exists.");
        return { id: unit.id };
      }
      const updated = await units.findOneAndUpdate(
        { _id: unit.id },
        { $set: Object.fromEntries(Object.entries(unit).filter(([key]) => key !== "id")) },
        { returnDocument: ReturnDocument.AFTER, projection: { _id: 0 } },
      );
      if (!updated) throw new Error("That unit no longer exists.");
      return updated;
    },
    async applySiteAssetChange(action, asset) {
      if (action === "add") {
        const id = await nextId("site_assets", siteAssets);
        const document = { ...asset, id, _id: id };
        await ensureUniqueSiteAsset(siteAssets, document);
        await siteAssets.insertOne(document);
        const { _id: _insertedId, ...result } = document;
        return result;
      }
      if (typeof asset.id !== "number") throw new Error("A valid site asset ID is required.");
      if (action === "delete") {
        const result = await siteAssets.deleteOne({ _id: asset.id, asset_type: "location" });
        if (!result.deletedCount) throw new Error("That site location no longer exists.");
        return { id: asset.id };
      }
      const document = { ...asset, _id: asset.id };
      await ensureUniqueSiteAsset(siteAssets, document);
      const updated = await siteAssets.findOneAndUpdate(
        { _id: asset.id },
        { $set: Object.fromEntries(Object.entries(asset).filter(([key]) => key !== "id")) },
        { returnDocument: ReturnDocument.AFTER, projection: { _id: 0 } },
      );
      if (!updated) throw new Error("That site asset no longer exists.");
      return updated;
    },
    async updateSiteContent(update) {
      const current = await siteContent.findOne({ _id: "public" }, { projection: { _id: 0 } });
      if (!current) throw new Error("Site content is not initialized.");
      const merged = {
        ...current,
        ...(isRecord(update.settings) ? { settings: { ...current.settings, ...update.settings } } : {}),
        ...(isRecord(update.labels) ? { labels: { ...current.labels, ...update.labels } } : {}),
        ...(Array.isArray(update.discountRules) ? { discountRules: update.discountRules } : {}),
        ...(Array.isArray(update.socialLinks) ? { socialLinks: update.socialLinks } : {}),
      };
      const validated = SiteContentSchema.safeParse(merged);
      if (!validated.success) throw new Error("The updated site content does not match the public content contract.");
      const fields: Record<string, unknown> = {};
      if (isRecord(update.settings)) {
        for (const [key, value] of Object.entries(update.settings)) fields[`settings.${key}`] = value;
      }
      if (isRecord(update.labels)) {
        for (const [key, value] of Object.entries(update.labels)) fields[`labels.${key}`] = value;
      }
      if (Array.isArray(update.discountRules)) fields.discountRules = update.discountRules;
      if (Array.isArray(update.socialLinks)) fields.socialLinks = update.socialLinks;
      await siteContent.updateOne({ _id: "public" }, { $set: fields });
      const result = await siteContent.findOne({ _id: "public" }, { projection: { _id: 0 } });
      if (!result) throw new Error("Site content is not initialized.");
      return result;
    },
    async updateInquiryStatus(id, status) {
      const result = await inquiryCollection.findOneAndUpdate(
        { _id: id },
        { $set: { status } },
        { returnDocument: ReturnDocument.AFTER, projection: { _id: 0 } },
      );
      if (!result) throw new Error("That inquiry no longer exists.");
      return result;
    },
    async restoreInquiry(id) {
      const result = await inquiryCollection.findOneAndUpdate(
        { _id: id, status: "rejected" },
        { $set: { status: "pending_review" }, $unset: {
          rejection_reason: "", rejection_email_sent: "", rejection_email_sent_at: "",
        } },
        { returnDocument: ReturnDocument.AFTER, projection: { _id: 0 } },
      );
      if (result) return result;
      const exists = await inquiryCollection.findOne({ _id: id }, { projection: { _id: 1 } });
      if (!exists) throw new Error("That inquiry no longer exists.");
      throw new Error("Only rejected inquiries can be restored.");
    },
    async rejectInquiry(id, reason) {
      const result = await inquiryCollection.findOneAndUpdate(
        { _id: id, status: { $ne: "rejected" } },
        { $set: { status: "rejected", rejection_reason: reason, rejection_email_sent: false } },
        { returnDocument: ReturnDocument.AFTER, projection: { _id: 0 } },
      );
      if (result) return result;
      const exists = await inquiryCollection.findOne({ _id: id }, { projection: { _id: 1 } });
      if (!exists) throw new Error("That inquiry no longer exists.");
      throw new Error("This inquiry has already been rejected.");
    },
    async getInquiry(id) {
      return inquiryCollection.findOne({ _id: id }, { projection: { _id: 0 } });
    },
    async markInquiryRejectionEmailSent(id) {
      const result = await inquiryCollection.findOneAndUpdate(
        { _id: id, status: "rejected" },
        { $set: { rejection_email_sent: true, rejection_email_sent_at: new Date().toISOString() } },
        { returnDocument: ReturnDocument.AFTER, projection: { _id: 0 } },
      );
      if (!result) throw new Error("The rejected inquiry no longer exists.");
      return result;
    },
    async deleteInquiry(id) {
      const result = await inquiryCollection.deleteOne({ _id: id });
      if (!result.deletedCount) throw new Error("That inquiry no longer exists.");
      return { id };
    },
    async deleteChatSession(id) {
      const result = await chatSessions.deleteOne({ _id: id });
      if (!result.deletedCount) throw new Error("That chat session no longer exists.");
      return { id };
    },
  };
}

async function ensureUniqueSiteAsset(
  collection: Collection<Document & { _id: number; id: number }>,
  asset: Record<string, unknown>,
): Promise<void> {
  const query: Record<string, unknown> = { asset_type: asset.asset_type };
  if (asset.asset_type === "location") query.loc_name = asset.loc_name;
  if (asset.id !== undefined) query.id = { $ne: asset.id };
  if (await collection.findOne(query)) {
    throw new Error(
      asset.asset_type === "location"
        ? "A pickup location with that name already exists."
        : "A live-agent contact record already exists.",
    );
  }
}

export async function checkMongoReady(): Promise<void> {
  const { client: connectedClient } = await getMongoDatabases();
  await connectedClient.db("admin").command({ ping: 1 });
}

export async function closeMongo(): Promise<void> {
  const closingClient = client;
  client = undefined;
  connection = undefined;
  if (closingClient) await closingClient.close();
}
