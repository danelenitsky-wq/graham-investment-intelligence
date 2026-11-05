import "server-only";
import { db } from "./db";
import { DEFAULT_SETTINGS, SETTINGS_KEY, settingsSchema, type AppSettings } from "@/lib/settings/schema";

export async function getSettings(): Promise<AppSettings> {
  const row = await db.appSetting.findUnique({ where: { key: SETTINGS_KEY } });
  if (!row) return DEFAULT_SETTINGS;
  const parsed = settingsSchema.safeParse(row.value);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function saveSettings(next: AppSettings): Promise<AppSettings> {
  const value = settingsSchema.parse(next);
  await db.appSetting.upsert({ where: { key: SETTINGS_KEY }, create: { key: SETTINGS_KEY, value }, update: { value } });
  return value;
}
