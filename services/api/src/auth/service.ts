import bcrypt from "bcryptjs";
import type { AuthRepository, PublicUser } from "./repository.js";
import { ApiRequestError } from "../request-error.js";

const credentialsError = () => new ApiRequestError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");

export class AuthService {
  constructor(private readonly repository: AuthRepository) {}

  async register(email: string, password: string): Promise<PublicUser> {
    try {
      return await this.repository.createPatient(email, password);
    } catch (error) {
      if ((error as { code?: string })?.code === "23505") {
        throw new ApiRequestError(409, "ACCOUNT_EXISTS", "An account with this email already exists.");
      }
      throw error;
    }
  }

  async login(email: string, password: string): Promise<PublicUser> {
    const user = await this.repository.findByEmail(email);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) throw credentialsError();
    if (user.status !== "active") throw credentialsError();
    if (user.email_verified === false) throw new ApiRequestError(403, "EMAIL_NOT_VERIFIED", "Verify your email address before signing in.");
    const { password_hash: _discarded, ...publicUser } = user;
    return publicUser;
  }
}
