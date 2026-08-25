import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const storePath = path.resolve(__dirname, "../../../data/saas-tenants.json");

let writeQueue = Promise.resolve();

const readStore = async () => {
  try {
    return JSON.parse(await readFile(storePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
};

const writeStore = async (store) => {
  await mkdir(path.dirname(storePath), { recursive: true });
  writeQueue = writeQueue.then(() => writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8"));
  return writeQueue;
};

export const saasStore = {
  async getBusinessConfig(businessId) {
    const store = await readStore();
    return store[businessId] || null;
  },

  async saveBusinessConfig(businessId, config) {
    const store = await readStore();
    store[businessId] = {
      ...(store[businessId] || {}),
      ...config,
      business_id: businessId,
      updated_at: new Date().toISOString(),
    };
    await writeStore(store);
    return store[businessId];
  },
};

