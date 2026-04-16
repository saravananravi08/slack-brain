import { writeFile, mkdir } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILES_DIR = join(__dirname, "files");

export async function downloadSlackFile(url: string, token: string): Promise<Buffer> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Failed to download file: ${response.statusText}`);
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function saveFileForClaude(buffer: Buffer, filename: string): Promise<string> {
  if (!existsSync(FILES_DIR)) {
    await mkdir(FILES_DIR, { recursive: true });
  }
  const timestamp = Date.now();
  const safeName = filename.replace(/[^a-zA-Z0-9.-]/g, "_");
  const filepath = join(FILES_DIR, `${timestamp}-${safeName}`);
  await writeFile(filepath, buffer);
  return filepath;
}
