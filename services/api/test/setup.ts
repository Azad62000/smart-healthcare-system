process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://healthcare:test-only@127.0.0.1:5432/healthcare_test";
