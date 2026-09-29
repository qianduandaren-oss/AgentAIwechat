declare namespace NodeJS {
  interface ProcessEnv {
    [key: string]: string | undefined;
  }
}

declare const process: {
  env: NodeJS.ProcessEnv;
  exitCode?: number;
  once(signal: "SIGTERM" | "SIGINT", listener: () => void): void;
};
