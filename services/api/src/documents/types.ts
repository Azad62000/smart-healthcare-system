import type { Pool } from "pg";
import type { DocumentStorageFormat } from "./storage.js";

export type DocumentMediaType = "application/pdf" | "image/jpeg" | "image/png";
export type DocumentAction = "upload" | "list" | "download" | "delete";

export interface AppointmentDocument {
  id: string;
  appointmentId: string;
  filename: string;
  mediaType: DocumentMediaType;
  byteSize: number;
  uploaderName: string;
  uploadedAt: string;
  canDelete: boolean;
}

export interface NewAppointmentDocument {
  appointmentId: string;
  patientId: string;
  doctorId: string;
  uploaderUserId: string;
  storageKey: string;
  filename: string;
  mediaType: DocumentMediaType;
  byteSize: number;
  storageFormat: DocumentStorageFormat;
  requestId: string;
}

export interface AppointmentDocumentRepository {
  list(appointmentId: string, actorUserId: string, requestId: string): Promise<AppointmentDocument[]>;
  create(input: NewAppointmentDocument): Promise<AppointmentDocument>;
  findForDownload(appointmentId: string, documentId: string, actorUserId: string, requestId: string): Promise<(AppointmentDocument & { storageKey: string; storageFormat: DocumentStorageFormat }) | undefined>;
  delete(appointmentId: string, documentId: string, actorUserId: string, requestId: string): Promise<{ storageKey: string; mediaType: DocumentMediaType } | undefined>;
}

export class PostgresAppointmentDocumentRepository implements AppointmentDocumentRepository {
  constructor(private readonly db: Pool) {}

  async list(appointmentId: string, actorUserId: string, requestId: string): Promise<AppointmentDocument[]> {
    const { rows } = await this.db.query<{
      id: string; appointment_id: string; filename: string; media_type: DocumentMediaType;
      byte_size: number; uploader_name: string; created_at: Date; storage_key: string; can_delete: boolean;
    }>(
      `SELECT doc.id,doc.appointment_id,doc.filename,doc.media_type,doc.byte_size,
        COALESCE(uploader_doctor.given_name || ' ' || uploader_doctor.family_name,
          uploader_patient.given_name || ' ' || uploader_patient.family_name,'Participant') AS uploader_name,
        doc.created_at,doc.storage_key,
        (doc.uploader_user_id=$2 AND a.starts_at>now() AND a.status IN ('booked','confirmed')) AS can_delete
       FROM appointment_documents doc
       JOIN appointments a ON a.id=doc.appointment_id
       JOIN users u ON u.id=doc.uploader_user_id
       LEFT JOIN doctors uploader_doctor ON uploader_doctor.user_id=u.id
       LEFT JOIN patients uploader_patient ON uploader_patient.user_id=u.id
       WHERE doc.appointment_id=$1 AND doc.deleted_at IS NULL ORDER BY doc.created_at DESC,doc.id`,
      [appointmentId, actorUserId]
    );
    if (rows.length) {
      const client = await this.db.connect();
      try {
        await client.query("BEGIN");
        for (const row of rows) {
          await client.query(
            `INSERT INTO appointment_document_access_events(document_id,appointment_id,actor_user_id,action,request_id)
             VALUES($1,$2,$3,'list',$4)`,
            [row.id, appointmentId, actorUserId, requestId]
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    }
    return rows.map((row) => ({
      id: row.id,
      appointmentId: row.appointment_id,
      filename: row.filename,
      mediaType: row.media_type,
      byteSize: row.byte_size,
      uploaderName: row.uploader_name,
      uploadedAt: row.created_at.toISOString(),
      canDelete: row.can_delete
    }));
  }

  async create(input: NewAppointmentDocument): Promise<AppointmentDocument> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<{
        id: string; appointment_id: string; filename: string; media_type: DocumentMediaType;
        byte_size: number; uploader_name: string; created_at: Date;
      }>(
        `INSERT INTO appointment_documents(appointment_id,patient_id,doctor_id,uploader_user_id,storage_key,filename,media_type,byte_size,storage_format)
         SELECT a.id,a.patient_id,a.doctor_id,$4,$5,$6,$7,$8,$9 FROM appointments a
         WHERE a.id=$1 AND a.patient_id=$2 AND a.doctor_id=$3
         RETURNING id,appointment_id,filename,media_type,byte_size,created_at`,
        [input.appointmentId, input.patientId, input.doctorId, input.uploaderUserId,
          input.storageKey, input.filename, input.mediaType, input.byteSize, input.storageFormat]
      );
      if (!rows[0]) throw new Error("Appointment changed while the document was being saved.");
      const uploader = await client.query<{ name: string }>(
        `SELECT COALESCE(d.given_name || ' ' || d.family_name,p.given_name || ' ' || p.family_name,'Participant') AS name
         FROM users u LEFT JOIN doctors d ON d.user_id=u.id LEFT JOIN patients p ON p.user_id=u.id WHERE u.id=$1`,
        [input.uploaderUserId]
      );
      await client.query(
        `INSERT INTO appointment_document_access_events(document_id,appointment_id,actor_user_id,action,request_id)
         VALUES($1,$2,$3,'upload',$4)`,
        [rows[0].id, input.appointmentId, input.uploaderUserId, input.requestId]
      );
      await client.query("COMMIT");
      return {
        id: rows[0].id, appointmentId: rows[0].appointment_id, filename: rows[0].filename,
        mediaType: rows[0].media_type, byteSize: rows[0].byte_size,
        uploaderName: uploader.rows[0]?.name ?? "Participant", uploadedAt: rows[0].created_at.toISOString(), canDelete: true
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async findForDownload(appointmentId: string, documentId: string, actorUserId: string, requestId: string): Promise<(AppointmentDocument & { storageKey: string; storageFormat: DocumentStorageFormat }) | undefined> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<{
        id: string; appointment_id: string; filename: string; media_type: DocumentMediaType;
        byte_size: number; uploader_name: string; created_at: Date; storage_key: string; storage_format: DocumentStorageFormat;
      }>(
        `SELECT doc.id,doc.appointment_id,doc.filename,doc.media_type,doc.byte_size,
          COALESCE(uploader_doctor.given_name || ' ' || uploader_doctor.family_name,
            uploader_patient.given_name || ' ' || uploader_patient.family_name,'Participant') AS uploader_name,
          doc.created_at,doc.storage_key,doc.storage_format
         FROM appointment_documents doc JOIN users u ON u.id=doc.uploader_user_id
         LEFT JOIN doctors uploader_doctor ON uploader_doctor.user_id=u.id
         LEFT JOIN patients uploader_patient ON uploader_patient.user_id=u.id
         WHERE doc.id=$1 AND doc.appointment_id=$2 AND doc.deleted_at IS NULL FOR UPDATE OF doc`,
        [documentId, appointmentId]
      );
      if (!rows[0]) { await client.query("COMMIT"); return undefined; }
      await client.query(
        `INSERT INTO appointment_document_access_events(document_id,appointment_id,actor_user_id,action,request_id)
         VALUES($1,$2,$3,'download',$4)`,
        [documentId, appointmentId, actorUserId, requestId]
      );
      await client.query("COMMIT");
      const row = rows[0];
      return {
        id: row.id, appointmentId: row.appointment_id, filename: row.filename, mediaType: row.media_type,
        byteSize: row.byte_size, uploaderName: row.uploader_name, uploadedAt: row.created_at.toISOString(),
        storageKey: row.storage_key, storageFormat: row.storage_format, canDelete: false
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async delete(appointmentId: string, documentId: string, actorUserId: string, requestId: string): Promise<{ storageKey: string; mediaType: DocumentMediaType } | undefined> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<{ storage_key: string; media_type: DocumentMediaType }>(
        `UPDATE appointment_documents doc SET deleted_at=now(),deleted_by=$3
         FROM appointments a
         WHERE doc.id=$1 AND doc.appointment_id=$2 AND doc.uploader_user_id=$3 AND doc.deleted_at IS NULL
           AND a.id=doc.appointment_id AND a.starts_at>now() AND a.status IN ('booked','confirmed')
         RETURNING doc.storage_key,doc.media_type`,
        [documentId, appointmentId, actorUserId]
      );
      if (!rows[0]) { await client.query("COMMIT"); return undefined; }
      await client.query(
        `INSERT INTO appointment_document_access_events(document_id,appointment_id,actor_user_id,action,request_id)
         VALUES($1,$2,$3,'delete',$4)`,
        [documentId, appointmentId, actorUserId, requestId]
      );
      await client.query("COMMIT");
      return { storageKey: rows[0].storage_key, mediaType: rows[0].media_type };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
}
