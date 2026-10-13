export async function api<T = any>(
  body?: unknown,
  options?: { summary?: boolean; statusOnly?: boolean },
): Promise<T> {
  const response = await fetch(
    options?.statusOnly
      ? "/api/platform?status=1"
      : options?.summary
        ? "/api/platform?summary=1"
        : "/api/platform",
    body
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}
export function download(name: string, content: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
