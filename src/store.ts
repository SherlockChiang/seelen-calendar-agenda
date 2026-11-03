// Per-widget JSON files under %APPDATA%\com.seelen.seelen-ui\data\<widget>\.
// Seelen scopes read/write_data_file to the calling widget's folder, unlike
// localStorage, which every third-party widget shares (same tauri.localhost origin).

import { invoke, SeelenCommand } from "@seelen-ui/lib";

export async function readJson<T>(filename: string): Promise<T | null> {
  try {
    const text = await invoke(SeelenCommand.ReadFile, { filename });
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    // Missing file or corrupt JSON: treat as empty.
    return null;
  }
}

export async function writeJson(filename: string, value: unknown): Promise<void> {
  await invoke(SeelenCommand.WriteFile, { filename, content: JSON.stringify(value) });
}

export async function removeJson(filename: string): Promise<void> {
  // There is no delete command; an empty file reads back as null.
  await invoke(SeelenCommand.WriteFile, { filename, content: "" });
}
