import { hc } from "hono/client";
import type { AppType } from "api/app";

const apiOrigin: string =
  import.meta.env.VITE_API_ORIGIN?.toString() ?? "http://localhost:8787";

const apiClient = hc<AppType>(apiOrigin, {
  init: {
    credentials: "include",
  },
});

export function authLoginUrl(callbackURL: string): string {
  const search = new URLSearchParams({
    callbackURL,
  });

  return `${apiOrigin}/api/auth/login?${search.toString()}`;
}

export async function fetchMe() {
  const response = await apiClient.api.me.$get();
  if (!response.ok) {
    return null;
  }

  return await response.json();
}

export async function logout(): Promise<void> {
  await apiClient.api.auth.logout.$post();
}

export function meQueryOptions() {
  return {
    queryKey: ["me"],
    queryFn: fetchMe,
  } as const;
}

export async function fetchWorkspaces() {
  const response = await apiClient.api.me.workspaces.$get();
  if (!response.ok) {
    return null;
  }

  return await response.json();
}

export function workspacesQueryOptions() {
  return {
    queryKey: ["workspaces"],
    queryFn: fetchWorkspaces,
  } as const;
}

export async function fetchService(serviceId: string, environmentId: string) {
  const response = await apiClient.api.service[":serviceId"][
    ":environmentId"
  ].$get({
    param: { serviceId, environmentId },
  });
  if (!response.ok) {
    return null;
  }

  return await response.json();
}

export function serviceQueryOptions(serviceId: string, environmentId: string) {
  return {
    queryKey: ["service", serviceId, environmentId],
    queryFn() {
      return fetchService(serviceId, environmentId);
    },
  } as const;
}

export async function fetchServiceLogs(
  serviceId: string,
  environmentId: string,
) {
  const response = await apiClient.api.service[":serviceId"][
    ":environmentId"
  ].logs.$get({
    param: { serviceId, environmentId },
  });
  if (!response.ok) {
    return null;
  }

  return await response.json();
}

export function serviceLogsQueryOptions(
  serviceId: string,
  environmentId: string,
) {
  return {
    queryKey: ["service-logs", serviceId, environmentId],
    queryFn() {
      return fetchServiceLogs(serviceId, environmentId);
    },
    refetchInterval: 60_000,
  } as const;
}
