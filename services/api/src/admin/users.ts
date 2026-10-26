import { Router } from "express";
import { z } from "zod";
import type { Pool } from "pg";
import type { AuthRepository, PublicUser } from "../auth/repository.js";
import { requireAuthenticated, requireRoles } from "../auth/authorization.js";
import { validateRequest } from "../middleware/validate-request.js";
import { ApiRequestError } from "../request-error.js";

type ManagedUser = { id: string; email: string; role: "Patient" | "Doctor" | "Admin"; status: "active" | "inactive" | "locked"; createdAt: string; patientProfileComplete?: boolean; doctorApprovalStatus?: string | null; specialization?: string | null; qualification?: string | null; experienceYears?: number | null; city?: string | null; consultationFeeInr?: number | null };
type ManagedUserRow = { id: string; email: string; role: ManagedUser["role"]; status: ManagedUser["status"]; created_at: Date; patient_profile_complete: boolean; doctor_approval_status: string | null; specialization: string | null; qualification: string | null; experience_years: number | null; city: string | null; consultation_fee_inr: number | null };
type UserStatus = ManagedUser["status"];
type UserFilters = { search?: string; role?: ManagedUser["role"]; status?: UserStatus; patientProfileComplete?: boolean; doctorApprovalStatus?: string; page: number; pageSize: number };
type UserPage = { users: ManagedUser[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } };

export interface AdminUserRepository {
  list(filters: UserFilters): Promise<UserPage>;
  setStatus(id: string, status: UserStatus, actorId: string, requestId: string): Promise<ManagedUser | undefined>;
}

function mapUser(row: ManagedUserRow): ManagedUser {
  return { id: row.id, email: row.email, role: row.role, status: row.status, createdAt: row.created_at.toISOString(), patientProfileComplete: row.patient_profile_complete, doctorApprovalStatus: row.doctor_approval_status, specialization: row.specialization, qualification: row.qualification, experienceYears: row.experience_years, city: row.city, consultationFeeInr: row.consultation_fee_inr };
}

export class PostgresAdminUserRepository implements AdminUserRepository {
  constructor(private readonly db: Pool) {}

  async list(query: UserFilters): Promise<UserPage> {
    const values = [query.search ?? null, query.role ?? null, query.status ?? null, query.patientProfileComplete ?? null, query.doctorApprovalStatus ?? null];
    const [countResult, result] = await Promise.all([
      this.db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM users u LEFT JOIN doctors d ON d.user_id=u.id
         WHERE ($1::text IS NULL OR u.email ILIKE '%' || $1 || '%')
           AND ($2::text IS NULL OR u.role=$2) AND ($3::text IS NULL OR u.status=$3)
           AND ($4::boolean IS NULL OR EXISTS(SELECT 1 FROM patients p WHERE p.user_id=u.id)=$4)
           AND ($5::text IS NULL OR d.approval_status=$5)`, values
      ),
      this.db.query<ManagedUserRow>(
      `SELECT u.id,u.email,u.role,u.status,u.created_at,EXISTS(SELECT 1 FROM patients p WHERE p.user_id=u.id) AS patient_profile_complete,d.approval_status AS doctor_approval_status,d.specialization,d.qualification,d.experience_years,d.city,d.consultation_fee_inr FROM users u
       LEFT JOIN doctors d ON d.user_id=u.id
       WHERE ($1::text IS NULL OR u.email ILIKE '%' || $1 || '%')
         AND ($2::text IS NULL OR u.role=$2)
         AND ($3::text IS NULL OR u.status=$3)
         AND ($4::boolean IS NULL OR EXISTS(SELECT 1 FROM patients p WHERE p.user_id=u.id)=$4)
         AND ($5::text IS NULL OR d.approval_status=$5)
       ORDER BY u.created_at DESC,u.id LIMIT $6 OFFSET $7`,
      [...values, query.pageSize, (query.page - 1) * query.pageSize]
      )
    ]);
    const total = Number(countResult.rows[0]?.count ?? 0);
    return { users: result.rows.map(mapUser), pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } };
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
        "SELECT u.id,u.email,u.role,u.status,u.created_at,EXISTS(SELECT 1 FROM patients p WHERE p.user_id=u.id) AS patient_profile_complete,d.approval_status AS doctor_approval_status,d.specialization,d.qualification,d.experience_years,d.city,d.consultation_fee_inr FROM users u LEFT JOIN doctors d ON d.user_id=u.id WHERE u.id=$1 FOR UPDATE OF u",
        [id]
      );
      const current = rows[0];
      if (!current) { await client.query("COMMIT"); return undefined; }
      if (current.role === "Admin" && current.status === "active" && status !== "active") {
        if (activeAdmins.filter((admin) => admin.status === "active").length <= 1) {
          throw new ApiRequestError(409, "LAST_ACTIVE_ADMIN", "The last active administrator cannot be deactivated.");
        }
      }
      await client.query("UPDATE users SET status=$2, updated_at=now() WHERE id=$1", [id, status]);
      const updated = await client.query<ManagedUserRow>(
        "SELECT u.id,u.email,u.role,u.status,u.created_at,EXISTS(SELECT 1 FROM patients p WHERE p.user_id=u.id) AS patient_profile_complete,d.approval_status AS doctor_approval_status,d.specialization,d.qualification,d.experience_years,d.city,d.consultation_fee_inr FROM users u LEFT JOIN doctors d ON d.user_id=u.id WHERE u.id=$1",
        [id]
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
  status: z.enum(["active", "inactive", "locked"]).optional(),
  patientProfileComplete: z.enum(["true", "false"]).optional().transform((value) => value === undefined ? undefined : value === "true"),
  doctorApprovalStatus: z.enum(["pending", "approved", "rejected", "suspended"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25)
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
      const result = await service.list(query);
      response.json({ success: true, data: result, meta: { requestId: response.locals.requestId } });
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
