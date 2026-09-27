export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), signal,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message ?? data.error ?? "Request failed.");
  return data as T;
}
