export function backendBaseUrl(): string {
  return (process.env.BACKEND_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");
}

export function backendApiUrl(path: string): string {
  return `${backendBaseUrl()}/api/v1${path}`;
}
