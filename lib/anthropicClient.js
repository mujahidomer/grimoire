const Anthropic = require('@anthropic-ai/sdk');
const nodeFetch = require('node-fetch');
const https = require('node:https');

// Non-pooling HTTPS agent for every Anthropic SDK client in this codebase.
// The SDK's built-in default is a SHARED, process-wide agentkeepalive agent
// (keepAlive: true, timeout: 5 min — see @anthropic-ai/sdk/_shims/node-runtime.js)
// that pools sockets across every call. On Railway that pool went stale: an
// idle socket outlived a shorter idle timeout on Railway's egress path (or
// Anthropic's edge), then got reused — Anthropic returned a clean 200 but the
// gzip response stream was cut mid-flight, surfacing as ERR_STREAM_PREMATURE_CLOSE.
// With keepAlive:false, each request opens a fresh connection and closes it after.
const anthropicHttpsAgent = new https.Agent({ keepAlive: false });

// Diagnostic wrapper around the SDK's fetch. Logs status + response headers that
// matter for mid-stream failures (content-encoding/content-length/connection)
// as soon as they arrive, BEFORE the SDK reads/gunzips the body.
async function loggedFetch(url, init) {
  const response = await nodeFetch(url, init);
  console.log(
    `[anthropic] ${response.status} ${url} ` +
    `content-encoding=${response.headers.get('content-encoding')} ` +
    `content-length=${response.headers.get('content-length')} ` +
    `connection=${response.headers.get('connection')}`
  );
  return response;
}

function createAnthropicClient(apiKey) {
  return new Anthropic({
    apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY,
    fetch: loggedFetch,
    httpAgent: anthropicHttpsAgent,
  });
}

let defaultClient = null;
function getAnthropicClient() {
  if (!defaultClient) defaultClient = createAnthropicClient();
  return defaultClient;
}

module.exports = {
  anthropicHttpsAgent,
  loggedFetch,
  createAnthropicClient,
  getAnthropicClient,
};
