import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getModule } from "@/config/portal-modules";
import { API_BASE_URL } from "@/lib/api/client";

const KEY = "ecopantry-camera-host";
// IPv4 or hostname, optional port. Nothing else reaches the image URL.
const HOST = /^[a-zA-Z0-9]([a-zA-Z0-9.-]{0,60}[a-zA-Z0-9])?(:\d{1,5})?$/;

function load(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

type RelayState = "waiting" | "live" | "error";

/** Polls the API for the latest relayed frame. Asking for a frame is also what tells the camera to start sending. */
function useRelayFrame() {
  const [src, setSrc] = useState("");
  const [state, setState] = useState<RelayState>("waiting");

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let current = "";
    async function tick() {
      let next: RelayState = "waiting";
      try {
        const res = await fetch(`${API_BASE_URL}/camera/frame`, {
          credentials: "include",
          cache: "no-store",
        });
        if (res.status === 200) {
          const url = URL.createObjectURL(await res.blob());
          if (stopped) {
            URL.revokeObjectURL(url);
            return;
          }
          if (current) URL.revokeObjectURL(current);
          current = url;
          setSrc(url);
          next = "live";
        } else if (res.status !== 204) {
          next = "error";
        }
      } catch {
        next = "error";
      }
      if (stopped) return;
      setState(next);
      timer = setTimeout(tick, next === "live" ? 700 : 2000);
    }
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
      if (current) URL.revokeObjectURL(current);
    };
  }, []);

  return { src: state === "live" ? src : "", state };
}

export default function CameraPage() {
  const relay = useRelayFrame();
  const module = getModule("camera");
  const [input, setInput] = useState(load);
  const [host, setHost] = useState(() => (HOST.test(load()) ? load() : ""));
  const [failed, setFailed] = useState(false);
  const invalid = input !== "" && !HOST.test(input.trim());
  const url = host
    ? `http://${host.includes(":") ? host : `${host}:81`}/stream`
    : "";

  function connect(e: React.FormEvent) {
    e.preventDefault();
    const value = input.trim();
    if (!HOST.test(value)) return;
    try {
      localStorage.setItem(KEY, value);
    } catch {
      /* remembering is optional */
    }
    setFailed(false);
    setHost(value);
  }

  return (
    <div className="space-y-6">
      <PageHeader title={module.title} description={module.summary} />
      <section className="overflow-hidden rounded-lg border bg-card">
        {relay.src ? (
          <img
            src={relay.src}
            alt="Live camera view"
            className="mx-auto block max-h-[70vh] w-full object-contain"
          />
        ) : (
          <p className="p-6 text-sm text-muted-foreground">
            {relay.state === "error"
              ? "Could not reach the server."
              : "Waiting for the camera. It starts sending within about 10 seconds of opening this page, if it is switched on and on WiFi."}
          </p>
        )}
      </section>
      <details className="space-y-4">
        <summary className="cursor-pointer text-sm font-medium">
          Direct view on the shop network
        </summary>
        <form onSubmit={connect} className="flex max-w-md gap-2">
          <Input
            aria-label="Camera IP address"
            placeholder="Camera IP, e.g. 192.168.1.50"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-invalid={invalid}
          />
          <Button type="submit" disabled={!input.trim() || invalid}>
            Connect
          </Button>
        </form>
        {invalid && (
          <p className="text-sm text-danger">
            Enter an IP address or host name.
          </p>
        )}
        <section className="overflow-hidden rounded-lg border bg-card">
          {url && !failed ? (
            <img
              src={url}
              alt="Live camera stream"
              className="mx-auto block max-h-[70vh] w-full object-contain"
              onError={() => setFailed(true)}
            />
          ) : (
            <p className="p-6 text-sm text-muted-foreground">
              {failed
                ? "The stream could not be shown. Check that the camera is on and you are on its network. Browsers may also block an http:// stream on this https site."
                : "Enter the camera's IP address (printed on its serial monitor) to start the stream."}
            </p>
          )}
        </section>
        {url && (
          <p className="text-sm text-muted-foreground">
            Stream not showing?{" "}
            <a
              className="underline"
              href={url}
              target="_blank"
              rel="noreferrer"
            >
              Open it directly
            </a>
            . The camera has no login and is only reachable on its own network.
          </p>
        )}
      </details>
    </div>
  );
}
