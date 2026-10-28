DELETE FROM notification_deliveries WHERE channel='sms';
ALTER TABLE notification_deliveries DROP CONSTRAINT notification_deliveries_channel_check;
ALTER TABLE notification_deliveries ADD CONSTRAINT notification_deliveries_channel_check CHECK (channel='email');
ALTER TABLE patients DROP COLUMN sms_notifications_enabled;
