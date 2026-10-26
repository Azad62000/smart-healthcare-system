import type { Pool } from "pg";
import type { PatientProfile, PatientProfileInput, PatientRepository } from "./types.js";

interface PatientRow {
  user_id: string; given_name: string; family_name: string; date_of_birth: string | Date; phone: string;
  address_line: string | null; city: string | null; postal_code: string | null; created_at: Date; updated_at: Date;
}

function mapPatient(row: PatientRow): PatientProfile {
  return {
    userId: row.user_id,
    givenName: row.given_name,
    familyName: row.family_name,
    dateOfBirth: row.date_of_birth instanceof Date ? row.date_of_birth.toISOString().slice(0, 10) : row.date_of_birth,
    phone: row.phone,
    addressLine: row.address_line,
    city: row.city,
    postalCode: row.postal_code,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

const returning = "user_id, given_name, family_name, date_of_birth, phone, address_line, city, postal_code, created_at, updated_at";

export class PostgresPatientRepository implements PatientRepository {
  constructor(private readonly db: Pool) {}

  async findByUserId(userId: string): Promise<PatientProfile | undefined> {
    const result = await this.db.query<PatientRow>(`SELECT ${returning} FROM patients WHERE user_id = $1`, [userId]);
    return result.rows[0] && mapPatient(result.rows[0]);
  }

  async create(userId: string, profile: PatientProfileInput): Promise<PatientProfile> {
    const result = await this.db.query<PatientRow>(
      `INSERT INTO patients (user_id, given_name, family_name, date_of_birth, phone, address_line, city, postal_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (user_id) DO UPDATE SET given_name=EXCLUDED.given_name, family_name=EXCLUDED.family_name,
         date_of_birth=EXCLUDED.date_of_birth, phone=EXCLUDED.phone, address_line=EXCLUDED.address_line,
         city=EXCLUDED.city, postal_code=EXCLUDED.postal_code, updated_at=now()
       RETURNING ${returning}`,
      [userId, profile.givenName, profile.familyName, profile.dateOfBirth, profile.phone, profile.addressLine, profile.city, profile.postalCode]
    );
    return mapPatient(result.rows[0]!);
  }

  async update(userId: string, profile: PatientProfileInput): Promise<PatientProfile | undefined> {
    const result = await this.db.query<PatientRow>(
      `UPDATE patients SET given_name=$2, family_name=$3, date_of_birth=$4, phone=$5, address_line=$6, city=$7, postal_code=$8, updated_at=now()
       WHERE user_id=$1 RETURNING ${returning}`,
      [userId, profile.givenName, profile.familyName, profile.dateOfBirth, profile.phone, profile.addressLine, profile.city, profile.postalCode]
    );
    return result.rows[0] && mapPatient(result.rows[0]);
  }
}
