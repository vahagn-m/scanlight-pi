// Server-side RGB preset store: JSON file shared across all clients.
// Corrupt/missing file -> empty list. Writes are debounced and atomic
// (temp file + rename) so a crash can never leave a half-written file.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_DIR = process.env.PRESETS_DIR || path.join(APP_ROOT, "data");
const PRESETS_FILE = path.join(DATA_DIR, "presets.json");

const SAVE_DEBOUNCE_MS = 300;

let presets = [];
let saveTimer = null;
let writeChain = Promise.resolve();

function isValid(p) {
  return (
    p &&
    typeof p.name === "string" &&
    p.name.length > 0 &&
    [p.red, p.green, p.blue].every((v) => Number.isInteger(v) && v >= 0 && v <= 255)
  );
}

const clone = (p) => ({ name: p.name, red: p.red, green: p.green, blue: p.blue });

/** Load presets from disk; tolerate missing/corrupt files. Idempotent. */
export async function load() {
  try {
    const raw = await fs.readFile(PRESETS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    presets = Array.isArray(parsed) ? parsed.filter(isValid) : [];
  } catch {
    presets = [];
  }
  return list();
}

export function list() {
  return presets.map(clone);
}

function find(name) {
  return presets.find((p) => p.name.toLowerCase() === String(name).toLowerCase());
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeChain = writeChain.then(writeNow).catch((err) => {
      console.error("[presets] save failed:", err.message);
    });
  }, SAVE_DEBOUNCE_MS);
}

async function writeNow() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${PRESETS_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(presets, null, 2), "utf8");
  await fs.rename(tmp, PRESETS_FILE);
}

/** @returns updated list. Throws on bad input. */
export function create({ name, red, green, blue }) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) throw new Error("preset name is empty");
  if (find(trimmed)) throw new Error(`preset "${trimmed}" already exists`);
  const preset = { name: trimmed, red, green, blue };
  if (!isValid(preset)) throw new Error("invalid preset RGB values");
  presets.push(preset);
  scheduleSave();
  return list();
}

/** @returns updated list. Throws if not found / name clash. */
export function rename({ oldName, newName }) {
  const preset = find(oldName);
  if (!preset) throw new Error(`preset "${oldName}" not found`);
  const trimmed = String(newName ?? "").trim();
  if (!trimmed) throw new Error("preset name is empty");
  const clash = find(trimmed);
  if (clash && clash !== preset) throw new Error(`preset "${trimmed}" already exists`);
  preset.name = trimmed;
  scheduleSave();
  return list();
}

/** @returns updated list. Throws if not found. */
export function remove({ name }) {
  const idx = presets.findIndex(
    (p) => p.name.toLowerCase() === String(name).toLowerCase()
  );
  if (idx === -1) throw new Error(`preset "${name}" not found`);
  presets.splice(idx, 1);
  scheduleSave();
  return list();
}
