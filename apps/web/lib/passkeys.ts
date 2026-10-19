'use client';
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { api } from './api';

export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && browserSupportsWebAuthn();
}

type Tokens = { accessToken: string; refreshToken: string; isNewUser: boolean };
type Options = { options: any; challengeId: string }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Returns null if the user closed the passkey dialog. */
export async function signInWithPasskey(): Promise<Tokens | null> {
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
    body: JSON.stringify({ challengeId, response }),
  });
}

/** Signed-in user saves a passkey on this device. Returns false if they closed the dialog. */
export async function addPasskey(name?: string): Promise<boolean> {
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
