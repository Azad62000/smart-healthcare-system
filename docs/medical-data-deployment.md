# Medical-data migration, backup, and recovery runbook

This runbook describes a controlled deployment procedure. It is not evidence that a backup has been taken, restored, or verified. Do not run the real-data conversion apply path until each required approval and restore check is complete.

## 1. Establish the actual schema

1. Identify the target database through the approved secret/configuration system without copying credentials into shell history or logs.
2. Inspect `app_schema_migrations` if it exists. Validate every recorded filename and checksum against the deployed migration files. A migration file's presence is not evidence that it ran.
3. If the ledger is absent, do not run `db:migrate`. Take a backup and restore it into an isolated database first.
4. Create a disposable reference database and apply migrations through the candidate version using the same application release. Compare the target and reference schema-only dumps. Review all differences; account only for the expected ledger-table difference. The baseline command performs additional marker-column checks but is not a substitute for this comparison.
5. If any schema difference is unexplained, the target version is ambiguous, or historical migrations may have been applied manually, stop. Do not baseline or apply migrations until a DBA has resolved the discrepancy.

After a reviewed comparison, record only the verified contiguous prefix. For example, when the target schema was fully compared through migration 015:

```sh
npm run db:baseline -w @healthcare/api -- --through=015_auth_login_rate_limits.sql --confirm-reviewed-schema
```

For a confirmed 016 schema, use `--through=016_medical_data_encryption.sql`. The runner refuses to baseline an empty schema, requires the confirmation flag, checks known required columns, and rejects later migration markers. Baseline writes checksums for the existing migration files into the ledger; it does not execute historical SQL and cannot attest to historical data-only effects. Migration 010 retains its one-time update for reserved demo identities; do not replay it manually or assume baseline establishes their historical verification state.

## 2. Back up a consistent database and document set

1. Schedule a maintenance window. Stop or drain every API instance and any other process that can write messages, document metadata, or private files. Confirm no old or new application writer remains active.
2. Identify the configured private document storage directory. Ensure the database and directory are backed up from one quiescent point. Protect backup destinations with restrictive permissions and the organization's approved encryption-at-rest controls.
3. Use PostgreSQL's approved service/secret mechanism for credentials. Do not put passwords directly in commands, scripts, shell history, or logs. A custom-format database archive can be created with:

   ```sh
   umask 077
   pg_dump --format=custom --no-owner \
     --file="$BACKUP_DIR/smart-healthcare.dump" \
     --dbname="service=smart-healthcare-backup"
   pg_restore --list "$BACKUP_DIR/smart-healthcare.dump" >/dev/null
   shasum -a 256 "$BACKUP_DIR/smart-healthcare.dump" > "$BACKUP_DIR/smart-healthcare.dump.sha256"
   ```

   The named service is configured in a protected `pg_service.conf`. Ensure `$BACKUP_DIR` is an encrypted, access-controlled backup destination and does not stage plaintext archives on an unprotected volume. `pg_restore --list` verifies that the archive is readable; it does not prove that a restore succeeds. Record the digest in a separately protected change/backup record and verify it again after copying or retrieving the archive.
4. Archive the entire private document directory without placing it under the public web root. Use an encrypted, access-controlled destination and avoid plaintext staging:

   ```sh
   tar -cpf "$BACKUP_DIR/private-documents.tar" -C "$DOCUMENT_STORAGE_DIR" .
   shasum -a 256 "$BACKUP_DIR/private-documents.tar" > "$BACKUP_DIR/private-documents.tar.sha256"
   ```

   A plain `tar` archive is not encrypted; the destination must provide approved encryption at rest. Record its digest separately and verify it after transfer/retrieval.
5. Record backup identifiers, timestamps, software versions, and the exact schema version in the change record. Do not include secrets or patient content.

## 3. Back up keys separately

Back up the exact `MEDICAL_DATA_ENCRYPTION_KEYS` keyring through the approved secret manager or encrypted key escrow, separate from both database and document archives. Preserve every key ID that may be referenced by stored envelopes. Restrict recovery to authorized operators and test the retrieval procedure without printing key material. The Admin MFA and OTP secrets are separate keys and are not substitutes.

Loss of a referenced medical-data key makes the corresponding encrypted content unrecoverable. Do not remove old key IDs until message and document rotation has completed, the tool confirms no old IDs remain, and restore recovery has been tested with the intended retained keyring.

## 4. Restore into an isolated environment

1. Create a new isolated database and a separate private-storage directory. Do not restore over the source database or live document directory.
2. Restore the custom-format database archive with errors treated as fatal:

   ```sh
   pg_restore --exit-on-error --no-owner \
     --dbname="service=smart-healthcare-restore" \
     "$BACKUP_DIR/smart-healthcare.dump"
   ```

3. Verify both archive digests against the separately protected digest records, then extract the document archive into the isolated storage directory and apply restrictive directory/file permissions. Do not expose it through a web server. Configure the named PostgreSQL services in a protected `pg_service.conf`; do not place passwords in the service names or command arguments.
4. Start a compatible API against only the isolated database and restored storage. Supply the recovered keyring through the approved secret channel; never echo it.
5. Use authorized synthetic test accounts in the isolated environment to read a stored message and download a document. Confirm legacy and encrypted formats that exist in the backup can be read, then restart the API and repeat. Verify an unauthorized account is still denied.
6. Record which restore checks passed and the isolated environment used. Do not call a backup verified until these restore and readability checks actually pass.

## 5. Migration and encryption deployment order

Migration 016 is additive for the expected schema: it adjusts the message-body constraint and adds format/version metadata with legacy defaults. It does not encrypt existing records. The new API requires these columns for encrypted writes. The migration runner commits each migration and its checksum ledger row in one transaction and uses a PostgreSQL advisory lock; failures roll back the current migration while earlier committed versions remain recorded.

Before 016, the runner requires non-null `care_messages.body` text, non-null `appointment_documents.storage_key` UUID and `media_type` text, and the expected `care_messages_body_check` constraint for 1–4,000 characters. It rejects pre-existing encryption columns or the replacement constraint without a ledger entry. These targeted preflight checks are not a full schema compatibility comparison.

Use a coordinated cutover, not a rolling deployment:

1. Complete the reviewed schema and restore checks above. Ensure every API instance has the same medical-data keyring and its protected recovery copy is available.
2. Stop all API writers. Apply the reviewed migration through the exact target, for example:

   ```sh
   npm run db:migrate -w @healthcare/api -- --target=016_medical_data_encryption.sql
   ```

   This applies any earlier pending migrations before 016. Inspect the output and ledger. Do not run this command against a pre-ledger populated database until its reviewed baseline is recorded.
3. Start only the encryption-capable API release. Confirm every old plaintext-only instance is stopped and removed from traffic before accepting writes. New message/document writes are encrypted immediately; an old binary cannot read those encrypted writes.
4. Run the conversion report-only command and review its counts. Document counts are metadata counts, not proof of file existence or integrity. The `--rotate` report authenticates encrypted document files it reads, but key-ID counts alone do not verify message ciphertext integrity.
5. A real conversion is a separate approved operation. It requires a verified restorable database/file backup, the required acknowledgements, a maintenance window, and an explicit change approval. This task does not authorize or run that operation.
6. After any approved conversion, verify message and document reads, authorization failures, document integrity, restart behavior, conversion counts, and key IDs with synthetic accounts before resuming normal traffic.

The schema migration is transactional, but there is no automatic down migration. Once encrypted writes exist, do not roll back to a plaintext-only API. Recover by deploying a forward-compatible release or restoring the database and document storage together from the same consistent pre-change backup, with the matching keyring available.

## 6. Interrupted conversion recovery

- **Messages:** Each bounded message batch updates message bodies and version markers in one database transaction. If a batch fails, it rolls back; rerun only after investigating the error and confirming the active/previous keyring remains available.
- **Documents:** Encrypted bytes are written and authenticated before metadata is switched; the plaintext original is removed only after the encrypted format is recorded. An interruption can leave both files, or leave encrypted metadata with a legacy sibling. Preserve both formats and the backup; do not manually delete files. After checking database/file state and the keyring, the conversion utility can resume and verify encrypted files before cleanup.
- If integrity, metadata, or file state is unclear, stop writes and restore both database and private storage from the same verified backup point. Never combine a database from one backup time with document files from another.
- Keep old keys until all converted and rotated content has been verified. Do not claim a conversion or restore succeeded without checking the actual database, files, and authorized read path.

Application-level AES-256-GCM encryption is not end-to-end encryption: the server decrypts content for authorized application operations. It does not establish PostgreSQL disk, filesystem, or backup encryption.
