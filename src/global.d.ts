// Novus by Pendo agent, loaded by the install snippet in index.html.
interface PendoAgent {
  initialize(options: {
    visitor: { id: string };
    excludeAllText: boolean;
    allowedText: string[];
    recording: { enabled: boolean };
  }): void;
  track?: (name: string, properties: Record<string, string | boolean>) => void;
}
declare var pendo: PendoAgent | undefined;
