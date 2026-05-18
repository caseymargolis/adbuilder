import { NextResponse } from "next/server";
import { dbBackend } from "@/lib/db";

/**
 * Emergency endpoint to reset corrupted data.
 * Only works with JSON backend (Postgres users should use SQL).
 */
export async function POST(req: Request) {
  if (dbBackend() !== "json") {
    return NextResponse.json(
      { error: "This endpoint only works with JSON backend. Use SQL for Postgres." },
      { status: 400 },
    );
  }

  const { confirm } = (await req.json()) as { confirm?: string };
  if (confirm !== "RESET_ALL_DATA") {
    return NextResponse.json(
      { error: 'Must send { confirm: "RESET_ALL_DATA" } to proceed.' },
      { status: 400 },
    );
  }

  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const DATA_DIR = path.join(process.cwd(), ".data");
    const CLIENTS_FILE = path.join(DATA_DIR, "clients.json");

    // Backup first
    await fs.mkdir(DATA_DIR, { recursive: true });
    try {
      await fs.access(CLIENTS_FILE);
      await fs.copyFile(CLIENTS_FILE, CLIENTS_FILE + ".backup." + Date.now());
    } catch {
      // File doesn't exist, no backup needed
    }

    // Reset to empty array
    await fs.writeFile(CLIENTS_FILE, "[]", "utf8");

    return NextResponse.json({ success: true, message: "Data reset successfully" });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}
