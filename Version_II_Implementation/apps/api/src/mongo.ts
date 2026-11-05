import {
  MongoClient,
  ReturnDocument,
  type Collection,
  type Db,
  type Document,
} from "mongodb";
import { SiteContentSchema } from "@cartogo/contracts";
import type { PublicDataRepository } from "./public-data.js";
import type { AdminDataRepository, ApprovalChallenge } from "./admin-api.js";

type MongoDatabases = {
  client: MongoClient;
  inquiries: Db;
  site: Db;
};

let client: MongoClient | undefined;
let connection: Promise<MongoClient> | undefined;

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
    inquiries: connectedClient.db(process.env.MONGODB_DATABASE?.trim() || "cartogo"),
    site: connectedClient.db(process.env.MONGODB_SITE_DATABASE?.trim() || "Site"),
  };
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

export async function getAdminDataRepository(): Promise<AdminDataRepository> {
  const { inquiries: inquiryDb, site } = await getMongoDatabases();
  const units = site.collection<Document & { _id: number; id: number }>(
    process.env.MONGODB_UNITS_COLLECTION?.trim() || "vehicles",
  );
  const siteAssets = site.collection<Document & { _id: number; id: number }>(
    process.env.MONGODB_SITE_ASSETS_COLLECTION?.trim() || "site_assets",
  );
  const siteContent = site.collection<Document & { _id: string }>(
    process.env.MONGODB_SITE_CONTENT_COLLECTION?.trim() || "site_content",
  );
  const inquiryCollection = inquiryDb.collection<Document & { _id: number }>(
    process.env.MONGODB_INQUIRIES_COLLECTION?.trim() || "inquiries",
  );
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
        Owner: ["inquiries", "fleet", "site_assets", "site_content", "chat", "admin_accounts"],
        Moderator: ["inquiries", "fleet", "site_assets", "site_content", "chat"],
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
    async listChatSessions() {
      return chatSessions.find({}).project({ _id: 0 }).sort({ last_message_at: -1 }).toArray();
    },
    getAdminRole,
    async listAdminRoles(emails) {
      const roles = await Promise.all(emails.map(getAdminRole));
      return roles.sort((left, right) => left.email.localeCompare(right.email));
    },
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
        .find({ _id: { $regex: "^account:" }, titles: "Owner" }, { projection: { email: 1 } })
        .toArray();
      return records.map((record) => String(record.email ?? "").trim().toLowerCase()).filter(Boolean);
    },
    async setAdminTitles(email, titles) {
      const normalizedEmail = email.trim().toLowerCase();
      const existing = await adminRoles.findOne({ _id: `account:${normalizedEmail}` });
      if (!existing) throw new Error("That administrator account was not found.");
      if (!titles.includes("Owner") && existing.titles?.includes("Owner")) {
        const ownerCount = await adminRoles.countDocuments({
          _id: { $regex: "^account:" },
          titles: "Owner",
        });
        if (ownerCount <= 1) throw new Error("At least one Owner account must remain.");
      }
      await adminRoles.updateOne(
        { _id: `account:${normalizedEmail}` },
        { $set: { titles } },
      );
      return getAdminRole(normalizedEmail);
    },
    async saveApproval(challenge) {
      await ownerApprovals.insertOne({ ...challenge, _id: challenge.id });
    },
    async getApproval(id) {
      const record = await ownerApprovals.findOne({ _id: id });
      if (!record) return null;
      const { _id, ...challenge } = record;
      const validResource = [
        "unit", "site_assets", "site_content", "admin_accounts", "admin_roles", "chat_sessions",
      ].includes(String(challenge.resource));
      const validAction = ["add", "update", "delete", "remove"].includes(String(challenge.action));
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
        ...(update.settings ? { settings: { ...current.settings, ...update.settings } } : {}),
        ...(update.labels ? { labels: { ...current.labels, ...update.labels } } : {}),
      };
      const validated = SiteContentSchema.safeParse(merged);
      if (!validated.success) throw new Error("The updated site content does not match the public content contract.");
      const fields: Record<string, unknown> = {};
      if (update.settings) {
        for (const [key, value] of Object.entries(update.settings)) fields[`settings.${key}`] = value;
      }
      if (update.labels) {
        for (const [key, value] of Object.entries(update.labels)) fields[`labels.${key}`] = value;
      }
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
    async removeAdminRole(email) {
      await adminRoles.deleteOne({ _id: `account:${email.trim().toLowerCase()}` });
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
