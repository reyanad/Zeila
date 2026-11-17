// Deterministic secrets for code that derives keys from the environment.
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-0123456789";
process.env.DATA_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.NODE_ENV ??= "test";
