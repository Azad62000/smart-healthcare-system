import { Router } from "express";
import { z } from "zod";
import type { Pool } from "pg";
import type { AuthRepository, PublicUser } from "../auth/repository.js";
import { requireAuthenticated, requireRoles } from "../auth/authorization.js";
import { validateRequest } from "../middleware/validate-request.js";
import { ApiRequestError } from "../request-error.js";

type ManagedUser = { id: string; email: string; role: "Patient" | "Doctor" | "Admin"; status: "active" | "inactive" | "locked"; createdAt: string };
type ManagedUserRow = { id: string; email: string; role: ManagedUser["role"]; status: ManagedUser["status"]; created_at: Date };
type UserStatus = ManagedUser["status"];
type UserFilters = { search?: string; role?: ManagedUser["role"]; status?: UserStatus };

export interface AdminUserRepository {
  list(filters: UserFilters): Promise<ManagedUser[]>;
  setStatus(id: string, status: UserStatus, actorId: string, requestId: string): Promise<ManagedUser | undefined>;
}

function mapUser(row: ManagedUserRow): ManagedUser {
  return { id: row.id, email: row.email, role: row.role, status: row.status, createdAt: row.created_at.toISOString() };
}

export class PostgresAdminUserRepository implements AdminUserRepository {
  constructor(private readonly db: Pool) {}

  async list(query: UserFilters): Promise<ManagedUser[]> {
    const { rows } = await this.db.query<ManagedUserRow>(
      `SELECT id, email, role, status, created_at FROM users
       WHERE ($1::text IS NULL OR email ILIKE '%' || $1 || '%')
         AND ($2::text IS NULL OR role=$2)
         AND ($3::text IS NULL OR status=$3)
       ORDER BY created_at DESC, id LIMIT 100`,
      [query.search ?? null, query.role ?? null, query.status ?? null]
    );
    return rows.map(mapUser);
  }

  async setStatus(id: string, status: UserStatus, actorId: string, requestId: string): Promise<ManagedUser | undefined> {
    if (id === actorId && status !== "active") throw new ApiRequestError(400, "CANNOT_DEACTIVATE_SELF", "You cannot deactivate or lock your own account.");
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const { rows: activeAdmins } = await client.query<{ id: string; status: UserStatus }>(
        "SELECT id, status FROM users WHERE role='Admin' FOR UPDATE"
      );
      const { rows } = await client.query<ManagedUserRow>(
        "SELECT id, email, role, status, created_at FROM users WHERE id=$1 FOR UPDATE",
        [id]
      );
      const current = rows[0];
      if (!current) { await client.query("COMMIT"); return undefined; }
      if (current.role === "Admin" && current.status === "active" && status !== "active") {
        if (activeAdmins.filter((admin) => admin.status === "active").length <= 1) {
          throw new ApiRequestError(409, "LAST_ACTIVE_ADMIN", "The last active administrator cannot be deactivated.");
        }
      }
      const updated = await client.query<ManagedUserRow>(
        "UPDATE users SET status=$2, updated_at=now() WHERE id=$1 RETURNING id, email, role, status, created_at",
        [id, status]
      );
      await client.query(
        `INSERT INTO admin_audit_events(actor_user_id,target_user_id,action,previous_value,new_value,request_id)
         VALUES($1,$2,'user.status.changed',$3,$4,$5)`,
        [actorId, id, current.status, status, requestId]
      );
      await client.query("COMMIT");
      return mapUser(updated.rows[0]!);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export class AdminUserService {
  constructor(private readonly repository: AdminUserRepository) {}

  list(query: UserFilters) { return this.repository.list(query); }

  async setStatus(id: string, status: UserStatus, actor: PublicUser, requestId: string): Promise<ManagedUser> {
    const user = await this.repository.setStatus(id, status, actor.id, requestId);
    if (!user) throw new ApiRequestError(404, "USER_NOT_FOUND", "User was not found.");
    return user;
  }
}

const querySchema = z.object({
  search: z.string().trim().max(254).optional(),
  role: z.enum(["Patient", "Doctor", "Admin"]).optional(),
  status: z.enum(["active", "inactive", "locked"]).optional()
}).strict();
const statusSchema = z.object({ status: z.enum(["active", "inactive", "locked"]) }).strict();

function currentAdmin(response: Parameters<import("express").RequestHandler>[1]): PublicUser {
  const user = response.locals.user as PublicUser | undefined;
  if (!user) throw new ApiRequestError(401, "UNAUTHENTICATED", "Authentication is required.");
  return user;
}

export function createAdminUserRouter(auth: AuthRepository, repository: AdminUserRepository, cookieName: string): Router {
  const router = Router();
  const service = new AdminUserService(repository);
  router.use(requireAuthenticated(auth, cookieName), requireRoles("Admin"));
  router.get("/", validateRequest({ query: querySchema }), async (_request, response, next) => {
    try {
      const query = response.locals.validated.query as z.infer<typeof querySchema>;
      const users = await service.list(query);
      response.json({ success: true, data: { users }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });
  router.patch("/:id/status", validateRequest({ params: z.object({ id: z.string().uuid() }), body: statusSchema }), async (_request, response, next) => {
    try {
      const { id } = response.locals.validated.params as { id: string };
      const { status } = response.locals.validated.body as { status: UserStatus };
      const user = await service.setStatus(id, status, currentAdmin(response), response.locals.requestId);
      response.json({ success: true, data: { user }, meta: { requestId: response.locals.requestId } });
    } catch (error) { next(error); }
  });
  return router;
}
