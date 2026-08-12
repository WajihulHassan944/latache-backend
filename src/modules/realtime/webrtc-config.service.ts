import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import type { WebRtcConfigurationView, WebRtcIceServerView } from './realtime.types';

@Injectable()
export class WebRtcConfigService {
  constructor(private readonly config: ConfigService) {}

  forUser(userId: number): WebRtcConfigurationView {
    const iceServers: WebRtcIceServerView[] = [];
    const stunUrls = this.config.get<string[]>('webrtc.stunUrls', []);
    if (stunUrls.length > 0) iceServers.push({ urls: stunUrls });

    const turnUrls = this.config.get<string[]>('webrtc.turnUrls', []);
    let credentialExpiresAt: string | null = null;
    if (turnUrls.length > 0) {
      const sharedSecret = this.config.get<string>('webrtc.turnSharedSecret');
      const staticUsername = this.config.get<string>('webrtc.turnUsername');
      const staticCredential = this.config.get<string>('webrtc.turnCredential');

      if (sharedSecret) {
        const ttlSeconds = this.config.get<number>('webrtc.turnCredentialTtlSeconds', 3600);
        const expiresAtSeconds = Math.floor(Date.now() / 1000) + ttlSeconds;
        const username = `${expiresAtSeconds}:${userId}`;
        const credential = createHmac('sha1', sharedSecret).update(username).digest('base64');
        credentialExpiresAt = new Date(expiresAtSeconds * 1000).toISOString();
        iceServers.push({ urls: turnUrls, username, credential });
      } else if (staticUsername && staticCredential) {
        iceServers.push({
          urls: turnUrls,
          username: staticUsername,
          credential: staticCredential,
        });
      }
    }

    return {
      iceServers,
      credentialExpiresAt,
      turnConfigured: iceServers.some((server) =>
        server.urls.some((url) => url.startsWith('turn:') || url.startsWith('turns:')),
      ),
    };
  }
}
