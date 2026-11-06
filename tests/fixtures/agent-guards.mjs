import fs from 'node:fs';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';

// Preload inside the actual CLI/server process, before any application imports.
// Exit even if application code would catch a thrown error and hide the attempt.
const forbidden = () => {
  process.stderr.write('NETWORK_FORBIDDEN\n');
  process.exit(97);
};
globalThis.fetch = forbidden;
net.connect = forbidden;
net.createConnection = forbidden;
net.Socket.prototype.connect = forbidden;
if (process.env.SESSION_SHAPE_FORBID_BLOB === '1') {
  fs.openAsBlob = () => {
    process.stderr.write('CONTENT_READ_FORBIDDEN\n');
    process.exit(98);
  };
}
syncBuiltinESMExports();
