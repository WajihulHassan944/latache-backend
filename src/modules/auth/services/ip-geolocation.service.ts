import { Injectable } from '@nestjs/common';
import { BlockList, isIP } from 'node:net';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { Reader, type CityResponse } from 'maxmind';

export interface IpLocation {
  city: string | null;
  country: string | null;
}

const NO_LOCATION: IpLocation = { city: null, country: null };
const CACHE_LIMIT = 2000;

/** Ranges that can never be geolocated: loopback, private, link-local, CGNAT, etc. */
const NON_PUBLIC = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  NON_PUBLIC.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  NON_PUBLIC.addSubnet(net, prefix, 'ipv6');
}

/**
 * Offline IP -> city/country lookup (GeoLite2 City MMDB files), so GET /auth/sessions
 * never makes a per-row external call. Resolved at read time and never persisted.
 */
@Injectable()
export class IpGeolocationService {
  private readonly cache = new Map<string, IpLocation>();
  private readonly readers: Reader<CityResponse>[] = [];
  private readonly countryNames = new Intl.DisplayNames(['en'], { type: 'region' });

  constructor() {
    // GeoLite2 City MMDBs shipped by the @ip-location-db package (refreshed by bumping the dependency).
    const dir = dirname(require.resolve('@ip-location-db/geolite2-city-mmdb/package.json'));
    for (const file of ['geolite2-city-ipv4.mmdb', 'geolite2-city-ipv6.mmdb']) {
      this.readers.push(new Reader<CityResponse>(readFileSync(join(dir, file))));
    }
  }

  resolve(rawIp: string | null | undefined): IpLocation {
    const ip = this.normalize(rawIp);
    if (!ip) return NO_LOCATION;
    const cached = this.cache.get(ip);
    if (cached) return cached;

    const result = this.lookup(ip);
    if (this.cache.size >= CACHE_LIMIT) this.cache.clear();
    this.cache.set(ip, result);
    return result;
  }

  private lookup(ip: string): IpLocation {
    const family = isIP(ip) === 6 ? 'ipv6' : 'ipv4';
    if (NON_PUBLIC.check(ip, family)) return NO_LOCATION;
    try {
      const hit = this.readers[family === 'ipv6' ? 1 : 0]!.get(ip) as
        | { country_code?: string; city?: string }
        | null;
      if (!hit?.country_code) return NO_LOCATION;
      return { city: hit.city?.trim() || null, country: this.countryName(hit.country_code) };
    } catch {
      return NO_LOCATION;
    }
  }

  private countryName(code: string): string | null {
    try {
      const name = this.countryNames.of(code);
      return name && name !== code ? name : null;
    } catch {
      return null;
    }
  }

  private normalize(raw: string | null | undefined): string | null {
    if (!raw) return null;
    let ip = raw.trim();
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
    if (mapped?.[1]) ip = mapped[1];
    return isIP(ip) ? ip : null;
  }
}
