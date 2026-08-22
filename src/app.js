const API_BASE =
  import.meta.env.VITE_API_BASE?.replace(/\/+$/, "") || "/api";

async function request(path, options = {}) {
  const normalizedPath = String(path || "").startsWith("/")
    ? path
    : `/${path}`;

  const response = await fetch(
    `${API_BASE}${normalizedPath}`,
    {
      ...options,
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      }
    }
  );

  const contentType =
    response.headers.get("content-type") || "";

  const data = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : await response.text().catch(() => "");

  if (!response.ok) {
    const message =
      typeof data === "object"
        ? data?.error || data?.message
        : data;

    const error = new Error(
      message || `REQUEST_FAILED_${response.status}`
    );

    error.status = response.status;
    error.data = data;

    throw error;
  }

  return data;
}

export function get(path, options = {}) {
  return request(path, {
    ...options,
    method: "GET"
  });
}

export function post(path, body, options = {}) {
  return request(path, {
    ...options,
    method: "POST",
    body: JSON.stringify(body ?? {})
  });
}

export function put(path, body, options = {}) {
  return request(path, {
    ...options,
    method: "PUT",
    body: JSON.stringify(body ?? {})
  });
}

export function patch(path, body, options = {}) {
  return request(path, {
    ...options,
    method: "PATCH",
    body: JSON.stringify(body ?? {})
  });
}

export function remove(path, options = {}) {
  return request(path, {
    ...options,
    method: "DELETE"
  });
}

export { request };
