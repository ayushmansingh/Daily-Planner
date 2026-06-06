// Microsoft Graph calendar integration. Isolated from task/briefing code so
// a bug here cannot trample task data. All functions are pure where possible;
// the index.js route handlers own all data.json reads/writes.
//
// Guardrails baked in:
//  - Never log a raw access_token, refresh_token, or client_secret. Use redact().
//  - Tokens live in data.calendarAuth, fully separated from data.tasks/projects.
//  - Calendars.Read is the ONLY scope requested. Microsoft enforces read-only —
//    the app cannot create, modify, or delete events on the user's calendar.
//  - All network calls go directly to login.microsoftonline.com or
//    graph.microsoft.com. No third party.

import crypto from 'crypto';

const AUTH_HOST = 'https://login.microsoftonline.com';
const GRAPH_HOST = 'https://graph.microsoft.com/v1.0';
const SCOPES = ['Calendars.Read', 'offline_access', 'User.Read', 'openid', 'profile'];

// Mask anything that looks like a token. Used in all log lines.
export function redact(value) {
  if (typeof value !== 'string') return value;
  if (value.length <= 8) return '****';
  return value.slice(0, 4) + '…' + value.slice(-4) + ` (${value.length}ch)`;
}

// Validate that all required MS_* env vars are present. Returns a config
// object or null if anything's missing — caller decides how to handle.
export function loadConfig() {
  const tenantId = process.env.MS_TENANT_ID;
  const clientId = process.env.MS_CLIENT_ID;
  const clientSecret = process.env.MS_CLIENT_SECRET;
  const redirectUri = process.env.MS_REDIRECT_URI;
  if (!tenantId || !clientId || !clientSecret || !redirectUri) return null;
  return { tenantId, clientId, clientSecret, redirectUri };
}

// Build the auth URL the user is redirected to in order to sign in & consent.
// We include a CSRF state token that the callback verifies. Tenant-scoped
// because we registered as single-tenant.
export function buildAuthUrl(config) {
  const state = crypto.randomBytes(16).toString('hex');
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: config.redirectUri,
    response_mode: 'query',
    scope: SCOPES.join(' '),
    state,
    prompt: 'select_account', // lets user pick which account if multiple are signed in
  });
  const url = `${AUTH_HOST}/${config.tenantId}/oauth2/v2.0/authorize?${params}`;
  return { url, state };
}

// Exchange the authorization code for access + refresh tokens. Called once
// during the consent flow, in the /callback handler.
export async function exchangeCodeForTokens(config, code) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
    scope: SCOPES.join(' '),
  });

  const res = await fetch(`${AUTH_HOST}/${config.tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${errText.slice(0, 300)}`);
  }
  return res.json(); // { access_token, refresh_token, expires_in, ... }
}

// Trade a refresh_token for a fresh access_token. Called whenever the cached
// access token is within 60 seconds of expiry.
export async function refreshAccessToken(config, refreshToken) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    scope: SCOPES.join(' '),
  });
  const res = await fetch(`${AUTH_HOST}/${config.tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${errText.slice(0, 300)}`);
  }
  return res.json();
}

// Fetch the signed-in user's basic profile. Used to display "Connected as ___"
// in the topbar.
export async function fetchMe(accessToken) {
  const res = await fetch(`${GRAPH_HOST}/me?$select=displayName,mail,userPrincipalName`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`fetchMe failed (${res.status}): ${errText.slice(0, 200)}`);
  }
  return res.json(); // { displayName, mail, userPrincipalName, id }
}

// Fetch events between two ISO datetimes from the user's primary calendar.
// Uses /calendarView which expands recurring events into individual occurrences.
export async function fetchEvents(accessToken, startISO, endISO) {
  const params = new URLSearchParams({
    startDateTime: startISO,
    endDateTime: endISO,
    $select: 'subject,start,end,location,isAllDay,isOnlineMeeting,onlineMeetingUrl,attendees,bodyPreview,categories,showAs',
    $orderby: 'start/dateTime',
    $top: '100',
  });
  const res = await fetch(`${GRAPH_HOST}/me/calendarView?${params}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`fetchEvents failed (${res.status}): ${errText.slice(0, 200)}`);
  }
  const json = await res.json();
  return json.value || [];
}

// Given the current calendarAuth blob, return a valid access token —
// refreshing if it's close to expiry. Mutates blob in place with new tokens
// when refreshed. Caller persists.
export async function getValidAccessToken(config, auth) {
  const skewMs = 60 * 1000; // refresh if <60s left
  if (auth.accessToken && auth.accessTokenExpiresAt - Date.now() > skewMs) {
    return auth.accessToken;
  }
  if (!auth.refreshToken) {
    throw new Error('No refresh token; user must re-connect.');
  }
  const refreshed = await refreshAccessToken(config, auth.refreshToken);
  auth.accessToken = refreshed.access_token;
  auth.accessTokenExpiresAt = Date.now() + (refreshed.expires_in - 30) * 1000;
  // Microsoft sometimes returns a new refresh_token, sometimes not. Keep new if present.
  if (refreshed.refresh_token) auth.refreshToken = refreshed.refresh_token;
  return auth.accessToken;
}
