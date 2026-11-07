// Loads variables from a .env file in the project folder, if there is one (Node 22.13+).
// Real environment variables (for example the ones set on Render) always win over the file.
const path = require('path');
try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch (_) { /* no .env file, that is fine */ }
