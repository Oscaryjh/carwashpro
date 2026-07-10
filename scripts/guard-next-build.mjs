import net from "node:net";

const devPorts = [Number(process.env.PORT ?? 3000)];
const timeoutMs = 400;

async function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

for (const port of devPorts) {
  const hasLocalServer =
    (await canConnect("127.0.0.1", port)) || (await canConnect("::1", port));

  if (hasLocalServer) {
    console.error(
      [
        `Refusing to run next build while localhost:${port} is active.`,
        "",
        "Stop npm run dev first, then run:",
        "  npm run build",
        "  npm run next:clean",
        "  npm run dev",
      ].join("\n"),
    );
    process.exit(1);
  }
}
