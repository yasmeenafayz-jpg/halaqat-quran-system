// =========================================================
// الأوَّابين — Secure Password Hashing
// PBKDF2-SHA256
// =========================================================

const PASSWORD_SCHEME = "pbkdf2-sha256";
const PASSWORD_ITERATIONS = 210000;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_KEY_BYTES = 32;

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const normalized = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const padding =
    "=".repeat((4 - (normalized.length % 4)) % 4);

  const binary = atob(normalized + padding);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

async function legacySha256(value) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest(
    "SHA-256",
    data
  );

  return Array.from(new Uint8Array(hash))
    .map((byte) =>
      byte.toString(16).padStart(2, "0")
    )
    .join("");
}

async function derivePassword(
  password,
  salt,
  iterations
) {
  const passwordKey =
    await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );

  return new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt,
        iterations,
        hash: "SHA-256",
      },
      passwordKey,
      PASSWORD_KEY_BYTES * 8
    )
  );
}

function safeEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }

  return crypto.subtle.timingSafeEqual(a, b);
}

async function hashPassword(password) {
  if (
    typeof password !== "string" ||
    password.length < 8
  ) {
    throw new Error("PASSWORD_TOO_SHORT");
  }

  const salt = new Uint8Array(
    PASSWORD_SALT_BYTES
  );

  crypto.getRandomValues(salt);

  const derived =
    await derivePassword(
      password,
      salt,
      PASSWORD_ITERATIONS
    );

  return [
    PASSWORD_SCHEME,
    PASSWORD_ITERATIONS,
    bytesToBase64Url(salt),
    bytesToBase64Url(derived),
  ].join("$");
}

async function verifyPassword(
  password,
  storedHash
) {
  if (
    typeof password !== "string" ||
    typeof storedHash !== "string" ||
    !storedHash
  ) {
    return {
      valid: false,
      needsUpgrade: false,
    };
  }

  const parts =
    storedHash.split("$");

  if (
    parts.length === 4 &&
    parts[0] === PASSWORD_SCHEME
  ) {
    const iterations =
      Number(parts[1]);

    if (
      !Number.isInteger(iterations) ||
      iterations < 100000 ||
      iterations > 1000000
    ) {
      return {
        valid: false,
        needsUpgrade: false,
      };
    }

    try {
      const salt =
        base64UrlToBytes(parts[2]);

      const expected =
        base64UrlToBytes(parts[3]);

      const actual =
        await derivePassword(
          password,
          salt,
          iterations
        );

      const valid =
        safeEqual(actual, expected);

      return {
        valid,
        needsUpgrade:
          valid &&
          iterations <
            PASSWORD_ITERATIONS,
      };
    } catch {
      return {
        valid: false,
        needsUpgrade: false,
      };
    }
  }

  // Legacy SHA-256 compatibility.
  // Successful legacy login is upgraded immediately.
  if (
    /^[a-f0-9]{64}$/i.test(storedHash)
  ) {
    const legacy =
      await legacySha256(password);

    const actual =
      new TextEncoder().encode(
        legacy.toLowerCase()
      );

    const expected =
      new TextEncoder().encode(
        storedHash.toLowerCase()
      );

    const valid =
      safeEqual(actual, expected);

    return {
      valid,
      needsUpgrade: valid,
    };
  }

  return {
    valid: false,
    needsUpgrade: false,
  };
}

export {
  hashPassword,
  verifyPassword,
  PASSWORD_SCHEME,
  PASSWORD_ITERATIONS,
};
