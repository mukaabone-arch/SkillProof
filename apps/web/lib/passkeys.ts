'use client';
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { api as candidateApi, employerApi } from './api';

export type Portal = 'candidate' | 'employer';
type ApiFn = typeof candidateApi;

/** Each portal keeps its own tokens (see lib/api.ts), so pick the matching client. */
export function apiFor(portal: Portal): ApiFn {
  return portal === 'employer' ? employerApi.api : candidateApi;
}

export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && browserSupportsWebAuthn();
}

type Tokens = { accessToken: string; refreshToken: string; isNewUser: boolean };
type Options = { options: any; challengeId: string }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Returns null if the user closed the passkey dialog. */
export async function signInWithPasskey(portal: Portal = 'candidate'): Promise<Tokens | null> {
  const api = apiFor(portal);
  const { options, challengeId } = await api<Options>('/auth/passkeys/login/options', { method: 'POST' });
  let response;
  try {
    response = await startAuthentication({ optionsJSON: options });
  } catch (e) {
    if ((e as Error).name === 'NotAllowedError') return null;
    throw e;
  }
  return api<Tokens>('/auth/passkeys/login/verify', {
    method: 'POST',
    // Only sent for employers, so candidate sign-in keeps working against an API that predates this field.
    body: JSON.stringify({ challengeId, response, ...(portal === 'employer' ? { portal } : {}) }),
  });
}

/** Signed-in user saves a passkey on this device. Returns false if they closed the dialog. */
export async function addPasskey(name?: string, portal: Portal = 'candidate'): Promise<boolean> {
  const api = apiFor(portal);
  const { options, challengeId } = await api<Options>('/auth/passkeys/register/options', { method: 'POST' });
  let response;
  try {
    response = await startRegistration({ optionsJSON: options });
  } catch (e) {
    const err = e as Error;
    if (err.name === 'NotAllowedError') return false;
    if (err.name === 'InvalidStateError') throw new Error('This device already has a passkey for your account.');
    throw err;
  }
  await api('/auth/passkeys/register/verify', {
    method: 'POST',
    body: JSON.stringify({ challengeId, response, name }),
  });
  return true;
}

/** A friendly default name like "Mac" or "iPhone" for the passkey list. */
export function guessDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'This device';
}
