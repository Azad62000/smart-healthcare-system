-- Disposable, entirely synthetic local demo accounts and records.
-- Passwords below are public demonstration credentials, not production secrets.
-- Run only against a local development database. All identifiers are reserved
-- for these demo records; the reset script deletes only these identifiers.
BEGIN;

INSERT INTO users (id, email, password_hash, role, status, email_verified) VALUES
  ('00000000-0000-4000-8000-000000000001', 'demo.admin@example.test', crypt('LocalAdmin!2026', gen_salt('bf', 8)), 'Admin', 'active', true),
  ('00000000-0000-4000-8000-000000000002', 'demo.doctor@example.test', crypt('LocalDoctor!2026', gen_salt('bf', 8)), 'Doctor', 'active', true),
  ('00000000-0000-4000-8000-000000000003', 'demo.patient@example.test', crypt('LocalPatient!2026', gen_salt('bf', 8)), 'Patient', 'active', true)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  password_hash = EXCLUDED.password_hash,
  role = EXCLUDED.role,
  status = EXCLUDED.status,
  email_verified = EXCLUDED.email_verified,
  updated_at = now();

INSERT INTO patients (user_id, given_name, family_name, date_of_birth, phone, address_line, city, postal_code)
VALUES ('00000000-0000-4000-8000-000000000003', 'Taylor', 'Example', DATE '1990-04-12', '+1-555-0100', '100 Demo Lane', 'Sample City', '00000')
ON CONFLICT (user_id) DO UPDATE SET
  given_name = EXCLUDED.given_name, family_name = EXCLUDED.family_name,
  date_of_birth = EXCLUDED.date_of_birth, phone = EXCLUDED.phone,
  address_line = EXCLUDED.address_line, city = EXCLUDED.city,
  postal_code = EXCLUDED.postal_code, updated_at = now();

INSERT INTO doctors (id, user_id, given_name, family_name, specialization, qualification, experience_years, bio, approval_status)
VALUES ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'Jordan', 'Example', 'Family Medicine', 'MD (synthetic demo)', 8, 'Synthetic demonstration profile. Not a real clinician.', 'approved')
ON CONFLICT (id) DO UPDATE SET
  user_id = EXCLUDED.user_id, given_name = EXCLUDED.given_name,
  family_name = EXCLUDED.family_name, specialization = EXCLUDED.specialization,
  qualification = EXCLUDED.qualification, experience_years = EXCLUDED.experience_years,
  bio = EXCLUDED.bio, approval_status = EXCLUDED.approval_status, updated_at = now();

-- Rebuild this reserved demo doctor's future availability on every seed run.
DELETE FROM doctor_availability WHERE doctor_id = '10000000-0000-4000-8000-000000000001';
INSERT INTO doctor_availability (doctor_id, starts_at, ends_at)
VALUES (
  '10000000-0000-4000-8000-000000000001',
  (date_trunc('day', now() AT TIME ZONE 'UTC') + interval '2 days 10 hours') AT TIME ZONE 'UTC',
  (date_trunc('day', now() AT TIME ZONE 'UTC') + interval '2 days 11 hours') AT TIME ZONE 'UTC'
), (
  '10000000-0000-4000-8000-000000000001',
  (date_trunc('day', now() AT TIME ZONE 'UTC') + interval '2 days 11 hours') AT TIME ZONE 'UTC',
  (date_trunc('day', now() AT TIME ZONE 'UTC') + interval '2 days 12 hours') AT TIME ZONE 'UTC'
);

INSERT INTO appointments (id, patient_id, doctor_id, starts_at, ends_at, status, created_by)
VALUES
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001',
   (date_trunc('day', now() AT TIME ZONE 'UTC') - interval '3 days' + interval '10 hours') AT TIME ZONE 'UTC',
   (date_trunc('day', now() AT TIME ZONE 'UTC') - interval '3 days' + interval '11 hours') AT TIME ZONE 'UTC',
   'completed', '00000000-0000-4000-8000-000000000003'),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001',
   (date_trunc('day', now() AT TIME ZONE 'UTC') + interval '2 days 11 hours') AT TIME ZONE 'UTC',
   (date_trunc('day', now() AT TIME ZONE 'UTC') + interval '2 days 12 hours') AT TIME ZONE 'UTC',
   'booked', '00000000-0000-4000-8000-000000000003')
ON CONFLICT (id) DO UPDATE SET
  patient_id = EXCLUDED.patient_id, doctor_id = EXCLUDED.doctor_id,
  starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at,
  status = EXCLUDED.status, created_by = EXCLUDED.created_by, updated_at = now();

INSERT INTO appointment_status_history (appointment_id, actor_user_id, from_status, to_status)
SELECT appointment_id, actor_user_id, from_status, to_status
FROM (VALUES
  ('20000000-0000-4000-8000-000000000001'::uuid, '00000000-0000-4000-8000-000000000003'::uuid, NULL::text, 'booked'::text),
  ('20000000-0000-4000-8000-000000000001'::uuid, '00000000-0000-4000-8000-000000000002'::uuid, 'booked'::text, 'confirmed'::text),
  ('20000000-0000-4000-8000-000000000001'::uuid, '00000000-0000-4000-8000-000000000002'::uuid, 'confirmed'::text, 'completed'::text),
  ('20000000-0000-4000-8000-000000000002'::uuid, '00000000-0000-4000-8000-000000000003'::uuid, NULL::text, 'booked'::text)
) AS demo_history(appointment_id, actor_user_id, from_status, to_status)
WHERE NOT EXISTS (
  SELECT 1 FROM appointment_status_history h
  WHERE h.appointment_id = demo_history.appointment_id
    AND h.to_status = demo_history.to_status
    AND h.actor_user_id = demo_history.actor_user_id
    AND h.from_status IS NOT DISTINCT FROM demo_history.from_status
);

INSERT INTO consultation_records (id, patient_id, doctor_id, appointment_id, consultation_at, note, diagnosis)
VALUES (
  '30000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  (date_trunc('day', now() AT TIME ZONE 'UTC') - interval '3 days' + interval '10 hours') AT TIME ZONE 'UTC',
  'Synthetic demo consultation. No real medical information.',
  'Demo-only: general wellness review'
)
ON CONFLICT (id) DO UPDATE SET
  patient_id = EXCLUDED.patient_id, doctor_id = EXCLUDED.doctor_id,
  appointment_id = EXCLUDED.appointment_id, consultation_at = EXCLUDED.consultation_at,
  note = EXCLUDED.note, diagnosis = EXCLUDED.diagnosis, updated_at = now();

DELETE FROM health_record_access_events WHERE request_id = 'local-demo-seed';
INSERT INTO health_record_access_events (actor_user_id, patient_id, record_id, action, request_id)
VALUES ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000001', 'create', 'local-demo-seed')
ON CONFLICT DO NOTHING;

INSERT INTO notifications (recipient_user_id, event_key, appointment_id, event_type, title, message)
VALUES
  ('00000000-0000-4000-8000-000000000003', 'created:20000000-0000-4000-8000-000000000002:', '20000000-0000-4000-8000-000000000002', 'created', 'Appointment booked', 'An appointment has been booked.'),
  ('00000000-0000-4000-8000-000000000002', 'created:20000000-0000-4000-8000-000000000002:', '20000000-0000-4000-8000-000000000002', 'created', 'Appointment booked', 'An appointment has been booked.')
ON CONFLICT (recipient_user_id, event_key) DO NOTHING;

COMMIT;
