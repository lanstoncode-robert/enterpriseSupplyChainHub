import { auth } from './auth.js';

export class GqlError extends Error {
  constructor(message, { code = 'GRAPHQL_ERROR', errors = [], status = 0, requestId = null } = {}) {
    super(message);
    this.name = 'GqlError';
    this.code = code;
    this.errors = errors;
    this.status = status;
    this.requestId = requestId;
  }
}

function notifyAuthRequired(message) {
  window.dispatchEvent(new CustomEvent('sch:auth-required', { detail: { message } }));
}

/**
 * GraphQL client with bearer auth, abort signals, structured errors, and a
 * single retry-free request per call. Mutations invalidate nothing implicitly;
 * callers re-fetch the affected query so the UI always reflects the server.
 */
export async function gql(query, variables = {}, { signal } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (auth.hasToken) headers.Authorization = `Bearer ${auth.token}`;

  let response;
  try {
    response = await fetch('/graphql', {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
      signal,
      credentials: 'same-origin',
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new GqlError('Cannot reach the GraphQL API. Check your network connection and try again.', { code: 'NETWORK_ERROR' });
  }

  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }

  if (response.status === 401) {
    notifyAuthRequired(payload?.errors?.[0]?.message ?? 'A bearer token is required.');
    throw new GqlError('Authentication required.', { code: 'UNAUTHORIZED', status: 401 });
  }

  if (!response.ok) {
    throw new GqlError(payload?.errors?.[0]?.message ?? `Request failed with status ${response.status}.`, {
      status: response.status,
      errors: payload?.errors ?? [],
    });
  }

  if (!payload) {
    throw new GqlError('The API returned a response that was not valid JSON.', { status: response.status });
  }

  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    const first = payload.errors[0];
    const error = new GqlError(first.message ?? 'The request failed.', {
      code: first.extensions?.code ?? 'GRAPHQL_ERROR',
      errors: payload.errors,
      status: response.status,
      requestId: payload.extensions?.requestId ?? null,
    });
    if (error.code === 'UNAUTHORIZED') notifyAuthRequired(first.message ?? 'A bearer token is required.');
    throw error;
  }

  return payload.data;
}

export function errorMessage(error) {
  if (error instanceof GqlError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
