const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

type StudioProxyLocation = Pick<Location, "hostname" | "port" | "protocol">;

const isLoopbackHost = (hostname: string) => LOOPBACK_HOSTS.has(hostname.toLowerCase());

export const resolveStudioProxyGatewayUrl = (
  upstreamGatewayUrl?: string,
  currentLocation: StudioProxyLocation = window.location
): string => {
  const raw = typeof upstreamGatewayUrl === "string" ? upstreamGatewayUrl.trim() : "";
  if (raw) {
    try {
      const parsed = new URL(raw);
      if (isLoopbackHost(parsed.hostname) && isLoopbackHost(currentLocation.hostname)) {
        return raw;
      }
    } catch {
      // Fall through to the Studio proxy for malformed or non-URL values.
    }
  }

  const protocol = currentLocation.protocol === "https:" ? "wss" : "ws";
  const hostname =
    currentLocation.hostname === "localhost" ? "127.0.0.1" : currentLocation.hostname;
  const host = currentLocation.port ? `${hostname}:${currentLocation.port}` : hostname;
  return `${protocol}://${host}/api/gateway/ws`;
};
