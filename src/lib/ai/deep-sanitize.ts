/**
 * deepSanitize — recursively walks an object and coerces all leaf values
 * that should be strings into actual strings. This prevents React #310
 * "Objects are not valid as a React child" when the LLM returns nested
 * objects where strings are expected.
 */

type StringMap = Record<string, unknown>;

/** Coerce any value to a string. */
function toStr(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try { return JSON.stringify(v); }
  catch { return String(v); }
}

/** Fields in the GeneratedCase that must be strings. */
const STRING_PATHS: string[][] = [
  ["title"],
  ["briefing"],
  ["situation"],
  ["stakes"],
  ["difficulty"],
  ["suspect", "name"],
  ["suspect", "role"],
  ["suspect", "avatar"],
  ["suspect", "gender"],
  ["suspect", "identity"],
  ["suspect", "truth"],
  ["suspect", "culpability"],
  ["suspect", "demeanor"],
  ["suspect", "breakingLine"],
  ["suspect", "alibi", "claimed"],
  ["suspect", "alibi", "actual"],
];

/** Fields that are arrays of strings and need each item coerced. */
const STRING_ARRAY_PATHS: string[][] = [
  ["suspect", "counterQuestions"],
  ["suspect", "alibi", "witnesses"],
  ["suggestedQuestions"],
];

/** Fields inside arrays of objects that need string coercion. */
const NESTED_STRING_PATHS: Array<{ arrayPath: string[]; itemPaths: string[][] }> = [
  {
    arrayPath: ["suspect", "lies"],
    itemPaths: [["topic"], ["match"], ["underPressure"]],
  },
  {
    arrayPath: ["suspect", "stressRules"],
    itemPaths: [["label"]],
  },
  {
    arrayPath: ["evidence"],
    itemPaths: [["id"], ["label"], ["description"], ["unlockTopic"]],
  },
  {
    arrayPath: ["timeline"],
    itemPaths: [["time"], ["event"]],
  },
  // lie variations are arrays of strings inside each lie
  {
    arrayPath: ["suspect", "lies"],
    itemPaths: [],
    childArrays: [{ childArrayPath: ["variations"] }],
  },
];

function get(obj: StringMap, path: string[]): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as StringMap)[key];
  }
  return current;
}

function set(obj: StringMap, path: string[], value: unknown): void {
  let current: StringMap = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (current[key] === null || current[key] === undefined || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key] as StringMap;
  }
  current[path[path.length - 1]] = value;
}

export function deepSanitize(data: unknown): void {
  if (!data || typeof data !== "object") return;
  const obj = data as StringMap;

  // Fix top-level and nested string fields
  for (const path of STRING_PATHS) {
    const val = get(obj, path);
    if (val !== undefined && val !== null) {
      set(obj, path, toStr(val));
    }
  }

  // Fix arrays of strings
  for (const path of STRING_ARRAY_PATHS) {
    const arr = get(obj, path);
    if (Array.isArray(arr)) {
      set(obj, path, arr.map(toStr));
    }
  }

  // Fix nested string fields inside arrays of objects
  for (const { arrayPath, itemPaths, childArrays } of NESTED_STRING_PATHS) {
    const arr = get(obj, arrayPath);
    if (!Array.isArray(arr)) continue;
    const sanitized = arr.map((item: unknown) => {
      if (!item || typeof item !== "object") return item;
      const itemObj = { ...item } as StringMap;
      for (const ip of itemPaths) {
        const val = get(itemObj, ip);
        if (val !== undefined && val !== null) {
          set(itemObj, ip, toStr(val));
        }
      }
      // Handle child arrays of strings (e.g., lie.variations)
      if (childArrays) {
        for (const ca of childArrays) {
          const childArr = get(itemObj, ca.childArrayPath);
          if (Array.isArray(childArr)) {
            set(itemObj, ca.childArrayPath, childArr.map(toStr));
          }
        }
      }
      return itemObj;
    });
    set(obj, arrayPath, sanitized);
  }

  // Finally, do a brute-force sweep: any string-typed field that's not a string
  // in the GeneratedCase interface gets coerced. Walk ALL leaf nodes.
  bruteForceSanitize(obj);
}

/** Walk all leaf nodes and coerce non-string primitives to strings where appropriate. */
function bruteForceSanitize(obj: unknown): void {
  if (obj === null || obj === undefined) return;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if (typeof obj[i] === "object" && obj[i] !== null) {
        bruteForceSanitize(obj[i]);
      } else if (typeof obj[i] !== "number" && typeof obj[i] !== "boolean" && typeof obj[i] !== "string") {
        obj[i] = toStr(obj[i]);
      }
    }
    return;
  }
  if (typeof obj === "object") {
    const record = obj as StringMap;
    for (const key of Object.keys(record)) {
      const val = record[key];
      if (val === null || val === undefined) continue;
      if (typeof val === "object") {
        bruteForceSanitize(val);
      } else if (typeof val !== "number" && typeof val !== "boolean" && typeof val !== "string") {
        record[key] = toStr(val);
      }
    }
  }
}
