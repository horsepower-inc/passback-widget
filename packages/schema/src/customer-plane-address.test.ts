import { describe, expect, it } from 'vitest';
import { SaveIntegration, VerifyRequest } from './customer';

const base = { tracker: 'plane', credential: 'plane_api_key_1', workspace: 'acme' };

function verify(planeUrl?: string) {
  return VerifyRequest.safeParse(planeUrl === undefined ? base : { ...base, planeUrl });
}

function save(planeUrl?: string) {
  const body = { ...base, project: 'proj-1' };
  return SaveIntegration.safeParse(planeUrl === undefined ? body : { ...body, planeUrl });
}

describe('PlaneAddress', () => {
  it('accepts a Plane request without an address and with an https address', () => {
    for (const url of [undefined, 'https://plane.example.com', 'https://plane.example.com/']) {
      expect(verify(url).success).toBe(true);
      expect(save(url).success).toBe(true);
    }
  });

  it('refuses an address with another scheme, user information, a port, a path, a query or an IP literal', () => {
    for (const url of [
      'http://plane.example.com',
      'https://user@plane.example.com',
      'https://plane.example.com:8443',
      'https://plane.example.com/api',
      'https://plane.example.com/?a=1',
      'https://127.0.0.1',
      'https://0x7f.1',
      'https://2130706433',
      'https://[::1]',
    ]) {
      expect(verify(url).success, url).toBe(false);
      expect(save(url).success, url).toBe(false);
    }
  });

  it('refuses an address on a local name', () => {
    for (const url of [
      'https://plane.local',
      'https://plane.internal',
      'https://localhost',
      'https://plane',
    ]) {
      expect(verify(url).success, url).toBe(false);
      expect(save(url).success, url).toBe(false);
    }
  });
});
