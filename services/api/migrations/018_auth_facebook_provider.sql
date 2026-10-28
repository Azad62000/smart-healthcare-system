ALTER TABLE auth_identities DROP CONSTRAINT IF EXISTS auth_identities_provider_check;
ALTER TABLE auth_identities
  ADD CONSTRAINT auth_identities_provider_check CHECK (provider IN ('google', 'apple', 'facebook'));

ALTER TABLE auth_oauth_flows DROP CONSTRAINT IF EXISTS auth_oauth_flows_provider_check;
ALTER TABLE auth_oauth_flows
  ADD CONSTRAINT auth_oauth_flows_provider_check CHECK (provider IN ('google', 'apple', 'facebook'));
