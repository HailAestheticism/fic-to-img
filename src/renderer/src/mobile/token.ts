const KEY = 'lfm.token'

export function getToken(): string {
  return localStorage.getItem(KEY) ?? ''
}

export function setToken(t: string): void {
  localStorage.setItem(KEY, t.trim())
}
