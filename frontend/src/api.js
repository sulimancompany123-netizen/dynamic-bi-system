const API_BASE = 'http://127.0.0.1:8000';
const DEFAULT_TIMEOUT = 180000;
const LONG_TIMEOUT = 300000;

export { LONG_TIMEOUT };

let _token = null;

if (typeof window !== 'undefined') {
  const storedToken = localStorage.getItem('bi_token');
  if (storedToken) {
    _token = storedToken;
  }
}

export function setApiToken(token) {
  _token = token;
}

export function getToken() {
  return _token;
}

function authHeaders() {
  const headers = {
    'Accept': 'application/json',
  };
  if (_token) {
    headers['Authorization'] = `Bearer ${_token}`;
  }
  return headers;
}

async function fetchWithTimeout(url, options, timeout = DEFAULT_TIMEOUT, externalSignal = null) {
  const controller = new AbortController();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return res;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

async function handleResponse(res) {
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const errBody = await res.json();
      detail = errBody.detail || errBody.message || JSON.stringify(errBody);
    } catch (_) {}
    throw new Error(detail);
  }
  const data = await res.json();
  if (data && data.status === 'error') {
    throw new Error(data.detail || data.message || 'Unknown server error');
  }
  return data;
}

export async function apiPost(path, body = {}, timeout = DEFAULT_TIMEOUT, signal = null) {
  const isFormData = body instanceof FormData;
  const res = await fetchWithTimeout(`${API_BASE}${path}`, {
    method: 'POST',
    headers: isFormData ? { ...authHeaders() } : { ...authHeaders(), 'Content-Type': 'application/json' },
    body: isFormData ? body : JSON.stringify(body),
  }, timeout, signal);
  return handleResponse(res);
}

export async function apiGet(path, params = {}, timeout = DEFAULT_TIMEOUT) {
  const qs = new URLSearchParams(params).toString();
  const url = qs ? `${API_BASE}${path}?${qs}` : `${API_BASE}${path}`;
  const res = await fetchWithTimeout(url, { headers: authHeaders() }, timeout);
  return handleResponse(res);
}

export async function apiPut(path, body = {}, timeout = DEFAULT_TIMEOUT) {
  const res = await fetchWithTimeout(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, timeout);
  return handleResponse(res);
}

export async function apiDelete(path, timeout = DEFAULT_TIMEOUT) {
  const res = await fetchWithTimeout(`${API_BASE}${path}`, {
    method: 'DELETE',
    headers: authHeaders(),
  }, timeout);
  return handleResponse(res);
}

export async function apiUpload(path, file, additionalFields = {}, timeout = DEFAULT_TIMEOUT) {
  const formData = new FormData();
  formData.append('file', file);
  for (const [key, val] of Object.entries(additionalFields)) {
    formData.append(key, val);
  }
  const res = await fetchWithTimeout(`${API_BASE}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  }, timeout);
  return handleResponse(res);
}