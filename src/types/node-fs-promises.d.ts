declare module "node:fs/promises" {
  export function readFile(
    path: string,
    encoding: "utf8"
  ): Promise<string>;

  export function writeFile(
    path: string,
    data: string,
    encoding: "utf8"
  ): Promise<void>;

  export function rename(
    oldPath: string,
    newPath: string
  ): Promise<void>;

  export function mkdir(
    path: string,
    options: { recursive: true }
  ): Promise<string | undefined>;
}
