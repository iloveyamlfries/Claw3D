const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

type StudioProxyLocation = Pick<Location, "hostname" | "port" | "protocol">;

const isLoopbackHost = (hostname: string) => LOOPBACK_HOSTS.has(hostname.toLowerCase());

const resolveConfiguredProxyPort = () => {
  const raw = process.env.NEXT_PUBLIC_GATEWAY_PROXY_PORT?.trim();
  if (!raw) return "";
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return "";
  return String(port);
};

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
  const port = resolveConfiguredProxyPort() || currentLocation.port;
  const host = port ? `${hostname}:${port}` : hostname;
  return `${protocol}://${host}/api/gateway/ws`;
};
