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

/** Readable one-time password for credentials the VPA hands out in person. */
export function generatePassword(): string {
  const words = ["amber", "basil", "cedar", "delta", "ember", "fjord", "grove", "harbor",
                 "indigo", "jasper", "kite", "lotus", "maple", "nimbus", "olive", "quartz"];
  const pick = () => words[Math.floor(Math.random() * words.length)]!;
  const digits = String(Math.floor(Math.random() * 90) + 10);
  return `${pick()}-${pick()}-${digits}`;
}
