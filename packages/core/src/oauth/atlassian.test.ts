import { describe, expect, it } from 'vitest';

import { ATLASSIAN_CLOUD_OAUTH, OAUTH_REGISTRY } from './atlassian';

describe('ATLASSIAN_CLOUD_OAUTH', () => {
  it('Atlassian 公式 endpoint を保持する', () => {
    expect(ATLASSIAN_CLOUD_OAUTH.authorizationEndpoint).toBe(
      'https://auth.atlassian.com/authorize',
    );
    expect(ATLASSIAN_CLOUD_OAUTH.tokenEndpoint).toBe('https://auth.atlassian.com/oauth/token');
    expect(ATLASSIAN_CLOUD_OAUTH.audience).toBe('api.atlassian.com');
  });

  it('default scopes に offline_access が含まれる (refresh_token 取得のために必須)', () => {
    expect(ATLASSIAN_CLOUD_OAUTH.defaultScopes).toContain('offline_access');
  });
});

describe('OAUTH_REGISTRY', () => {
  it('atlassian kind が登録されている', () => {
    expect(OAUTH_REGISTRY.atlassian).toBe(ATLASSIAN_CLOUD_OAUTH);
  });
});
