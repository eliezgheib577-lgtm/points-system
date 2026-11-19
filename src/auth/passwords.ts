import bcrypt from "bcryptjs";

const COST = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/**
 * Readable one-time password for credentials the VPA hands out in person.
 * Three words from a 64-word list plus four digits is about 2.6 billion
 * combinations — guessable only with far more attempts than the sign-in
 * limiter allows, and still short enough to read down a phone line.
 */
const WORDS = [
  "amber", "anchor", "basil", "beacon", "cedar", "cobalt", "coral", "crimson",
  "delta", "dune", "ember", "fable", "fern", "fjord", "flint", "garnet",
  "grove", "harbor", "hazel", "indigo", "ivory", "jasper", "jetty", "juniper",
  "kite", "lagoon", "lantern", "lotus", "maple", "marble", "meadow", "nimbus",
  "olive", "onyx", "opal", "orchard", "pebble", "pine", "prairie", "quartz",
  "quill", "raven", "reef", "ridge", "saffron", "sage", "slate", "sparrow",
  "spruce", "summit", "tamarind", "thistle", "tide", "topaz", "umber", "valley",
  "velvet", "willow", "wren", "yarrow", "zephyr", "cypress", "basalt", "cinder",
];

export function generatePassword(): string {
  const bytes = crypto.getRandomValues(new Uint32Array(4));
  const pick = (index: number) => WORDS[bytes[index]! % WORDS.length]!;
  const digits = String(bytes[3]! % 10000).padStart(4, "0");
  return `${pick(0)}-${pick(1)}-${pick(2)}-${digits}`;
}
