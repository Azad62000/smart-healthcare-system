INSERT INTO teleconsultations(appointment_id, room_name)
SELECT a.id, 'consult-' || replace(gen_random_uuid()::text, '-', '')
FROM appointments a
WHERE a.appointment_type = 'video'
  AND NOT EXISTS (
    SELECT 1 FROM teleconsultations tc WHERE tc.appointment_id = a.id
  );
