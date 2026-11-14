/**
 * A Twitch login: letters, digits and underscore, 1 to 25 characters. It is used as a folder
 * name in the clip bank, so anything else (dots, slashes, spaces, empty) must never get that far.
 * Logins are stored lowercase.
 */
export const TWITCH_LOGIN_RE = /^[A-Za-z0-9_]{1,25}$/

export const TWITCH_LOGIN_MESSAGE =
  'Not a Twitch login (letters, digits and underscore, 1 to 25 characters)'

export function isValidTwitchLogin(login: string): boolean {
  return TWITCH_LOGIN_RE.test(login)
}
