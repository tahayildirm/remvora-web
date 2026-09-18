import { apiOrigin } from './api-endpoint';
import { Injectable } from '@angular/core';
export interface Device {
  id: string;
  name: string;
  description: string | null;
  operatingSystem: string | null;
  architecture: string | null;
  agentVersion: string | null;
  allowTerminalPrivilegeEscalation?: boolean;
  enrollmentStatus: string;
  lastSeenAt: string | null;
  deviceCode: string;
}
export interface Identity {
  organizationId: string;
  userId: string;
  role?: string;
  permissions: string[];
  deviceGroups?: string[] | null;
}
@Injectable({ providedIn: 'root' })
export class Api {
  async all<T>(path: string): Promise<T[]> {
    const items: T[] = [];
    for (let offset = 0; ; offset += 500) {
      const page = await this.request<T[]>(`${path}?offset=${offset}&limit=500`);
      items.push(...page);
      if (page.length < 500) return items;
    }
  }

  async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await fetch(apiOrigin() + '/api/v1/' + path, {
      method,
      signal: AbortSignal.timeout(15000),
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Remvora-Request': '1' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).catch(() => {
      throw new Error('NETWORK_ERROR');
    });
    if (!response.ok) {
      const fallback =
        response.status === 400
          ? 'INVALID_REQUEST'
          : response.status === 401
            ? 'UNAUTHORIZED'
            : response.status === 403
              ? 'FORBIDDEN'
              : response.status === 429
                ? 'RATE_LIMITED'
                : response.status >= 500
                  ? 'SERVER_ERROR'
                  : 'REQUEST_FAILED';
      const error: unknown = await response.json().catch(() => null);
      const code =
        error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
          ? error.code
          : fallback;
      throw new Error(code);
    }
    return response.status === 204 ? (undefined as T) : response.json();
  }
}
