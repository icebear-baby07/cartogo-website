import { MongoClient, type Db } from "mongodb";

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
