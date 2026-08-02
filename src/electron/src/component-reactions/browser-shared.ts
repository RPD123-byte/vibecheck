export const BROWSER_PROTOCOL_VERSION = 1;
export const BROWSER_HOST = "127.0.0.1";
export const BROWSER_HOST_PORT = 43_831;
export const BROWSER_CLIENT_KEY =
  "5b928749c85e37ec77dc0930de38c453718b22f694e746f24b9aaf06b9c77892";
export const BROWSER_SOCKET_PATH = "/component-reactions/v1";

export function browserSocketUrl(): string {
  return `ws://${BROWSER_HOST}:${BROWSER_HOST_PORT}${BROWSER_SOCKET_PATH}`;
}
