import type { PoolClient } from "pg";

type AppointmentEvent = "created" | "cancelled" | "status_changed";

export async function queueAppointmentNotifications(
  client: PoolClient,
  appointmentId: string,
  eventType: AppointmentEvent,
  eventDetail?: string,
  adminWording = false
): Promise<void> {
  const title = eventType === "created" ? (adminWording ? "Appointment scheduled" : "Appointment booked") : eventType === "cancelled" ? "Appointment cancelled" : adminWording ? "Appointment updated" : "Appointment status updated";
  const message = eventType === "created" ? "An appointment has been scheduled." : eventType === "cancelled" ? "An appointment has been cancelled." : adminWording ? "An appointment has been rescheduled." : "An appointment status has changed.";
  await client.query(
    `INSERT INTO notifications(recipient_user_id,event_key,appointment_id,event_type,title,message)
     SELECT participant.user_id,$2 || ':' || a.id::text || ':' || COALESCE($5,''),a.id,$2,$3,$4
     FROM appointments a
     CROSS JOIN LATERAL (VALUES(a.patient_id),((SELECT user_id FROM doctors WHERE id=a.doctor_id))) participant(user_id)
     WHERE a.id=$1 AND participant.user_id IS NOT NULL
     ON CONFLICT(recipient_user_id,event_key) DO NOTHING`,
    [appointmentId, eventType, title, message, eventDetail ?? null]
  );
  let emailType: string | undefined;
  if (eventType === "created") emailType = adminWording ? "appointment_confirmed" : "appointment_booked";
  else if (eventType === "cancelled") emailType = "appointment_cancelled";
  else if (eventType === "status_changed" && eventDetail === "rescheduled") emailType = "appointment_rescheduled";
  else if (eventType === "status_changed" && eventDetail?.endsWith("-confirmed")) emailType = "appointment_confirmed";
  if (emailType) await queueAppointmentEmails(client, appointmentId, emailType);
}

export async function queueDoctorJoinedNotification(client: PoolClient, patientId: string, appointmentId: string): Promise<void> {
  await client.query(
    `INSERT INTO notifications(recipient_user_id,event_key,appointment_id,event_type,title,message)
     VALUES($1,$2,$3,'doctor_joined','Your doctor has joined','Your doctor has joined the video consultation. You can join the room now.')
     ON CONFLICT(recipient_user_id,event_key) DO NOTHING`,
    [patientId, `doctor_joined:${appointmentId}`, appointmentId]
  );
  await queueEmailToUser(client, patientId, `doctor_joined:${appointmentId}`, "doctor_joined", "Your doctor has joined the video call", "Your doctor has joined the video call. Sign in to Smart Healthcare to join the consultation.");
}

export async function queueEmailToUser(client: PoolClient, userId: string, eventKey: string, eventType: string, subject: string, body: string): Promise<void> {
  await client.query(
    `INSERT INTO email_outbox(recipient_user_id,event_key,event_type,subject,body)
     SELECT id,$2,$3,$4,$5 FROM users WHERE id=$1 AND status='active' AND email_verified=true
     ON CONFLICT(recipient_user_id,event_key) DO NOTHING`,
    [userId, eventKey, eventType, subject, body]
  );
}

export async function queueAdminSecurityAlert(client: PoolClient, eventKey: string, subject: string, body: string): Promise<void> {
  await client.query(
    `INSERT INTO email_outbox(recipient_user_id,event_key,event_type,subject,body)
     SELECT id,$1,'admin_security',$2,$3 FROM users WHERE role='Admin' AND status='active' AND email_verified=true
     ON CONFLICT(recipient_user_id,event_key) DO NOTHING`,
    [eventKey, subject, body]
  );
}

export async function queueAppointmentScheduledEmails(client: PoolClient, videoConfigured = true): Promise<void> {
  await client.query(
    `INSERT INTO email_outbox(recipient_user_id,event_key,event_type,subject,body)
     SELECT participant.user_id,'appointment:reminder24h:' || a.id::text || ':' || to_char(a.starts_at AT TIME ZONE 'UTC','YYYYMMDDHH24MISS'),
       'appointment_reminder','Appointment reminder',
       'You have an appointment in about 24 hours. Sign in to Smart Healthcare to review the current details.'
     FROM appointments a
     CROSS JOIN LATERAL (VALUES(a.patient_id),((SELECT user_id FROM doctors WHERE id=a.doctor_id))) participant(user_id)
     JOIN users u ON u.id=participant.user_id
     WHERE a.status IN ('booked','confirmed') AND a.starts_at>now()+interval '22 hours' AND a.starts_at<=now()+interval '24 hours'
       AND u.status='active' AND u.email_verified=true
     ON CONFLICT(recipient_user_id,event_key) DO NOTHING`
  );
  await client.query(
    `INSERT INTO email_outbox(recipient_user_id,event_key,event_type,subject,body)
     SELECT participant.user_id,'appointment:room-open:' || a.id::text || ':' || to_char(a.starts_at AT TIME ZONE 'UTC','YYYYMMDDHH24MISS'),
       'video_room_open','Your video consultation room is opening',
       'Your video consultation is scheduled to begin soon. Sign in to Smart Healthcare to join the room.'
     FROM appointments a
     JOIN teleconsultations tc ON tc.appointment_id=a.id
     CROSS JOIN LATERAL (VALUES(a.patient_id),((SELECT user_id FROM doctors WHERE id=a.doctor_id))) participant(user_id)
     JOIN users u ON u.id=participant.user_id
     WHERE $1::boolean AND a.appointment_type='video' AND a.status IN ('booked','confirmed') AND tc.status IN ('scheduled','ready')
       AND a.starts_at>now() AND a.starts_at<=now()+interval '15 minutes'
       AND u.status='active' AND u.email_verified=true
     ON CONFLICT(recipient_user_id,event_key) DO NOTHING`
    , [videoConfigured]
  );
}

async function queueAppointmentEmails(client: PoolClient, appointmentId: string, eventType: string): Promise<void> {
  const subject = eventType === "appointment_booked" ? "Appointment booked"
    : eventType === "appointment_confirmed" ? "Appointment confirmed"
      : eventType === "appointment_rescheduled" ? "Appointment rescheduled" : "Appointment cancelled";
  const body = `${subject}. Sign in to Smart Healthcare to review the appointment details.`;
  await client.query(
    `INSERT INTO email_outbox(recipient_user_id,event_key,event_type,subject,body)
     SELECT participant.user_id,'appointment:' || $1::text || ':' || $2 || ':' || to_char(a.starts_at AT TIME ZONE 'UTC','YYYYMMDDHH24MISS'),$2,$3,$4
     FROM appointments a
     CROSS JOIN LATERAL (VALUES(a.patient_id),((SELECT user_id FROM doctors WHERE id=a.doctor_id))) participant(user_id)
     JOIN users u ON u.id=participant.user_id
     WHERE a.id=$1 AND u.status='active' AND u.email_verified=true
     ON CONFLICT(recipient_user_id,event_key) DO NOTHING`,
    [appointmentId, eventType, subject, body]
  );
}
