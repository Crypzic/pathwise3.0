// Password hashing + auth helpers.
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// Shape of the data we embed in the login token.
export interface JwtUser {
  sub: string; // user id
  email: string;
}
